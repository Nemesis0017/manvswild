import * as THREE from 'three';
import { gameStore } from './core/gameState';
import { Gameplay } from './gameplay/gameplay';
import { InputManager } from './core/input';
import { GameLoop } from './core/loop';
import { effectivePreset, settingsStore } from './core/settings';
import { CharacterController } from './physics/character';
import { PhysicsWorld } from './physics/physics';
import { PlayerCamera } from './player/camera';
import { PlayerModel } from './player/model';
import { AudioEngine, type AudioState } from './audio/audio';
import { STEP_PARAMS, stepInterval, surfaceAt } from './audio/surface';
import { findBiomeSpawn } from './exploration/pois';
import { Session, type SessionConfig } from './game/session';
import { characterById, scenarioById } from './game/modes';
import { isLit } from './building/building';
import { PostFx } from './render/post';
import { saveDb } from './save/db';
import { SAVE_VERSION, type SaveData } from './save/saveData';
import { CaveInterior, caveOutsidePoint } from './world/caves';
import { waterfallSitesForChunk } from './world/features';
import { ChunkManager } from './world/chunks';
import { Sky } from './world/sky';
import { CHUNK_SIZE, Terrain, WATER_Y } from './world/terrain';
import { windUniform } from './world/vegetation';
import { Water } from './world/water';

