import * as THREE from 'three';
import type { InputManager } from '../core/input';
import { events } from '../core/events';
import { PIECES, MAX_BUILD_DISTANCE, alignToTerrain, createPiece, effectsAt, isLit, refuel, repair, tickPieces, validatePlacement, STORAGE_SLOTS, type Piece } from '../building/building';
import { makeGhost, makePieceMesh, setGhostValid, type PieceMesh } from '../building/pieceView';
import type { CharacterController } from '../physics/character';
import type { PlayerCamera } from '../player/camera';
import { RECIPES, craft, craftBlocker, describeInputs, hasInputs, missingSkill, payBuildCost, recipeById, type BuildKind } from '../items/crafting';
import { Inventory, equipFromSlot, unequip } from '../items/inventory';
import { HOTBAR_SLOTS, ITEMS, type ItemId } from '../items/items';
import { NODE_DEFS, NodeRegistry, rollDrops, weatherYield, type WorldNode } from '../items/nodes';
import { NodeView } from '../items/nodeView';
import { SKILL_NAMES, addXp, createSkills, skillLevel, type SkillId } from '../items/skills';
import { DIFFICULTIES, type DifficultyId } from '../survival/difficulty';
import { ROCKFALL_WARNING, ROCK_DAMAGE, currentAt, rockHits, rockfallChancePerSecond, type RockFall } from '../survival/hazards';
import {
  acceptRescue, addInjury, applyDamage, createSurvival, fallDamage, hudWarnings, movementMultiplier,
  slipperyFactor, tickFailure, tickSurvival, type SurvivalEnv, type SurvivalState,
} from '../survival/survival';
import { WildlifeManager } from '../wildlife/animalView';
import { SPECIES } from '../wildlife/ai';
import { Sky } from '../world/sky';
import { WATER_Y, type Terrain } from '../world/terrain';
import { windStrength } from '../world/vegetation';
import { CAVE_TEMPERATURE, WEATHER_NAMES, WeatherMachine, ambientTemperature, type WeatherEffects, type WeatherId } from '../world/weather';
import { WeatherFx } from '../world/weatherFx';
import { mulberry32, hashInts } from '../world/rng';
import { hudStore, type Panel, type RecipeView } from './hudStore';

const TOOL_KIND: Partial<Record<ItemId, 'wood' | 'plant'>> = { stone_axe: 'wood', stone_knife: 'plant' };
const BUILD_ORDER: BuildKind[] = ['campfire', 'shelter', 'sleeping_area', 'storage'];
const REST_TIME_SCALE = 6;
const INTERACT_RANGE = 3.2;

export interface MoveModifiers {
  speedMul: number;
  current: { x: number; z: number };
  /** Player cannot move (resting, failing, or UI open). */
  lockMovement: boolean;
  /** Character is frozen in place (resting or failing). */
  freeze: boolean;
}

interface Projectile { mesh: THREE.Mesh; from: THREE.Vector3; to: THREE.Vector3; t: number }
interface FallingRock { rock: RockFall; mesh: THREE.Mesh; startY: number; groundY: number; px: number; pz: number }
interface Fishing { phase: 'idle' | 'waiting' | 'bite'; t: number; biteAt: number }

/**
 * Glue between the world, the player and all survival systems: needs, items, crafting,
 * building, weather and wildlife. Pure rules live in src/survival, src/items, src/building,
 * src/wildlife and src/world/weather; this class applies them to the running game.
 */
export class Gameplay {
  readonly group = new THREE.Group();
  survival: SurvivalState = createSurvival();
  inventory = new Inventory();
  skills = createSkills();
  pieces: Piece[] = [];
  difficulty: DifficultyId = 'survivor';
  weather: WeatherMachine;
  fx: WeatherEffects;
  readonly wildlife: WildlifeManager;
  readonly weatherFx: WeatherFx;
  readonly nodes: NodeRegistry;
  private nodeView: NodeView;
  private storages = new Map<number, Inventory>();
  private openStorage = -1;
  private pieceMeshes = new Map<number, PieceMesh>();
  private nextPieceId = 1;
  private selected = 0;
  private panel: Panel = 'none';
  private building: { kind: BuildKind; yaw: number; ghost: PieceMesh; valid: boolean; reason: string; x: number; z: number; y: number } | null = null;
  private resting = false;
  private fishing: Fishing = { phase: 'idle', t: 0, biteAt: 0 };
  private projectiles: Projectile[] = [];
  private rocks: FallingRock[] = [];
  private smoke: { group: THREE.Group; until: number } | null = null;
  private campLight = new THREE.PointLight(0xff9a40, 0, 22, 1.6);
  private torchLight = new THREE.PointLight(0xffb060, 0, 16, 1.6);
  private gameTime = 0;
  private hudTimer = 0;
  private msgId = 1;
  private messages: { id: number; text: string; until: number }[] = [];
  private lastWarn = new Map<string, number>();
  private stagger = 0;
  private rng: () => number;
  private modifiers: MoveModifiers = { speedMul: 1, current: { x: 0, z: 0 }, lockMovement: false, freeze: false };
  private prompt = '';
  private target: { kind: 'node'; node: WorldNode } | { kind: 'piece'; piece: Piece } | { kind: 'water' } | null = null;
  private inCave = false;
  private tmpDir = new THREE.Vector3();
  private tmpEye = new THREE.Vector3();
  private rockGeo = new THREE.IcosahedronGeometry(0.7, 0);
  private rockMat = new THREE.MeshLambertMaterial({ color: 0x77736c });
  private onLanded = (e: { speed: number }) => this.handleLanding(e.speed);
  private unsubLanded: () => void;
  private lastHudFlash = 0;
  /** Debug and test access: how many animal strikes the player has absorbed. */
  strikesTaken = 0;

