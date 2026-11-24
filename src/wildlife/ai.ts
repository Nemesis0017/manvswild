import { hashInts, mulberry32 } from '../world/rng';
import { CHUNK_SIZE, WATER_Y, type Biome, type Terrain } from '../world/terrain';

export type Species = 'deer' | 'rabbit' | 'bird' | 'fish' | 'wolf' | 'bear' | 'snake';
export type AIState = 'wander' | 'feed' | 'rest' | 'investigate' | 'flee' | 'warn' | 'defensive' | 'retreat';

export interface SpeciesDef {
  name: string;
  /** Prey flee. Territorial animals warn, then defend, then retreat. None kill or damage health. */
  behavior: 'prey' | 'territorial';
  walk: number;
  run: number;
  /** Base sight range in meters. */
  detect: number;
  /** How far sounds are heard. */
  hearing: number;
  /** Territorial: distance inside which the animal warns. Prey: flee until this far away. */
  radius: number;
  /** Territorial: seconds of warning before defending. */
  warnTime: number;
  strikeRange: number;
  aquatic?: boolean;
  flying?: boolean;
  /** Weight per biome for spawning. */
  biomes: Partial<Record<Biome, number>>;
  /** Nocturnal animals see better at night. */
  nocturnal?: boolean;
}

export const SPECIES: Record<Species, SpeciesDef> = {
  deer: { name: 'Deer', behavior: 'prey', walk: 1.4, run: 9, detect: 38, hearing: 40, radius: 40, warnTime: 0, strikeRange: 0, biomes: { grassland: 3, tropical: 2, mountain: 0.5 } },
  rabbit: { name: 'Rabbit', behavior: 'prey', walk: 1, run: 8, detect: 22, hearing: 30, radius: 25, warnTime: 0, strikeRange: 0, biomes: { grassland: 3, desert: 1.5, tropical: 1, swamp: 0.5, snow: 1 } },
  bird: { name: 'Bird', behavior: 'prey', walk: 1.5, run: 10, detect: 30, hearing: 40, radius: 45, warnTime: 0, strikeRange: 0, flying: true, biomes: { grassland: 2, tropical: 3, swamp: 2, desert: 1, mountain: 1.5, snow: 0.5 } },
  fish: { name: 'Fish', behavior: 'prey', walk: 0.8, run: 4.5, detect: 9, hearing: 12, radius: 10, warnTime: 0, strikeRange: 0, aquatic: true, biomes: {} },
  wolf: { name: 'Wolf', behavior: 'territorial', walk: 1.8, run: 8, detect: 45, hearing: 55, radius: 24, warnTime: 5, strikeRange: 1.8, nocturnal: true, biomes: { snow: 2, mountain: 1.5, grassland: 0.5 } },
  bear: { name: 'Bear', behavior: 'territorial', walk: 1.5, run: 6.2, detect: 32, hearing: 45, radius: 20, warnTime: 6, strikeRange: 2.2, biomes: { mountain: 1, tropical: 0.6, snow: 0.5, grassland: 0.3 } },
  snake: { name: 'Snake', behavior: 'territorial', walk: 0.7, run: 2.4, detect: 8, hearing: 10, radius: 4.5, warnTime: 2.5, strikeRange: 1.2, biomes: { desert: 2, swamp: 2, tropical: 1.5, grassland: 0.4 } },
};

export interface Animal {
  id: number;
  species: Species;
  x: number; y: number; z: number;
  yaw: number;
  state: AIState;
  stateTime: number;
  /** 0..1 how well it has noticed the player. */
  awareness: number;
  tx: number; tz: number;
  homeX: number; homeZ: number;
  /** Seconds until a territorial animal may act defensively again. */
  cooldown: number;
  /** Stagger animation timer after a defensive push. */
  stagger: number;
  /** Current movement speed in m/s (set by the AI). */
  speed: number;
  /** Seconds the current state should last (0 means until its condition ends). */
  stateLength: number;
}

export interface Noise { x: number; z: number; loudness: number }

export interface Perception {
  playerX: number; playerZ: number;
  /** Player horizontal speed in m/s. */
  playerSpeed: number;
  crouching: boolean;
  sprinting: boolean;
  /** 0..1 weather visibility factor (fog reduces it). */
  visibility: number;
  night: boolean;
  /** Difficulty multiplier on detection range. */
  detectMult: number;
  /** Sounds produced this tick. */
  noises: Noise[];
}

export interface AIEvents {
  /** The animal made a defensive push: player is knocked back, loses stamina, minor strain. No health damage. */
  strike: boolean;
  /** The animal began warning this tick. */
  warned: boolean;
}

export const dist2d = (ax: number, az: number, bx: number, bz: number): number => Math.hypot(ax - bx, az - bz);