/** Top-level engine object: wires rendering, world streaming, physics, player and input together. */
export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly input: InputManager;
  readonly terrain: Terrain;
  readonly physics: PhysicsWorld;
  readonly chunks: ChunkManager;
  readonly sky: Sky;
  readonly water: Water;
  readonly character: CharacterController;
  readonly gameplay: Gameplay;
  readonly model = new PlayerModel();
  readonly cam: PlayerCamera;
  readonly audio = new AudioEngine();
  readonly post: PostFx;
  session: Session | null = null;
  /** Set by the UI so that F9 can load the quicksave. */
  onQuickLoad: (() => void) | null = null;
  seed: number;
  private spawnPoint: { x: number; z: number };
  private autosaveTimer = 0;
  private stepDist = 0;
  private wasSwimming = false;
  private audioTimer = 0;
  private audioCache: Pick<AudioState, 'river' | 'waterfall' | 'animals' | 'danger' | 'fire'> = { river: null, waterfall: null, animals: [], danger: 0, fire: null };
  private fallTimer = 0;
  private saving = false;
  private loop: GameLoop;
  private elapsed = 0;
  private frameTimes: number[] = [];
  private hudTimer = 0;
  private fpsAccum = { t: 0, n: 0 };
  private pixelRatio: number;
  private cave: { site: ReturnType<ChunkManager['nearbyCave']> & object; interior: CaveInterior } | null = null;
  private caveCooldown = 0;
  private resizeObs: ResizeObserver;
  private unsubSettings: () => void;
  private fog: THREE.Fog;
  private caveLight = new THREE.Color(0x0a0908);
  private disposed = false;
  private introPlayed = false;
  private onLockChange = () => {
    if (!document.pointerLockElement && gameStore.getState().status === 'playing' && !this.gameplay.panelOpen && !this.needsCursor) this.setPaused(true);
  };

  private constructor(private container: HTMLElement, physics: PhysicsWorld, seed: number) {
    const s = settingsStore.getState();
    const preset = effectivePreset(s);
    this.seed = seed;
    this.physics = physics;
    this.terrain = new Terrain(seed);

    this.renderer = new THREE.WebGLRenderer({ antialias: preset.antialias, powerPreference: 'high-performance' });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.pixelRatio = Math.min(window.devicePixelRatio, preset.pixelRatio);
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;touch-action:none';
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(s.fov, 1, 0.1, 2000);
    this.input = new InputManager(this.renderer.domElement);
    this.cam = new PlayerCamera(this.camera, this.terrain);

    this.sky = new Sky(preset.shadowMapSize, preset.shadows);
    this.fog = new THREE.Fog(0xaaccee, 60, preset.viewDistance * CHUNK_SIZE);
    this.scene.fog = this.fog;
    this.water = new Water();
    this.chunks = new ChunkManager(this.terrain, physics, preset);
    this.scene.add(this.sky.mesh, this.sky.sun, this.sky.sun.target, this.sky.hemi, this.chunks.group, this.water.mesh, this.model.root);

    const spawn = this.terrain.findSpawn();
    this.chunks.preload(spawn.x, spawn.z, 2);
    const gy = this.terrain.heightAt(spawn.x, spawn.z);
    this.character = new CharacterController(physics, this.terrain, spawn.x, gy + 0.6, spawn.z);
    physics.step(1 / 60);
    physics.step(1 / 60);
    this.spawnPoint = spawn;
    this.gameplay = new Gameplay(this.scene, this.terrain, this.character, this.cam, this.sky, seed, spawn);
    this.post = new PostFx(this.renderer, this.scene, this.camera);

    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(container);
    this.resize();

    this.unsubSettings = settingsStore.subscribe(() => this.applySettings());
    this.applySettings();

    document.addEventListener('pointerlockchange', this.onLockChange);
    this.loop = new GameLoop((dt) => this.update(dt), (dt) => this.render(dt));
    this.loop.start();
  }

  static async create(container: HTMLElement, seed: number = settingsStore.getState().seed): Promise<Game> {
    gameStore.setState({ status: 'loading', loadMessage: 'Starting physics' });
    const physics = await PhysicsWorld.create();
    gameStore.setState({ loadMessage: 'Generating world' });
    const g = new Game(container, physics, seed);
    gameStore.setState({ status: 'menu', loadMessage: 'Ready' });
    if (location.search.includes('debug')) (window as unknown as { __mvw: Game }).__mvw = g;
    return g;
  }

  /** Start a fresh session, or continue from a save. Call once on a new Game. */
  beginSession(cfg: SessionConfig, save?: SaveData): void {
    let spawn = this.spawnPoint;
    if (save) spawn = save.session.spawn;
    else if (cfg.mode === 'expedition') {
      const sc = scenarioById(cfg.scenarioId);
      spawn = findBiomeSpawn(this.terrain, sc.biome) ?? spawn;
    }
    this.spawnPoint = spawn;
    this.gameplay.setSpawn(spawn.x, spawn.z);
    const moved = spawn !== undefined && (Math.abs(spawn.x - this.character.feet.x) > 5 || Math.abs(spawn.z - this.character.feet.z) > 5);
    this.session?.dispose();
    this.session = new Session(cfg, this.terrain, this.gameplay, this.character, this.sky, spawn, save?.session);
    this.model.setShirtColor(characterById(cfg.character).color);
    if (save) {
      this.gameplay.restore(save.gameplay);
      this.placePlayer(save.player.x, save.player.y, save.player.z);
      this.cam.yaw = save.player.yaw;
      this.cam.pitch = save.player.pitch;
      this.introPlayed = true;
    } else if (moved) {
      this.placePlayer(spawn.x, this.terrain.heightAt(spawn.x, spawn.z), spawn.z);
    }
    if (!this.introPlayed) {
      this.introPlayed = true;
      this.cam.startIntro();
    }
    this.autosaveTimer = 0;
    gameStore.setState({ status: 'playing' });
    this.audio.unlock();
    this.input.requestLock();
  }

  private placePlayer(x: number, y: number, z: number): void {
    this.chunks.preload(x, z, 2);
    this.physics.step(1 / 60);
    this.physics.step(1 / 60);
    this.character.teleport(x, Math.max(y, this.terrain.heightAt(x, z)) + 0.6, z);
  }

  // ---------- Saving ----------
  captureSave(slot: string, name: string): SaveData | null {
    const s = this.session;
    if (!s || s.outcome || this.gameplay.survival.phase !== 'alive') return null;
    let pos = { x: this.character.feet.x, y: this.character.feet.y, z: this.character.feet.z };
    if (this.cave) pos = caveOutsidePoint(this.cave.site, (x, z) => this.terrain.heightAt(x, z));
    const now = Date.now();
    return {
      version: SAVE_VERSION, slot, name, createdAt: now, updatedAt: now, seed: this.seed,
      summary: {
        day: s.day, playSeconds: s.stats.playSeconds, explorationPct: s.exploration.percent(),
        mission: s.tracker.current?.title ?? (s.config.mode === 'story' ? 'Complete' : ''),
        modeLabel: s.config.mode === 'expedition' ? scenarioById(s.config.scenarioId).name : s.config.mode,
        difficulty: s.config.difficulty,
      },
      player: { ...pos, yaw: this.cam.yaw, pitch: this.cam.pitch },
      gameplay: this.gameplay.snapshot(),
      session: s.snapshot(),
    };
  }

  async saveToSlot(slot: string, name?: string): Promise<boolean> {
    if (this.saving) return false;
    const data = this.captureSave(slot, name ?? (slot === 'auto' ? 'Autosave' : slot === 'quick' ? 'Quicksave' : `Slot ${slot}`));
    if (!data) { this.gameplay.say('You cannot save right now.'); return false; }
    this.saving = true;
    try {
      await saveDb.put(data);
      this.gameplay.say(slot === 'auto' ? 'Autosaved.' : 'Game saved.');
      return true;
    } catch (e) {
      this.gameplay.say(`Save failed: ${String((e as Error)?.message ?? e)}`);
      return false;
    } finally {
      this.saving = false;
    }
  }

  requestLock(): void {
    this.input.requestLock();
  }

  setPaused(p: boolean): void {
    gameStore.setState({ status: p ? 'paused' : 'playing' });
    this.audio.setActive(!p);
    if (p) document.exitPointerLock?.();
  }

  skipIntro(): void {
    this.cam.skipIntro();
  }

  private resize(): void {
    const w = this.container.clientWidth || 1, h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.post.setSize(w, h, this.pixelRatio);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private applySettings(): void {
    const s = settingsStore.getState();
    const p = effectivePreset(s);
    this.camera.fov = s.fov;
    this.camera.updateProjectionMatrix();
    this.pixelRatio = Math.min(window.devicePixelRatio, p.pixelRatio);
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.shadowMap.enabled = p.shadows;
    this.sky.configureShadows(p.shadowMapSize, p.shadows);
    this.fog.far = p.viewDistance * CHUNK_SIZE;
    this.chunks.setPreset(p);
    this.post.apply(s, s.reducedMotion);
    this.audio.applyVolumes(s);
    this.resize();
  }

  /** True while a modal (rescue prompt or end screen) needs a free mouse cursor. */
  private get needsCursor(): boolean {
    const ph = this.gameplay.survival.phase;
    return !!this.session?.outcome || ph === 'rescued' || ph === 'ended';
  }

  private get paused(): boolean {
    return gameStore.getState().status !== 'playing' || !!this.session?.outcome;
  }

  private update(dt: number): void {
    this.input.poll();
    const inp = this.input;
    const st = gameStore.getState();
    if (st.status === 'loading') return;
    this.elapsed += dt;
    windUniform.value = this.elapsed;
    this.caveCooldown = Math.max(0, this.caveCooldown - dt);

    if (inp.wasPressed('pause') && st.status !== 'menu') this.setPaused(st.status === 'playing');
    if (this.needsCursor && document.pointerLockElement) document.exitPointerLock();
    if (this.paused) { inp.endFrame(); return; }

    if (this.cam.introActive) {
      if (inp.wasPressed('jump') || inp.wasPressed('interact')) this.cam.skipIntro();
    }
    if (inp.wasPressed('toggleCamera') && !this.cam.introActive) this.cam.toggle();

    const gp = this.gameplay;
    const playing = !this.cam.introActive;
    if (playing && this.session) {
      if (inp.wasPressed('hideHud')) settingsStore.setState({ hudHidden: !settingsStore.getState().hudHidden });
      if (inp.wasPressed('waypoint') && !gp.panelOpen) this.session.addWaypoint(this.character.feet.x, this.character.feet.z);
      if (inp.wasPressed('quickSave')) void this.saveToSlot('quick');
      if (inp.wasPressed('quickLoad')) this.onQuickLoad?.();
    }
    const panelBefore = gp.panelOpen;
    if (playing) gp.handleInput(inp, this.camera);
    if (gp.panelOpen !== panelBefore) {
      if (gp.panelOpen) document.exitPointerLock?.();
      else this.input.requestLock();
    }
    const mod = gp.preMove();
    this.character.frozen = this.cam.introActive || mod.freeze;
    const blocked = this.cam.introActive || mod.lockMovement;
    const axes = inp.moveAxes();
    const exhausted = gp.survival.exhausted;
    this.character.update(dt, {
      x: blocked ? 0 : axes.x,
      y: blocked ? 0 : axes.y,
      yaw: this.cam.yaw,
      jump: !blocked && inp.isDown('jump'),
      jumpPressed: !blocked && (inp.wasPressed('jump') || (inp.isDown('jump') && this.character.state.grounded)),
      sprint: !blocked && !exhausted && inp.isDown('sprint'),
      crouch: !blocked && inp.isDown('crouch'),
      speedMul: mod.speedMul,
      current: mod.current,
    });
    this.physics.step(dt);
    this.updateCaves();
    gp.update(dt, this.camera, playing);
    if (playing) {
      this.session?.update(dt);
      this.footsteps(dt);
      const mins = settingsStore.getState().autosaveMinutes;
      this.autosaveTimer += dt;
      if (mins > 0 && this.autosaveTimer >= mins * 60) {
        this.autosaveTimer = 0;
        if (!this.gameplay.panelOpen) void this.saveToSlot('auto');
      }
    }
    inp.endFrame();
  }

  private footsteps(dt: number): void {
    const cs = this.character.state;
    const f = this.character.feet;
    this.fallTimer -= dt;
    if (cs.swimming) {
      if (!this.wasSwimming) this.audio.splash();
      this.stepDist += cs.speed * dt;
      if (this.stepDist > 2.2) { this.stepDist = 0; this.audio.swimStroke(); }
    } else if (cs.grounded && cs.speed > 0.6 && !cs.climbing) {
      this.stepDist += cs.speed * dt;
      if (this.stepDist >= stepInterval(cs.speed, cs.sprinting, cs.crouching)) {
        this.stepDist = 0;
        const surface = surfaceAt(this.terrain.biomeAt(f.x, f.z), f.y, !!this.cave);
        this.audio.footstep(surface, cs.sprinting, cs.crouching);
        this.gameplay.noiseFootstep(f.x, f.z, STEP_PARAMS[surface].gain, cs.sprinting, cs.crouching);
      }
    }
    this.wasSwimming = cs.swimming;
  }

  private updateAudio(dt: number, st: { biome: string; underwater: boolean }): void {
    this.audioTimer -= dt;
    const f = this.character.feet;
    const gp = this.gameplay;
    if (this.audioTimer <= 0) {
      this.audioTimer = 0.5;
      const c = this.audioCache;
      c.river = null; c.waterfall = null; c.fire = null;
      if (!this.cave) {
        const rf = this.terrain.riverField(f.x, f.z);
        const e = 3;
        const gx = (this.terrain.riverField(f.x + e, f.z) - this.terrain.riverField(f.x - e, f.z)) / (2 * e);
        const gz = (this.terrain.riverField(f.x, f.z + e) - this.terrain.riverField(f.x, f.z - e)) / (2 * e);
        const gl = Math.hypot(gx, gz);
        if (gl > 1e-7) {
          const dist = Math.min(200, Math.abs(rf) / gl);
          const sgn = -Math.sign(rf) || 1;
          const sx = f.x + (gx / gl) * sgn * dist, sz = f.z + (gz / gl) * sgn * dist;
          const r = this.terrain.sample(sx, sz).river;
          const gain = Math.max(0, 1 - dist / 130) * (r > 0.2 ? 1 : 0.25);
          if (gain > 0.02) c.river = { gain, x: sx, y: f.y, z: sz };
        }
        const pcx = Math.floor(f.x / 64), pcz = Math.floor(f.z / 64);
        let best = 160;
        for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
          for (const w of waterfallSitesForChunk(this.terrain, pcx + dx, pcz + dz)) {
            const d = Math.hypot(w.x - f.x, w.z - f.z);
            if (d < best) { best = d; c.waterfall = { gain: Math.max(0.05, 1 - d / 160), x: w.x, y: this.terrain.heightAt(w.x, w.z), z: w.z }; }
          }
        }
      }
      let nf = 40;
      for (const p of gp.pieces) {
        if (!isLit(p)) continue;
        const d = Math.hypot(p.x - f.x, p.z - f.z);
        if (d < nf) { nf = d; c.fire = { x: p.x, y: p.y + 0.5, z: p.z, dist: d }; }
      }
      c.animals = [];
      c.danger = 0;
      for (const a of gp.wildlife.animals) {
        const d = Math.hypot(a.x - f.x, a.z - f.z);
        if (d < 150) c.animals.push({ species: a.species, x: a.x, y: a.y, z: a.z, dist: d, state: a.state });
        if (d < 25 && (a.state === 'warn' || a.state === 'defensive')) c.danger = 1;
      }
    }
    const tod = this.sky.timeOfDay;
    const fwd = this.tmpFwd;
    this.camera.getWorldDirection(fwd);
    this.audio.update(dt, {
      listener: { x: this.camera.position.x, y: this.camera.position.y, z: this.camera.position.z, fx: fwd.x, fy: fwd.y, fz: fwd.z },
      wind: gp.fx.wind, rain: gp.fx.rain + gp.fx.snow * 0.4,
      night: tod < 0.22 || tod > 0.78, inCave: !!this.cave, underwater: st.underwater,
      stamina: gp.survival.stamina, sprinting: this.character.state.sprinting && this.character.state.speed > 1,
      biome: st.biome,
      ...this.audioCache,
    });
  }
  private tmpFwd = new THREE.Vector3();

  private updateCaves(): void {
    const f = this.character.feet;
    if (this.caveCooldown > 0) return;
    if (!this.cave) {
      const site = this.chunks.nearbyCave(f.x, f.y, f.z);
      if (site) {
        const interior = new CaveInterior(this.physics, site);
        this.scene.add(interior.group);
        this.cave = { site, interior };
        this.character.underground = true;
        const sp = interior.spawn;
        this.character.teleport(sp.x, sp.y, sp.z);
        this.caveCooldown = 1.5;
        this.setCaveVisuals(true);
      }
    } else if (Math.hypot(f.x - this.cave.interior.portal.x, f.z - this.cave.interior.portal.z) < 2.2) {
      const out = caveOutsidePoint(this.cave.site, (x, z) => this.terrain.heightAt(x, z));
      this.scene.remove(this.cave.interior.group);
      this.cave.interior.dispose();
      this.cave = null;
      this.character.underground = false;
      this.character.teleport(out.x, out.y + 0.5, out.z);
      this.caveCooldown = 1.5;
      this.setCaveVisuals(false);
    }
  }

  private setCaveVisuals(inCave: boolean): void {
    this.chunks.group.visible = !inCave;
    this.gameplay.setCaveVisuals(inCave);
    this.water.mesh.visible = !inCave;
    this.sky.mesh.visible = !inCave;
    this.sky.sun.visible = !inCave;
    if (inCave) {
      this.sky.hemi.intensity = 0.12;
      this.fog.color.copy(this.caveLight);
      this.fog.near = 5;
      this.fog.far = 55;
    }
  }

  private render(frameDt: number): void {
    if (this.disposed) return;
    const s = settingsStore.getState();
    const look = this.input.consumeLook(frameDt);
    if (!this.paused && !this.cam.introActive && (this.input.locked || Math.abs(look.dx) + Math.abs(look.dy) > 0)) {
      this.cam.look(look.dx, look.dy, s.sensitivity, s.invertY);
    }

    const f = this.character.feet;
    const cs = this.character.state;
    const inCave = !!this.cave;
    const menu = gameStore.getState().status === 'menu' && !this.session;
    if (menu) {
      this.flythrough(frameDt);
      this.renderScene(frameDt, s);
      return;
    }
    if (!inCave && !this.paused) {
      this.sky.update(frameDt, this.camera.position);
      this.chunks.update(f.x, f.z, 2);
    }
    this.cam.update(frameDt, f, cs.crouching, cs.swimming);
    this.camera.rotateZ(this.gameplay.cameraRoll(s.reducedMotion || !s.cameraShake));
    this.gameplay.frame();
    this.gameplay.render(frameDt, this.camera, s.reducedMotion);

    // Underwater look.
    const underwater = !inCave && this.camera.position.y < WATER_Y - 0.05 && !this.terrainAbove(this.camera.position);
    if (!inCave) {
      const p = effectivePreset(s);
      if (underwater) {
        this.fog.color.setRGB(0.04, 0.2, 0.28);
        this.fog.near = 0.5;
        this.fog.far = 28;
      } else {
        this.fog.color.copy(this.sky.fogColor);
        const vis = this.gameplay.visibility;
        this.fog.near = 60 * vis;
        this.fog.far = Math.max(50, p.viewDistance * CHUNK_SIZE * vis);
      }
    }
    this.water.update(this.elapsed, this.camera.position);
    if (!inCave) this.sky.apply(this.camera.position);

    this.model.setVisible(this.cam.mode === 'third' || this.cam.introActive);
    const mv = Math.hypot(this.character.vx, this.character.vz);
    const faceYaw = mv > 0.3 ? Math.atan2(-this.character.vx, -this.character.vz) : this.cam.yaw;
    this.model.update(frameDt, f, faceYaw, { ...cs, speed: cs.speed }, s.reducedMotion);

    this.renderScene(frameDt, s);
    this.updateAudio(frameDt, { biome: this.terrain.biomeAt(f.x, f.z), underwater });
    this.afterFrame(frameDt, f, underwater);
  }

  private renderScene(dt: number, s: ReturnType<typeof settingsStore.getState>): void {
    if (this.post.active) this.post.render(dt);
    else this.renderer.render(this.scene, this.camera);
    void s;
  }

  /** Slow circling camera behind the main menu. */
  private flythrough(dt: number): void {
    this.menuT += dt;
    const c = this.spawnPoint;
    const a = this.menuT * 0.04;
    const r = 90;
    const x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r;
    const y = Math.max(this.terrain.heightAt(x, z) + 14, WATER_Y + 12) + Math.sin(this.menuT * 0.2) * 3;
    this.camera.position.set(x, y, z);
    this.camera.lookAt(c.x, this.terrain.heightAt(c.x, c.z) + 6, c.z);
    this.sky.timeScale = 6;
    this.sky.update(dt, this.camera.position);
    this.chunks.update(x, z, 2);
    this.sky.apply(this.camera.position);
    this.fog.color.copy(this.sky.fogColor);
    this.water.update(this.elapsed + this.menuT, this.camera.position);
    this.model.setVisible(false);
  }
  private menuT = 0;

  private terrainAbove(p: THREE.Vector3): boolean {
    return this.terrain.heightAt(p.x, p.z) > p.y;
  }

  private afterFrame(dt: number, f: { x: number; y: number; z: number }, underwater: boolean): void {
    const s = settingsStore.getState();
    // Adaptive resolution: adjust every 45 frames from average frame time.
    this.frameTimes.push(dt);
    if (this.frameTimes.length >= 45) {
      const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
      this.frameTimes.length = 0;
      if (s.adaptiveResolution) {
        const max = Math.min(window.devicePixelRatio, effectivePreset(s).pixelRatio);
        const min = Math.max(0.5, max * 0.5);
        let pr = this.pixelRatio;
        if (avg > 1 / 40) pr = Math.max(min, pr - 0.1);
        else if (avg < 1 / 58) pr = Math.min(max, pr + 0.05);
        if (Math.abs(pr - this.pixelRatio) > 0.01) {
          this.pixelRatio = pr;
          this.renderer.setPixelRatio(pr);
          this.resize();
        }
      }
    }
    this.fpsAccum.t += dt; this.fpsAccum.n++;
    this.hudTimer += dt;
    if (this.hudTimer >= 0.25) {
      this.hudTimer = 0;
      const fps = this.fpsAccum.n / Math.max(this.fpsAccum.t, 1e-6);
      this.fpsAccum = { t: 0, n: 0 };
      const cs = this.character.state;
      const fwd = new THREE.Vector3();
      this.camera.getWorldDirection(fwd);
      gameStore.setState({
        pointerLocked: this.input.locked,
        cameraMode: this.cam.mode,
        introActive: this.cam.introActive,
        biome: this.terrain.biomeAt(f.x, f.z),
        inCave: !!this.cave,
        underwater,
        swimming: cs.swimming,
        climbing: cs.climbing,
        timeOfDay: this.sky.timeOfDay,
        heading: Math.atan2(fwd.x, -fwd.z),
        x: f.x, y: f.y, z: f.z,
        fps: Math.round(fps),
        pixelRatio: Math.round(this.pixelRatio * 100) / 100,
        chunks: this.chunks.loadedCount,
      });
    }
  }

  dispose(): void {
    this.disposed = true;
    this.loop.stop();
    this.session?.dispose();
    this.gameplay.dispose();
    this.audio.dispose();
    this.post.dispose();
    document.removeEventListener('pointerlockchange', this.onLockChange);
    this.unsubSettings();
    this.resizeObs.disconnect();
    this.input.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