  constructor(
    scene: THREE.Scene,
    private terrain: Terrain,
    private character: CharacterController,
    private cam: PlayerCamera,
    private sky: Sky,
    private seed: number,
    private spawn: { x: number; z: number },
  ) {
    this.rng = mulberry32(hashInts(seed, 99, 3));
    this.weather = new WeatherMachine(mulberry32(hashInts(seed, 5, 5)), 'clear');
    this.fx = this.weather.effects('grassland', 1);
    this.wildlife = new WildlifeManager(terrain, seed);
    this.weatherFx = new WeatherFx(seed);
    this.nodes = new NodeRegistry(terrain, seed);
    this.nodeView = new NodeView(this.nodes);
    this.group.add(this.wildlife.group, this.nodeView.group, this.weatherFx.group, this.campLight, this.torchLight);
    scene.add(this.group);
    this.unsubLanded = events.on('playerLanded', this.onLanded);
    this.weatherFx.onThunder = () => {
      this.say('Thunder rumbles in the distance.');
    };
    this.giveStartingItems();
    this.publish();
  }

  get mods() { return DIFFICULTIES[this.difficulty]; }
  get time() { return this.gameTime; }
  get currentWeather(): WeatherId { return this.weather.current; }

  private giveStartingItems(): void {
    this.inventory.add('waterskin', 1);
    this.inventory.add('berries', 4);
    this.inventory.add('branch', 2);
  }

  setDifficulty(id: DifficultyId): void {
    this.difficulty = id;
    this.publish();
  }

  /** Start over after the expedition ended. */
  restart(): void {
    this.survival = createSurvival();
    this.inventory = new Inventory();
    this.skills = createSkills();
    for (const m of this.pieceMeshes.values()) this.group.remove(m.root);
    this.pieceMeshes.clear();
    this.pieces = [];
    this.storages.clear();
    this.nodes.load({});
    this.nodeView.markDirty();
    this.weather = new WeatherMachine(mulberry32(hashInts(this.seed, 5, this.gameTime | 0)), 'clear');
    this.resting = false;
    this.sky.timeScale = 1;
    this.setPanel('none');
    this.cancelBuild();
    this.giveStartingItems();
    this.respawn();
    this.say('A new expedition begins.');
    this.publish();
  }

  private respawn(): void {
    this.character.frozen = false;
    const y = this.terrain.heightAt(this.spawn.x, this.spawn.z);
    this.character.teleport(this.spawn.x, y + 0.6, this.spawn.z);
  }

  /** Called by the rescue modal. */
  acceptRescue(): void {
    if (acceptRescue(this.survival)) {
      this.respawn();
      this.say('A rescue team found you, patched you up and brought you back to the trail.');
      this.publish();
    }
  }

  // ---------- Messages and UI state ----------
  say(text: string): void {
    this.messages.push({ id: this.msgId++, text, until: this.gameTime + 6 });
    if (this.messages.length > 5) this.messages.shift();
  }

  private warnOnce(text: string, cooldown = 25): void {
    const last = this.lastWarn.get(text) ?? -1e9;
    if (this.gameTime - last > cooldown) {
      this.lastWarn.set(text, this.gameTime);
      this.say(text);
    }
  }

  setPanel(p: Panel): void {
    this.panel = p;
    if (p !== 'storage') this.openStorage = -1;
    this.publish();
  }

  get panelOpen(): boolean { return this.panel !== 'none'; }
  get panelName(): Panel { return this.panel; }

  togglePanel(): void {
    this.setPanel(this.panel === 'none' ? 'inventory' : 'none');
  }

  // ---------- Per-frame ----------
  /** Compute movement modifiers before the character moves this tick. */
  preMove(): MoveModifiers {
    const s = this.survival;
    const f = this.character.feet;
    const slope = this.terrain.slopeAt(f.x, f.z, 0.8);
    const biome = this.terrain.biomeAt(f.x, f.z);
    const icy = biome === 'snow' || this.fx.snow > 0.3;
    const grip = slipperyFactor(s.wetness, this.fx.rain + this.fx.snow, slope, icy);
    const enc = this.inventory.totalWeight() / this.inventory.weightLimit;
    let speedMul = movementMultiplier(s, enc) * this.fx.movement * grip;
    const held = this.held();
    if (held?.id === 'raft' && this.character.state.swimming) speedMul *= 1.6;
    const river = this.inCave ? 0 : this.terrain.sample(f.x, f.z).river;
    const current = this.character.state.swimming ? currentAt(f.x, f.z, river, this.gameTime) : { x: 0, z: 0 };
    const failing = s.phase !== 'alive';
    this.modifiers = {
      speedMul,
      current,
      lockMovement: this.resting || failing || this.panel !== 'none',
      freeze: this.resting || failing,
    };
    return this.modifiers;
  }

  held() {
    const st = this.inventory.slots[this.selected];
    return st ?? null;
  }

  /** Handle player input actions for the frame (called while the game is running). */
  handleInput(inp: InputManager, camera: THREE.Camera): void {
    const s = this.survival;
    if (s.phase !== 'alive') return;
    if (inp.wasPressed('inventory')) this.togglePanel();
    if (this.panel !== 'none') return;

    for (let i = 0; i < HOTBAR_SLOTS; i++) {
      if (inp.codePressed(`Digit${i + 1}`)) {
        if (this.building) {
          const k = BUILD_ORDER[i];
          if (k) this.startBuild(k);
        } else {
          this.selected = i;
          this.cancelFishing();
        }
      }
    }

    if (inp.wasPressed('build')) {
      if (this.building) this.cancelBuild();
      else this.startBuild('campfire');
    }
    if (this.building) {
      if (inp.wasPressed('rotate')) this.building.yaw += Math.PI / 4;
      if (inp.wasPressed('secondary')) this.cancelBuild();
      if (inp.wasPressed('primary') || inp.wasPressed('interact')) this.placeBuild();
      return;
    }

    if (inp.wasPressed('rest')) this.toggleRest();
    if (this.resting) {
      const axes = inp.moveAxes();
      if (axes.x !== 0 || axes.y !== 0 || inp.wasPressed('jump')) this.stopRest('You get up.');
      return;
    }
    if (inp.wasPressed('throw')) this.throwStone(camera);
    if (inp.wasPressed('use') || inp.wasPressed('primary')) this.useSelected(camera);
    if (inp.wasPressed('interact')) this.interact(camera);
  }