/** Effective sight range of an animal given the player's behavior. Crouching and standing still reduce it. */
export function detectionRange(def: SpeciesDef, p: Perception, distracted = false): number {
  let r = def.detect * p.detectMult * p.visibility;
  if (p.crouching) r *= 0.45;
  else if (p.sprinting) r *= 1.7;
  else if (p.playerSpeed < 0.3) r *= 0.7;
  if (p.night) r *= def.nocturnal ? 1.2 : 0.65;
  if (distracted) r *= 0.5;
  return r;
}

export function newAnimal(id: number, species: Species, x: number, y: number, z: number, rng: () => number): Animal {
  return {
    id, species, x, y, z, yaw: rng() * Math.PI * 2, state: 'wander', stateTime: 0, awareness: 0,
    tx: x, tz: z, homeX: x, homeZ: z, cooldown: 0, stagger: 0, speed: 0, stateLength: 0,
  };
}

function setState(a: Animal, s: AIState, length = 0): void {
  a.state = s;
  a.stateTime = 0;
  a.stateLength = length;
}

function pickTarget(a: Animal, rng: () => number, range: number): void {
  const ang = rng() * Math.PI * 2, d = 4 + rng() * range;
  a.tx = a.homeX + Math.cos(ang) * d;
  a.tz = a.homeZ + Math.sin(ang) * d;
}

/**
 * Advance the AI state machine one step. Pure apart from mutating `a`.
 * Sets a.tx/tz (where to go) and a.speed (how fast). Movement is applied by the caller.
 */
export function stepAnimal(a: Animal, p: Perception, dt: number, rng: () => number): AIEvents {
  const def = SPECIES[a.species];
  const ev: AIEvents = { strike: false, warned: false };
  a.stateTime += dt;
  a.cooldown = Math.max(0, a.cooldown - dt);
  a.stagger = Math.max(0, a.stagger - dt);
  const d = dist2d(a.x, a.z, p.playerX, p.playerZ);
  const distracted = a.state === 'investigate';
  const range = detectionRange(def, p, distracted);

  // Awareness builds faster the closer the player is, and fades when out of range.
  if (d < range) {
    const close = 1 - (d / range) * 0.6;
    a.awareness = Math.min(1, a.awareness + dt * 1.2 * close + (d < 3 && !p.crouching ? 1 : 0));
  } else {
    a.awareness = Math.max(0, a.awareness - dt * 0.3);
  }

  // Sounds, such as a thrown stone, draw curiosity and break off warnings.
  let heard: Noise | null = null;
  for (const n of p.noises) {
    const nd = dist2d(a.x, a.z, n.x, n.z);
    if (nd < def.hearing * n.loudness && (!heard || nd < dist2d(a.x, a.z, heard.x, heard.z))) heard = n;
  }
  const calm = a.state === 'wander' || a.state === 'feed' || a.state === 'rest';
  if (heard && !def.aquatic && (calm || a.state === 'warn' || a.state === 'defensive' || a.state === 'investigate')) {
    if (def.behavior === 'prey' && dist2d(a.x, a.z, heard.x, heard.z) < 6) {
      // A sound very close to prey is startling, not interesting.
      a.awareness = 1;
    } else if (a.state !== 'flee') {
      a.tx = heard.x; a.tz = heard.z;
      a.awareness = Math.min(a.awareness, 0.3);
      if (a.state !== 'investigate') setState(a, 'investigate', 7);
    }
  }

  const awareNow = a.awareness >= 1;

  if (def.behavior === 'prey') {
    switch (a.state) {
      case 'flee':
        fleeFrom(a, p, def);
        a.speed = def.run;
        if (a.stateTime > 2 && (d > def.radius || a.awareness < 0.3)) setState(a, 'wander', 4 + rng() * 6);
        break;
      default:
        if (awareNow && d < range) {
          setState(a, 'flee');
          fleeFrom(a, p, def);
          a.speed = def.run;
        } else if (a.state === 'investigate') {
          a.speed = def.walk * 1.4;
          if (a.stateTime > a.stateLength || dist2d(a.x, a.z, a.tx, a.tz) < 1.5) setState(a, 'feed', 4 + rng() * 5);
        } else idle(a, def, rng);
    }
  } else {
    switch (a.state) {
      case 'warn':
        a.speed = 0;
        a.yaw = Math.atan2(p.playerX - a.x, p.playerZ - a.z);
        if (d > def.radius * 1.25 || a.awareness < 0.3) setState(a, 'wander', 5 + rng() * 5);
        else if (a.cooldown <= 0 && (d < def.radius * 0.45 || a.stateTime > def.warnTime)) setState(a, 'defensive', 5);
        break;
      case 'defensive':
        a.tx = p.playerX; a.tz = p.playerZ;
        a.speed = def.run;
        if (d <= def.strikeRange) {
          ev.strike = true;
          a.stagger = 0.8;
          a.cooldown = 14;
          setState(a, 'retreat', 8);
        } else if (a.stateTime > a.stateLength || d > def.radius * 1.5) {
          a.cooldown = 8;
          setState(a, 'retreat', 8);
        }
        break;
      case 'retreat':
        a.tx = a.homeX; a.tz = a.homeZ;
        a.speed = def.walk * 2;
        if (a.stateTime > a.stateLength || dist2d(a.x, a.z, a.homeX, a.homeZ) < 2) {
          a.awareness = 0;
          setState(a, 'wander', 5 + rng() * 5);
        }
        break;
      case 'investigate':
        a.speed = def.walk * 1.5;
        if (awareNow && d < def.radius) { setState(a, 'warn'); ev.warned = true; }
        else if (a.stateTime > a.stateLength || dist2d(a.x, a.z, a.tx, a.tz) < 1.5) setState(a, 'wander', 4 + rng() * 5);
        break;
      default:
        if (awareNow && d < def.radius) {
          setState(a, 'warn');
          a.speed = 0;
          ev.warned = true;
        } else idle(a, def, rng);
    }
  }
  return ev;
}

