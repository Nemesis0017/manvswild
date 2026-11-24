import * as THREE from 'three';
import { gameStore } from './core/gameState';
import { Gameplay } from './gameplay/gameplay';
import { InputManager } from './core/input';
import { GameLoop } from './core/loop';
import { PRESETS, settingsStore } from './core/settings';
import { CharacterController } from './physics/character';
import { PhysicsWorld } from './physics/physics';
import { PlayerCamera } from './player/camera';
import { PlayerModel } from './player/model';
import { CaveInterior, caveOutsidePoint } from './world/caves';
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
    if (!document.pointerLockElement && gameStore.getState().status === 'playing' && !this.gameplay.panelOpen) this.setPaused(true);
  };

  private constructor(private container: HTMLElement, physics: PhysicsWorld) {
    const s = settingsStore.getState();
    const preset = PRESETS[s.preset];
    this.physics = physics;
    this.terrain = new Terrain(s.seed);

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
    this.gameplay = new Gameplay(this.scene, this.terrain, this.character, this.cam, this.sky, s.seed, spawn);

    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(container);
    this.resize();

    this.unsubSettings = settingsStore.subscribe(() => this.applySettings());
    this.applySettings();

    document.addEventListener('pointerlockchange', this.onLockChange);
    this.loop = new GameLoop((dt) => this.update(dt), (dt) => this.render(dt));
    this.loop.start();
  }

  static async create(container: HTMLElement): Promise<Game> {
    gameStore.setState({ status: 'loading', loadMessage: 'Starting physics' });
    const physics = await PhysicsWorld.create();
    gameStore.setState({ loadMessage: 'Generating world' });
    const g = new Game(container, physics);
    gameStore.setState({ status: 'menu', loadMessage: 'Ready' });
    if (location.search.includes('debug')) (window as unknown as { __mvw: Game }).__mvw = g;
    return g;
  }

  /** Begin (or resume) play and, on first start, run the cinematic intro. */
  start(): void {
    if (!this.introPlayed) {
      this.introPlayed = true;
      this.cam.startIntro();
    }
    gameStore.setState({ status: 'playing' });
    this.input.requestLock();
  }

  requestLock(): void {
    this.input.requestLock();
  }

  setPaused(p: boolean): void {
    gameStore.setState({ status: p ? 'paused' : 'playing' });
  }

  skipIntro(): void {
    this.cam.skipIntro();
  }

  private resize(): void {
    const w = this.container.clientWidth || 1, h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private applySettings(): void {
    const s = settingsStore.getState();
    const p = PRESETS[s.preset];
    this.camera.fov = s.fov;
    this.camera.updateProjectionMatrix();
    this.pixelRatio = Math.min(window.devicePixelRatio, p.pixelRatio);
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.shadowMap.enabled = p.shadows;
    this.sky.configureShadows(p.shadowMapSize, p.shadows);
    this.fog.far = p.viewDistance * CHUNK_SIZE;
    this.chunks.setPreset(p);
    this.resize();
  }

  private get paused(): boolean {
    return gameStore.getState().status !== 'playing';
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
    if (this.paused) { inp.endFrame(); return; }

    if (this.cam.introActive) {
      if (inp.wasPressed('jump') || inp.wasPressed('interact')) this.cam.skipIntro();
    }
    if (inp.wasPressed('toggleCamera') && !this.cam.introActive) this.cam.toggle();

    const gp = this.gameplay;
    const playing = !this.cam.introActive;
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
    inp.endFrame();
  }

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
    if (!inCave && !this.paused) {
      this.sky.update(frameDt, this.camera.position);
      this.chunks.update(f.x, f.z, 2);
    }
    this.cam.update(frameDt, f, cs.crouching, cs.swimming);
    this.camera.rotateZ(this.gameplay.cameraRoll(s.reducedMotion));
    this.gameplay.frame();
    this.gameplay.render(frameDt, this.camera, s.reducedMotion);

    // Underwater look.
    const underwater = !inCave && this.camera.position.y < WATER_Y - 0.05 && !this.terrainAbove(this.camera.position);
    if (!inCave) {
      const p = PRESETS[s.preset];
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

    this.renderer.render(this.scene, this.camera);
    this.afterFrame(frameDt, f, underwater);
  }

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
        const max = Math.min(window.devicePixelRatio, PRESETS[s.preset].pixelRatio);
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
    this.gameplay.dispose();
    document.removeEventListener('pointerlockchange', this.onLockChange);
    this.unsubSettings();
    this.resizeObs.disconnect();
    this.input.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