  update(dt: number, camera: THREE.Camera, playing: boolean): void {
    if (!playing) return;
    this.gameTime += dt;
    const f = this.character.feet;
    const cs = this.character.state;
    const biome = this.terrain.biomeAt(f.x, f.z);
    const mods = this.mods;
    const s = this.survival;
    this.inCave = this.character.underground;

    // Weather and ambient temperature
    this.weather.update(dt, biome, this.sky.timeOfDay);
    this.fx = this.weather.effects(biome, mods.weatherSeverity);
    this.sky.overcast = this.inCave ? 0 : this.fx.cloudCover;
    this.sky.dim = this.inCave ? 0 : this.fx.dim;
    windStrength.value += (this.fx.wind - windStrength.value) * Math.min(1, dt * 0.5);
    const ambient = this.inCave
      ? CAVE_TEMPERATURE
      : ambientTemperature(biome, this.sky.timeOfDay, f.y, this.fx.tempOffset);

    // Buildings
    const bfx = effectsAt(this.pieces, f.x, f.z);
    const destroyed = tickPieces(this.pieces, dt, this.inCave ? 0 : this.fx.rain + this.fx.snow * 0.5, this.fx.wind, mods.weatherSeverity);
    for (const id of destroyed) this.removePiece(id, true);
    let warmth = bfx.warmth;
    const held = this.held();
    if (held?.id === 'torch') {
      warmth += 3;
      if (this.inventory.wear(this.selected, dt)) this.say('Your torch burned out.');
    }

    const body = this.inventory.equipment.body;
    const bodyDef = body ? ITEMS[body.id] : null;
    const precip = this.inCave ? 0 : Math.max(this.fx.rain, this.fx.snow);
    const swimming = cs.swimming;
    const onRaft = swimming && held?.id === 'raft';
    if (onRaft && this.inventory.wear(this.selected, dt * 0.2)) this.say('Your raft fell apart.');
    const env: SurvivalEnv = {
      ambient, warmth,
      sheltered: bfx.sheltered || this.inCave,
      precipitation: precip,
      wind: this.inCave ? 0 : this.fx.wind,
      insulation: bodyDef?.insulation ?? 0,
      rainProof: bodyDef?.rainProof ?? 0,
      swimming, moving: cs.speed > 0.5, sprinting: cs.sprinting && cs.speed > 1, crouching: cs.crouching,
      climbing: cs.climbing, resting: this.resting, onRaft,
      encumbrance: this.inventory.totalWeight() / this.inventory.weightLimit,
    };
    const res = tickSurvival(s, env, dt, mods);
    for (const w of res.warnings) this.warnOnce(w, 30);
    if (s.phase === 'alive') {
      if (s.thirst < 15) this.warnOnce('You are very thirsty. Find water.', 60);
      if (s.hunger < 15) this.warnOnce('You are starving. Find food.', 60);
    }
    if (s.phase === 'fading') {
      if (this.resting) this.stopRest('');
      tickFailure(s, dt, mods);
    }
    if (this.resting) {
      // Resting ends when rested, or when the weather turns bad without cover.
      if (s.fatigue <= 5) this.stopRest('You wake up rested.');
      else if (res.damage > 0) this.stopRest('You wake up in discomfort.');
      else if (!bfx.sheltered && !bfx.nearSleepSpot) this.stopRest('');
    }

    this.updateRocks(dt, biome, cs.climbing);
    this.updateWildlife(dt, f, cs);
    this.updateProjectiles(dt);
    this.updateFishing(dt, camera);
    this.updateTarget(camera);
    this.updateLights(held?.id === 'torch', f);
    this.updateSmoke(dt);

    this.stagger = Math.max(0, this.stagger - dt);
    this.hudTimer += dt;
    if (this.hudTimer > 0.12) {
      this.hudTimer = 0;
      if (Math.floor(this.gameTime) % 5 === 0) this.nodeView.markDirty();
      this.nodeView.update(f.x, f.z, this.gameTime);
      this.publish();
    }
  }

  /** Visual updates that run every rendered frame. */
  render(frameDt: number, camera: THREE.PerspectiveCamera, reducedMotion: boolean): void {
    const f = this.character.feet;
    this.wildlife.animate(frameDt, camera.position);
    const sunDir = this.sky.sunDirection;
    this.weatherFx.update(frameDt, camera, this.fx, this.sky.brightness, sunDir, !this.inCave, reducedMotion);
    this.sky.flash = this.weatherFx.flashLevel;
    // Flicker campfire flames
    const t = performance.now() / 1000;
    for (const p of this.pieces) {
      const m = this.pieceMeshes.get(p.id);
      if (m?.flame) {
        m.flame.visible = isLit(p);
        const k = 1 + Math.sin(t * 17 + p.id) * 0.12 + Math.sin(t * 29) * 0.08;
        m.flame.scale.set(1, k, 1);
      }
    }
    this.campLight.intensity *= 0.9 + Math.sin(t * 21) * 0.1 + 0.1;
    void f;
  }

  /** Hide outdoor-only visuals while inside the cave chamber. */
  setCaveVisuals(inCave: boolean): void {
    this.wildlife.group.visible = !inCave;
    this.nodeView.group.visible = !inCave;
    this.weatherFx.group.visible = !inCave;
  }

  /** Camera roll from stagger, radians. */
  cameraRoll(reduced: boolean): number {
    if (reduced || this.stagger <= 0) return 0;
    return Math.sin(this.stagger * 30) * 0.05 * Math.min(1, this.stagger);
  }

  /** Extra visibility factor to scale fog distance. */
  get visibility(): number { return this.inCave ? 1 : this.fx.visibility; }

  // ---------- Hazards ----------
  private handleLanding(speed: number): void {
    if (this.survival.phase !== 'alive') return;
    const dmg = fallDamage(speed, this.mods);
    if (dmg > 0) {
      applyDamage(this.survival, dmg);
      if (speed > 15) addInjury(this.survival, 'sprain', 90, this.mods);
      this.say(speed > 15 ? 'A hard landing. You sprained something.' : 'You land awkwardly.');
      this.stagger = 0.7;
    }
  }