function fleeFrom(a: Animal, p: Perception, def: SpeciesDef): void {
  const dx = a.x - p.playerX, dz = a.z - p.playerZ;
  const len = Math.hypot(dx, dz) || 1;
  const far = def.radius * 1.5;
  a.tx = a.x + (dx / len) * far;
  a.tz = a.z + (dz / len) * far;
}

/** Wander, feed and rest cycling. */
function idle(a: Animal, def: SpeciesDef, rng: () => number): void {
  switch (a.state) {
    case 'feed':
      a.speed = 0;
      if (a.stateTime > a.stateLength) {
        if (rng() < 0.3) setState(a, 'rest', 8 + rng() * 12);
        else { pickTarget(a, rng, 18); setState(a, 'wander', 6 + rng() * 8); }
      }
      break;
    case 'rest':
      a.speed = 0;
      if (a.stateTime > a.stateLength) { pickTarget(a, rng, 18); setState(a, 'wander', 6 + rng() * 8); }
      break;
    default: {
      if (a.state !== 'wander') setState(a, 'wander', 6 + rng() * 8);
      a.speed = def.walk;
      const arrived = dist2d(a.x, a.z, a.tx, a.tz) < 1.2;
      if (arrived || a.stateTime > a.stateLength) setState(a, rng() < 0.7 ? 'feed' : 'rest', 4 + rng() * 8);
    }
  }
}

/**
 * Move an animal toward its target. `canStand` rejects blocked positions (water for land animals,
 * land for fish); a rejected step makes the animal pick a new home-side target.
 */
export function advanceAnimal(a: Animal, dt: number, canStand: (x: number, z: number) => boolean, rng: () => number): void {
  if (a.speed <= 0) return;
  const dx = a.tx - a.x, dz = a.tz - a.z;
  const len = Math.hypot(dx, dz);
  if (len < 0.05) return;
  const target = Math.atan2(dx, dz);
  let diff = target - a.yaw;
  diff = Math.atan2(Math.sin(diff), Math.cos(diff));
  a.yaw += diff * Math.min(1, dt * (a.state === 'flee' || a.state === 'defensive' ? 10 : 4));
  const step = Math.min(a.speed * dt, len);
  const nx = a.x + Math.sin(a.yaw) * step, nz = a.z + Math.cos(a.yaw) * step;
  if (canStand(nx, nz)) { a.x = nx; a.z = nz; }
  else {
    // Blocked: turn around toward home.
    a.tx = a.homeX + (rng() - 0.5) * 8;
    a.tz = a.homeZ + (rng() - 0.5) * 8;
    if (a.state === 'flee' || a.state === 'defensive') setState(a, 'wander', 3);
  }
}

/** Deterministically choose animals for a chunk. */
export function spawnForChunk(terrain: Terrain, seed: number, cx: number, cz: number): Animal[] {
  const rng = mulberry32(hashInts(seed ^ 0xa11a, cx, cz));
  const out: Animal[] = [];
  const attempts = 3 + Math.floor(rng() * 3);
  for (let n = 0; n < attempts; n++) {
    const x = (cx + rng()) * CHUNK_SIZE, z = (cz + rng()) * CHUNK_SIZE;
    const h = terrain.heightAt(x, z);
    const id = hashInts(cx, cz, n + 1);
    if (h < WATER_Y - 1.2) {
      // Water: fish only.
      if (rng() < 0.7) out.push(newAnimal(id, 'fish', x, WATER_Y - 0.6 - rng() * 0.6, z, rng));
      continue;
    }
    if (h < WATER_Y + 0.4) continue;
    const biome = terrain.biomeAt(x, z);
    const entries = (Object.keys(SPECIES) as Species[])
      .map((s) => [s, SPECIES[s].biomes[biome] ?? 0] as const).filter((e) => e[1] > 0);
    const total = entries.reduce((s, e) => s + e[1], 0);
    if (total <= 0) continue;
    let t = rng() * total;
    let sp: Species = entries[0][0];
    for (const [s, w] of entries) { t -= w; if (t <= 0) { sp = s; break; } }
    out.push(newAnimal(id, sp, x, h, z, rng));
  }
  return out;
}