  private updateRocks(dt: number, biome: ReturnType<Terrain['biomeAt']>, climbing: boolean): void {
    const f = this.character.feet;
    if (this.survival.phase === 'alive' && !this.inCave) {
      const slope = this.terrain.slopeAt(f.x, f.z, 1);
      const p = rockfallChancePerSecond(biome, climbing, slope, this.mods.weatherSeverity, this.fx.rain > 0.3);
      if (p > 0 && this.rng() < p * dt) {
        const rock: RockFall = { x: f.x + (this.rng() - 0.5) * 2, z: f.z + (this.rng() - 0.5) * 2, timer: ROCKFALL_WARNING };
        const mesh = new THREE.Mesh(this.rockGeo, this.rockMat);
        mesh.castShadow = true;
        const groundY = this.terrain.heightAt(rock.x, rock.z);
        mesh.position.set(rock.x, groundY + 22, rock.z);
        this.group.add(mesh);
        this.rocks.push({ rock, mesh, startY: groundY + 22, groundY, px: f.x, pz: f.z });
        this.say('Loose rock above! Move!');
      }
    }
    for (let i = this.rocks.length - 1; i >= 0; i--) {
      const r = this.rocks[i];
      r.rock.timer -= dt;
      const k = 1 - Math.max(0, r.rock.timer) / ROCKFALL_WARNING;
      r.mesh.position.y = r.startY + (r.groundY + 0.5 - r.startY) * k * k;
      r.mesh.rotation.x += dt * 6;
      if (r.rock.timer <= 0) {
        if (rockHits(r.rock, f.x, f.z) && this.survival.phase === 'alive') {
          applyDamage(this.survival, ROCK_DAMAGE * this.mods.damage);
          addInjury(this.survival, 'sprain', 40, this.mods);
          this.stagger = 0.9;
          this.say('A rock clips you. You stumble.');
          this.wildlife.addNoise(r.rock.x, r.rock.z, 0.6);
        } else {
          this.say('The rock crashes down just behind you.');
        }
        this.group.remove(r.mesh);
        this.rocks.splice(i, 1);
      }
    }
  }

  // ---------- Wildlife ----------
  private updateWildlife(dt: number, f: { x: number; z: number }, cs: { speed: number; crouching: boolean; sprinting: boolean }): void {
    const tod = this.sky.timeOfDay;
    const evs = this.wildlife.update(dt, {
      playerX: f.x, playerZ: f.z,
      playerSpeed: cs.speed, crouching: cs.crouching, sprinting: cs.sprinting && cs.speed > 1,
      visibility: this.visibility, night: tod < 0.22 || tod > 0.78,
      detectMult: this.mods.detection, noises: [],
    });
    for (const { animal, ev } of evs) {
      const name = SPECIES[animal.species].name;
      if (ev.warned) this.warnOnce(`A ${name.toLowerCase()} has noticed you and is warning you off. Back away slowly, or throw a stone to distract it.`, 12);
      if (ev.strike && this.survival.phase === 'alive') {
        // Defensive push only: knockback, lost breath and a minor strain. No health damage.
        const dx = f.x - animal.x, dz = f.z - animal.z;
        const l = Math.hypot(dx, dz) || 1;
        this.character.push((dx / l) * 10, (dz / l) * 10);
        this.survival.stamina = Math.max(0, this.survival.stamina - 35);
        addInjury(this.survival, 'strain', 30, this.mods);
        this.stagger = 0.8;
        this.strikesTaken++;
        this.say(`The ${name.toLowerCase()} shoves you back and retreats. Keep your distance.`);
      }
    }
    const n = this.wildlife.nearest;
    hudStore.setState({ animal: n && n.dist < 40 ? `${n.name} (${n.state})` : '' });
  }

  private noiseAt(x: number, z: number, loudness: number): void {
    this.wildlife.addNoise(x, z, loudness);
  }

  // ---------- Interaction ----------
  private lookRay(camera: THREE.Camera): { eye: THREE.Vector3; dir: THREE.Vector3 } {
    camera.getWorldPosition(this.tmpEye);
    camera.getWorldDirection(this.tmpDir);
    return { eye: this.tmpEye, dir: this.tmpDir };
  }

  /** Where the view ray meets the water surface within reach, if anywhere. */
  private waterAhead(camera: THREE.Camera): { x: number; z: number } | null {
    const { eye, dir } = this.lookRay(camera);
    if (this.inCave) return null;
    if (this.character.state.swimming) return { x: eye.x, z: eye.z };
    if (dir.y > -0.08 || eye.y < WATER_Y) return null;
    const t = (eye.y - WATER_Y) / -dir.y;
    if (t > 7) return null;
    const x = eye.x + dir.x * t, z = eye.z + dir.z * t;
    return this.terrain.heightAt(x, z) < WATER_Y - 0.2 ? { x, z } : null;
  }

  private updateTarget(camera: THREE.Camera): void {
    this.target = null;
    this.prompt = '';
    if (this.building || this.resting || this.panel !== 'none') return;
    const f = this.character.feet;
    const { dir } = this.lookRay(camera);
    const fx = dir.x, fz = dir.z;
    const fl = Math.hypot(fx, fz) || 1;
    let best = -1;
    const facing = (x: number, z: number) => {
      const dx = x - f.x, dz = z - f.z;
      const d = Math.hypot(dx, dz);
      if (d > INTERACT_RANGE) return -1;
      const dot = (dx * fx + dz * fz) / ((d || 1) * fl);
      return d < 1.2 || dot > 0.6 ? 1 - d / (INTERACT_RANGE + 1) + dot * 0.2 : -1;
    };
    for (const p of this.pieces) {
      if (p.kind === 'sleeping_area') continue;
      const sc = facing(p.x, p.z);
      if (sc > best) { best = sc; this.target = { kind: 'piece', piece: p }; }
    }
    for (const n of this.nodes.near(f.x, f.z, INTERACT_RANGE, this.gameTime)) {
      const sc = facing(n.x, n.z);
      if (sc > best) { best = sc; this.target = { kind: 'node', node: n }; }
    }
    if (!this.target && this.waterAhead(camera)) this.target = { kind: 'water' };

    const t = this.target;
    const held = this.held();
    if (!t) {
      const spot = effectsAt(this.pieces, f.x, f.z);
      if (spot.nearSleepSpot || spot.sheltered) this.prompt = 'R  Rest';
    } else if (t.kind === 'node') {
      const d = NODE_DEFS[t.node.kind];
      this.prompt = `E  ${d.verb} ${d.name.toLowerCase()}`;
    } else if (t.kind === 'piece') {
      const p = t.piece;
      if (p.kind === 'campfire') this.prompt = `E  Add wood (${Math.ceil(p.fuel)}s of fuel)   Craft at the fire: boil water, cook fish`;
      else if (p.kind === 'storage') this.prompt = 'E  Open storage';
      else if (p.kind === 'shelter') this.prompt = `E  Repair shelter (${Math.round(p.durability)}%)`;
    } else {
      if (held?.id === 'fishing_rod') this.prompt = this.fishing.phase === 'bite' ? 'E  Reel in!' : this.fishing.phase === 'waiting' ? 'Waiting for a bite...' : 'E  Cast line';
      else if (this.inventory.has('waterskin')) this.prompt = 'E  Collect water (untreated)';
      else this.prompt = 'E  Drink from the water (untreated)';
    }
  }

  private interact(camera: THREE.Camera): void {
    const t = this.target;
    if (!t) return;
    if (t.kind === 'node') this.gather(t.node);
    else if (t.kind === 'piece') {
      const p = t.piece;
      if (p.kind === 'campfire') {
        if (refuel(p, this.inventory)) this.say('You feed the fire.');
        else this.say(p.fuel >= 900 ? 'The fire is already well stocked.' : 'You need wood to feed the fire.');
      } else if (p.kind === 'storage') {
        this.openStorage = p.id;
        this.setPanel('storage');
      } else if (p.kind === 'shelter') {
        if (repair(p, this.inventory)) this.say('You patch up the shelter.');
        else this.say(p.durability >= 100 ? 'The shelter is in good shape.' : 'Repair needs 1 branch and 2 leaves.');
      }
    } else {
      this.useWater(camera);
    }
    this.publish();
  }

  private gather(node: WorldNode): void {
    const def = NODE_DEFS[node.kind];
    const held = this.held();
    const toolOk = held && TOOL_KIND[held.id] === def.toolKind;
    const toolMult = toolOk ? ITEMS[held!.id].gather ?? 1 : 1;
    const mult = this.mods.yield * weatherYield(node.kind, this.weather.current) * toolMult * (1 + (skillLevel(this.skills.foraging) - 1) * 0.1);
    const drops = rollDrops(node.kind, this.rng, mult);
    const got: string[] = [];
    let leftover = false;
    for (const d of drops) {
      const rest = this.inventory.add(d.id, d.count);
      if (rest > 0) leftover = true;
      if (d.count - rest > 0) got.push(`${d.count - rest} ${ITEMS[d.id].name}`);
    }
    if (got.length === 0) { this.say('You cannot carry any more.'); return; }
    this.nodes.deplete(node, this.gameTime, this.mods.respawn);
    this.nodeView.markDirty();
    if (toolOk && this.inventory.wear(this.selected, 1)) this.say(`Your ${ITEMS[held!.id].name.toLowerCase()} broke.`);
    this.say(`Gathered ${got.join(', ')}.` + (leftover ? ' Some was left behind (too heavy).' : ''));
    this.noiseAt(node.x, node.z, def.toolKind === 'wood' ? 0.5 : 0.2);
    const [skill, xp] = def.xp;
    this.gainXp(skill as SkillId, xp);
  }

  private gainXp(id: SkillId, amount: number): void {
    const lvl = addXp(this.skills, id, amount);
    if (lvl) this.say(`${SKILL_NAMES[id]} skill increased to level ${lvl}.`);
  }

  private useWater(camera: THREE.Camera): void {
    const held = this.held();
    if (held?.id === 'fishing_rod') {
      const fs = this.fishing;
      if (fs.phase === 'idle') {
        fs.phase = 'waiting';
        fs.t = 0;
        const tod = this.sky.timeOfDay;
        const twilight = (tod > 0.2 && tod < 0.33) || (tod > 0.68 && tod < 0.8);
        fs.biteAt = (4 + this.rng() * 6) * (twilight ? 0.6 : 1) * (this.fx.rain > 0.3 ? 0.8 : 1);
        this.say('You cast the line.');
      } else if (fs.phase === 'bite') {
        fs.phase = 'idle';
        if (this.rng() < 0.85) {
          const rest = this.inventory.add('fish_raw', 1);
          this.say(rest ? 'You hooked a fish but cannot carry it.' : 'You caught a fish!');
          this.gainXp('fieldcraft', 3);
        } else this.say('The fish slipped away.');
        if (this.inventory.wear(this.selected, 1)) this.say('Your fishing rod broke.');
      } else this.cancelFishing('You reel in the line.');
      return;
    }
    void camera;
    if (this.inventory.has('waterskin')) {
      if (this.inventory.add('water_dirty', 1) === 0) this.say('You fill your waterskin. Boil or purify it before drinking.');
      else this.say('You cannot carry more water.');
    } else {
      this.applyUse({ thirst: 20, sickChance: 0.5 }, 'You drink from the water.');
    }
  }

  private cancelFishing(msg?: string): void {
    if (this.fishing.phase !== 'idle') {
      this.fishing.phase = 'idle';
      if (msg) this.say(msg);
    }
  }

  private updateFishing(dt: number, camera: THREE.Camera): void {
    const fs = this.fishing;
    if (fs.phase === 'idle') return;
    if (this.held()?.id !== 'fishing_rod' || !this.waterAhead(camera) || this.character.state.speed > 1.5) {
      this.cancelFishing('You reel in the line.');
      return;
    }
    fs.t += dt;
    if (fs.phase === 'waiting' && fs.t >= fs.biteAt) {
      fs.phase = 'bite';
      fs.t = 0;
      this.say('A fish is biting! Press E now.');
    } else if (fs.phase === 'bite' && fs.t > 1.8) {
      fs.phase = 'idle';
      this.say('The fish got away.');
    }
  }

  private applyUse(effect: NonNullable<(typeof ITEMS)[ItemId]['use']>, msg: string): void {
    const s = this.survival;
    if (effect.hunger) s.hunger = Math.min(100, s.hunger + effect.hunger);
    if (effect.thirst) s.thirst = Math.min(100, s.thirst + effect.thirst);
    if (effect.health) s.health = Math.min(100, s.health + effect.health);
    if (effect.sickChance && this.rng() < effect.sickChance) {
      addInjury(s, 'sickness', 90, this.mods);
      this.say('That did not sit well. You feel queasy.');
    } else this.say(msg);
  }

  /** Use the selected hotbar item: eat, drink, wear, signal. */
  useSelected(camera: THREE.Camera): void {
    this.useAt(this.selected, camera);
  }

  /** Use the item in an inventory slot. */
  useAt(index: number, camera: THREE.Camera): void {
    const st = this.inventory.slots[index];
    if (!st || this.survival.phase !== 'alive') return;
    const def = ITEMS[st.id];
    if (def.equip === 'body' || def.equip === 'back') {
      const err = equipFromSlot(this.inventory, index);
      this.say(err ?? `You put on the ${def.name.toLowerCase()}.`);
    } else if (def.use) {
      let effect = def.use;
      if (st.id === 'water_dirty') {
        const pi = this.inventory.find('purifier');
        if (pi >= 0) {
          effect = { thirst: effect.thirst };
          if (this.inventory.wear(pi, 1)) this.say('Your purifier wore out.');
        }
      }
      this.inventory.removeAt(index, 1);
      this.applyUse(effect, st.id.startsWith('water') ? 'You drink.' : `You eat the ${def.name.toLowerCase()}.`);
    } else if (st.id === 'signal_kit') {
      this.raiseSignal(index);
    } else if (st.id === 'stone') {
      this.throwStone(camera);
    } else if (st.id === 'waterskin') {
      this.say('Face a lake or river and press E to fill it.');
    } else if (def.equip === 'hand') {
      if (index < HOTBAR_SLOTS) this.selected = index;
      this.say(`${def.name}: ${def.description}`);
    }
    this.publish();
  }

  /** Take off worn gear by slot (called by the UI). */
  takeOff(slot: 'body' | 'back'): void {
    const err = unequip(this.inventory, slot);
    if (err) this.say(err);
    this.publish();
  }

  private raiseSignal(index: number): void {
    const f = this.character.feet;
    if (this.inCave) { this.say('You need open sky to signal.'); return; }
    this.inventory.removeAt(index, 1);
    const group = new THREE.Group();
    const tex = (() => {
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      const g = c.getContext('2d')!;
      const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, 'rgba(200,200,200,0.8)');
      gr.addColorStop(1, 'rgba(200,200,200,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
      return new THREE.CanvasTexture(c);
    })();
    for (let i = 0; i < 16; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.7 }));
      sp.userData.phase = i / 16;
      group.add(sp);
    }
    group.position.set(f.x, f.y, f.z);
    this.group.add(group);
    this.smoke = { group, until: this.gameTime + 600 };
    this.say('You raise a tall smoke signal. Rescuers may spot it.');
    this.gainXp('fieldcraft', 5);
    events.emit('signalRaised', { x: f.x, z: f.z });
  }

  private updateSmoke(dt: number): void {
    if (!this.smoke) return;
    const t = performance.now() / 1000;
    this.smoke.group.children.forEach((c) => {
      const sp = c as THREE.Sprite;
      const ph = (sp.userData.phase + t * 0.08) % 1;
      sp.position.set(Math.sin(ph * 6 + sp.userData.phase * 9) * (1 + ph * 6), 1 + ph * 70, Math.cos(ph * 5) * (1 + ph * 5));
      sp.scale.setScalar(4 + ph * 18);
      (sp.material as THREE.SpriteMaterial).opacity = 0.7 * (1 - ph);
    });
    if (this.gameTime > this.smoke.until) { this.group.remove(this.smoke.group); this.smoke = null; }
    void dt;
  }

  // ---------- Throwing ----------
  throwStone(camera: THREE.Camera): void {
    if (!this.inventory.has('stone') || this.survival.phase !== 'alive') { this.say('You have no stone to throw.'); return; }
    this.inventory.remove('stone', 1);
    const { eye, dir } = this.lookRay(camera);
    const flat = Math.hypot(dir.x, dir.z) || 1;
    const dist = 12 + Math.max(0, 1 + dir.y) * 6;
    const to = new THREE.Vector3(eye.x + (dir.x / flat) * dist, 0, eye.z + (dir.z / flat) * dist);
    to.y = Math.max(this.terrain.heightAt(to.x, to.z), WATER_Y) + 0.1;
    const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(0.1, 0), this.rockMat);
    this.group.add(mesh);
    this.projectiles.push({ mesh, from: eye.clone(), to, t: 0 });
    this.publish();
  }

  private updateProjectiles(dt: number): void {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.t += dt / 0.9;
      const k = Math.min(1, p.t);
      p.mesh.position.lerpVectors(p.from, p.to, k);
      p.mesh.position.y += Math.sin(k * Math.PI) * 4;
      if (p.t >= 1) {
        // A thrown stone makes a loud, clear noise where it lands.
        this.noiseAt(p.to.x, p.to.z, 1.2);
        this.group.remove(p.mesh);
        p.mesh.geometry.dispose();
        this.projectiles.splice(i, 1);
      }
    }
  }

  // ---------- Rest ----------
  private toggleRest(): void {
    if (this.resting) { this.stopRest('You get up.'); return; }
    const f = this.character.feet;
    const spot = effectsAt(this.pieces, f.x, f.z);
    if (!(spot.nearSleepSpot || spot.sheltered)) { this.say('Build a sleeping area or shelter to rest.'); return; }
    if (this.survival.fatigue < 20) { this.say('You are not tired enough to sleep.'); return; }
    this.resting = true;
    this.sky.timeScale = REST_TIME_SCALE;
    this.say('You lie down to rest. Move or press R to get up.');
  }

  private stopRest(msg: string): void {
    this.resting = false;
    this.sky.timeScale = 1;
    if (msg) this.say(msg);
  }

  // ---------- Building ----------
  private startBuild(kind: BuildKind): void {
    this.cancelBuild();
    const ghost = makeGhost(kind);
    this.group.add(ghost.root);
    this.building = { kind, yaw: this.cam.yaw, ghost, valid: false, reason: '', x: 0, z: 0, y: 0 };
    this.cancelFishing();
  }

  private cancelBuild(): void {
    if (this.building) this.group.remove(this.building.ghost.root);
    this.building = null;
  }

  private buildRecipe(kind: BuildKind) {
    return RECIPES.find((r) => r.build === kind)!;
  }

  /** Update the ghost preview each frame while in build mode. */
  private updateBuildGhost(): void {
    const b = this.building;
    if (!b) return;
    const f = this.character.feet;
    const dist = Math.min(3.6, MAX_BUILD_DISTANCE);
    // Yaw 0 looks toward -Z.
    const x = f.x - Math.sin(this.cam.yaw) * dist, z = f.z - Math.cos(this.cam.yaw) * dist;
    const h = this.terrain.heightAt(x, z);
    const slope = this.terrain.slopeAt(x, z, 1);
    const r = this.buildRecipe(b.kind);
    const hasMaterials = hasInputs(this.inventory, r) && !missingSkill(r, this.skills);
    const v = validatePlacement(b.kind, x, z, { height: h, slope, inWater: this.terrain.isWater(x, z), inCave: this.inCave }, this.pieces, f, hasMaterials);
    let reason = v.reason;
    if (!v.valid && !hasMaterials && missingSkill(r, this.skills)) reason = `Needs ${r.skill!.id} level ${r.skill!.level}`;
    b.valid = v.valid; b.reason = reason; b.x = x; b.z = z; b.y = h;
    b.ghost.root.position.set(x, h, z);
    const s = 0.8;
    const al = alignToTerrain(
      this.terrain.heightAt(x + s, z), this.terrain.heightAt(x - s, z),
      this.terrain.heightAt(x, z - s), this.terrain.heightAt(x, z + s), s,
    );
    b.ghost.root.rotation.set(al.pitch, b.yaw, al.roll, 'YXZ');
    setGhostValid(b.ghost, v.valid);
  }

  private placeBuild(): void {
    const b = this.building;
    if (!b) return;
    this.updateBuildGhost();
    if (!b.valid) { this.say(b.reason); return; }
    const r = this.buildRecipe(b.kind);
    const paid = payBuildCost(this.inventory, r, this.skills);
    if (!paid.ok) { this.say(paid.reason ?? 'Cannot build'); return; }
    const piece = createPiece(this.nextPieceId++, b.kind, b.x, b.y, b.z, b.yaw);
    this.addPiece(piece);
    this.gainXp('crafting', r.xp ?? 2);
    this.say(`${PIECES[b.kind].name} built.`);
    this.noiseAt(b.x, b.z, 0.4);
    this.publish();
  }

  private addPiece(piece: Piece): void {
    this.pieces.push(piece);
    const mesh = makePieceMesh(piece.kind);
    mesh.root.position.set(piece.x, piece.y, piece.z);
    const s = 0.8;
    const al = alignToTerrain(
      this.terrain.heightAt(piece.x + s, piece.z), this.terrain.heightAt(piece.x - s, piece.z),
      this.terrain.heightAt(piece.x, piece.z - s), this.terrain.heightAt(piece.x, piece.z + s), s,
      piece.kind === 'campfire' ? 0 : 0.3,
    );
    mesh.root.rotation.set(al.pitch, piece.yaw, al.roll, 'YXZ');
    this.group.add(mesh.root);
    this.pieceMeshes.set(piece.id, mesh);
    if (piece.kind === 'storage') this.storages.set(piece.id, new Inventory(STORAGE_SLOTS, 200));
  }

  private removePiece(id: number, byWeather: boolean): void {
    const i = this.pieces.findIndex((p) => p.id === id);
    if (i < 0) return;
    const p = this.pieces[i];
    this.pieces.splice(i, 1);
    const m = this.pieceMeshes.get(id);
    if (m) this.group.remove(m.root);
    this.pieceMeshes.delete(id);
    if (byWeather) this.say(`Your ${PIECES[p.kind].name.toLowerCase()} was wrecked by the weather.`);
    if (p.kind === 'storage' && this.openStorage === id) this.setPanel('none');
  }

  // ---------- Lights ----------
  private updateLights(torch: boolean, f: { x: number; y: number; z: number }): void {
    this.torchLight.intensity = torch ? 2.2 + Math.sin(performance.now() / 90) * 0.3 : 0;
    this.torchLight.position.set(f.x, f.y + 1.8, f.z);
    // One shared point light follows the nearest lit campfire.
    let nearest: Piece | null = null, nd = 60;
    for (const p of this.pieces) {
      if (!isLit(p)) continue;
      const d = Math.hypot(p.x - f.x, p.z - f.z);
      if (d < nd) { nd = d; nearest = p; }
    }
    if (nearest) {
      this.campLight.position.set(nearest.x, nearest.y + 1.3, nearest.z);
      this.campLight.intensity = 3.2;
    } else this.campLight.intensity = 0;
  }

  // ---------- Crafting and inventory (UI actions) ----------
  craft(recipeId: string): void {
    const r = recipeById(recipeId);
    if (!r) return;
    if (r.build) {
      this.setPanel('none');
      this.startBuild(r.build);
      return;
    }
    const f = this.character.feet;
    const nearCampfire = effectsAt(this.pieces, f.x, f.z).nearLitCampfire;
    const res = craft(this.inventory, r, { skills: this.skills, nearCampfire });
    if (res.ok) {
      this.say(`Crafted ${ITEMS[res.item!].name}.`);
      if (r.xp) this.gainXp(r.station ? 'fieldcraft' : 'crafting', r.xp);
    } else this.say(res.reason ?? 'Cannot craft that.');
    this.publish();
  }

  selectSlot(i: number): void {
    if (i >= 0 && i < HOTBAR_SLOTS) { this.selected = i; this.cancelFishing(); this.publish(); }
  }

  swapSlots(a: number, b: number): void {
    this.inventory.swap(a, b);
    this.publish();
  }

  dropSlot(i: number): void {
    const st = this.inventory.removeAt(i, 1);
    if (st) this.say(`Dropped ${ITEMS[st.id].name}.`);
    this.publish();
  }

  useSlot(i: number, camera: THREE.Camera): void {
    this.useAt(i, camera);
  }

  /** Move one stack between the open storage and the inventory. */
  transfer(from: 'inv' | 'store', index: number): void {
    const store = this.storages.get(this.openStorage);
    if (!store) return;
    const src = from === 'inv' ? this.inventory : store;
    const dst = from === 'inv' ? store : this.inventory;
    const st = src.slots[index];
    if (!st) return;
    const rest = dst.add(st.id, st.count, st.dur);
    const moved = st.count - rest;
    if (moved <= 0) { this.say('No room.'); return; }
    src.removeAt(index, moved);
    this.publish();
  }

  // ---------- HUD ----------
  private publish(): void {
    const s = this.survival;
    const mods = this.mods;
    const f = this.character.feet;
    const biome = this.terrain.biomeAt(f.x, f.z);
    const ambient = this.inCave ? CAVE_TEMPERATURE : ambientTemperature(biome, this.sky.timeOfDay, f.y, this.fx.tempOffset);
    const hrs = this.sky.timeOfDay * 24;
    const clock = `${String(Math.floor(hrs)).padStart(2, '0')}:${String(Math.floor((hrs % 1) * 60)).padStart(2, '0')}`;
    this.messages = this.messages.filter((m) => m.until > this.gameTime);
    const f2 = this.character.feet;
    const near = effectsAt(this.pieces, f2.x, f2.z).nearLitCampfire;
    const recipes: RecipeView[] = RECIPES.map((r) => ({
      id: r.id, name: r.name, cost: describeInputs(r), description: r.description, build: !!r.build,
      blocker: r.build
        ? (missingSkill(r, this.skills) ? `Needs ${r.skill!.id} level ${r.skill!.level}` : hasInputs(this.inventory, r) ? null : 'Missing materials')
        : craftBlocker(this.inventory, r, { skills: this.skills, nearCampfire: near }),
    }));
    const store = this.storages.get(this.openStorage);
    const fs = this.fishing;
    hudStore.setState({
      health: s.health, hunger: s.hunger, thirst: s.thirst, stamina: s.stamina, temp: s.bodyTemp, fatigue: s.fatigue, wetness: s.wetness,
      warnings: hudWarnings(s),
      assist: mods.hudAssist,
      difficulty: this.difficulty,
      weather: WEATHER_NAMES[this.weather.current] + (this.weather.next ? ' (changing)' : ''),
      ambient, clock,
      hotbar: this.inventory.slots.slice(0, HOTBAR_SLOTS).map((x) => (x ? { ...x } : null)),
      selected: this.selected,
      slots: this.inventory.slots.map((x) => (x ? { ...x } : null)),
      equipment: { ...this.inventory.equipment },
      weight: this.inventory.totalWeight(), weightLimit: this.inventory.weightLimit,
      prompt: this.building ? `${this.building.reason}   (Q rotate, 1-4 piece, right click or B cancel)` : this.prompt,
      messages: this.messages.map((m) => ({ id: m.id, text: m.text })),
      panel: this.panel,
      storage: store ? store.slots.map((x) => (x ? { ...x } : null)) : null,
      build: this.building ? { active: true, kind: PIECES[this.building.kind].name, valid: this.building.valid, reason: this.building.reason, recipeId: this.buildRecipe(this.building.kind).id } : null,
      recipes,
      skills: (Object.keys(SKILL_NAMES) as SkillId[]).map((id) => ({ id, name: SKILL_NAMES[id], level: skillLevel(this.skills[id]) })),
      fade: s.fade, phase: s.phase, failReason: s.failReason,
      rescuesLeft: Math.max(0, mods.rescues - s.rescuesUsed),
      resting: this.resting,
      fishing: fs.phase === 'idle' ? '' : fs.phase === 'bite' ? 'Bite!' : 'Waiting',
      signalActive: !!this.smoke,
    });
  }

  /** Called every frame by the game to keep the ghost preview following the camera. */
  frame(): void {
    this.updateBuildGhost();
    if (this.building && performance.now() - this.lastHudFlash > 100) {
      this.lastHudFlash = performance.now();
      this.publish();
    }
  }

  // ---------- Persistence hooks (used by the save system) ----------
  snapshot() {
    return {
      difficulty: this.difficulty,
      survival: structuredClone(this.survival),
      inventory: this.inventory.serialize(),
      skills: { ...this.skills },
      pieces: this.pieces.map((p) => ({ ...p })),
      storages: Object.fromEntries([...this.storages].map(([k, v]) => [k, v.serialize()])),
      depleted: this.nodes.serialize(),
      gameTime: this.gameTime,
      weather: this.weather.current,
      timeOfDay: this.sky.timeOfDay,
    };
  }

  restore(d: ReturnType<Gameplay['snapshot']>): void {
    this.difficulty = d.difficulty;
    this.survival = structuredClone(d.survival);
    this.inventory = Inventory.deserialize(d.inventory);
    this.skills = { ...d.skills };
    for (const m of this.pieceMeshes.values()) this.group.remove(m.root);
    this.pieceMeshes.clear();
    this.pieces = [];
    this.storages.clear();
    let maxId = 0;
    for (const p of d.pieces) { this.addPiece({ ...p }); maxId = Math.max(maxId, p.id); }
    for (const [k, v] of Object.entries(d.storages)) this.storages.set(+k, Inventory.deserialize(v));
    this.nextPieceId = maxId + 1;
    this.nodes.load(d.depleted);
    this.nodeView.markDirty();
    this.gameTime = d.gameTime;
    this.weather.current = d.weather;
    this.sky.timeOfDay = d.timeOfDay;
    this.publish();
  }

  dispose(): void {
    this.unsubLanded();
    this.weatherFx.dispose();
    this.wildlife.dispose();
  }
}
