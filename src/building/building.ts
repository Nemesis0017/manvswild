import { clamp } from '../world/rng';
import { WATER_Y } from '../world/terrain';
import type { BuildKind } from '../items/crafting';
import type { Inventory } from '../items/inventory';

export interface PieceDef {
  kind: BuildKind;
  name: string;
  /** Footprint radius in meters. */
  radius: number;
  /** Max terrain slope (rise over run) for placement. */
  maxSlope: number;
  maxDurability: number;
  /** Seconds of decay budget: durability lost per second in bad weather. */
  weatherWear: number;
}

export const PIECES: Record<BuildKind, PieceDef> = {
  campfire: { kind: 'campfire', name: 'Campfire', radius: 0.9, maxSlope: 0.35, maxDurability: 100, weatherWear: 0 },
  shelter: { kind: 'shelter', name: 'Shelter', radius: 2.2, maxSlope: 0.45, maxDurability: 100, weatherWear: 0.05 },
  sleeping_area: { kind: 'sleeping_area', name: 'Sleeping Area', radius: 1.1, maxSlope: 0.3, maxDurability: 100, weatherWear: 0.01 },
  storage: { kind: 'storage', name: 'Storage Box', radius: 0.8, maxSlope: 0.4, maxDurability: 100, weatherWear: 0.005 },
};

export const MAX_BUILD_DISTANCE = 6;
export const CAMPFIRE_HEAT_RADIUS = 7;
export const CAMPFIRE_MAX_WARMTH = 15;
export const FUEL_PER_WOOD = 180;
export const MAX_FUEL = 900;
export const SLEEP_RADIUS = 2.6;
export const STORAGE_SLOTS = 12;

export interface Piece {
  id: number;
  kind: BuildKind;
  x: number; y: number; z: number;
  yaw: number;
  durability: number;
  /** Campfire fuel in seconds. */
  fuel: number;
}

export interface SiteInfo {
  height: number;
  slope: number;
  inWater: boolean;
  inCave: boolean;
}

export interface Validity { valid: boolean; reason: string }

/** Whether a piece of this kind can be placed at (x,z), given the surroundings. Pure. */
export function validatePlacement(
  kind: BuildKind, x: number, z: number, site: SiteInfo, existing: Piece[],
  player: { x: number; z: number }, hasMaterials: boolean,
): Validity {
  const def = PIECES[kind];
  if (Math.hypot(x - player.x, z - player.z) > MAX_BUILD_DISTANCE) return { valid: false, reason: 'Too far away' };
  if (site.inCave) return { valid: false, reason: 'Cannot build in the cave' };
  if (site.inWater || site.height < WATER_Y + 0.25) return { valid: false, reason: 'Too close to water' };
  if (site.slope > def.maxSlope) return { valid: false, reason: 'Ground is too steep' };
  for (const p of existing) {
    const min = def.radius + PIECES[p.kind].radius;
    // Campfires may sit inside a shelter's footprint (shelters only block each other and sleeping areas).
    const allowedOverlap = (kind === 'campfire' && p.kind === 'shelter') || (kind === 'shelter' && p.kind === 'campfire')
      || (kind === 'sleeping_area' && p.kind === 'shelter') || (kind === 'shelter' && p.kind === 'sleeping_area')
      || (kind === 'storage' && p.kind === 'shelter') || (kind === 'shelter' && p.kind === 'storage');
    const limit = allowedOverlap ? Math.max(def.radius, PIECES[p.kind].radius) * 0.45 : min;
    if (Math.hypot(p.x - x, p.z - z) < limit) return { valid: false, reason: 'Something is in the way' };
  }
  if (!hasMaterials) return { valid: false, reason: 'Missing materials' };
  return { valid: true, reason: 'Click or press E to place' };
}

/** Terrain tilt for aligning a piece: returns pitch/roll radians from four height samples around the spot. */
export function alignToTerrain(hE: number, hW: number, hN: number, hS: number, spread: number, maxTilt = 0.3): { pitch: number; roll: number } {
  const roll = clamp(Math.atan2(hW - hE, 2 * spread), -maxTilt, maxTilt);
  const pitch = clamp(Math.atan2(hS - hN, 2 * spread), -maxTilt, maxTilt);
  return { pitch, roll };
}

export function createPiece(id: number, kind: BuildKind, x: number, y: number, z: number, yaw: number): Piece {
  return { id, kind, x, y, z, yaw, durability: PIECES[kind].maxDurability, fuel: kind === 'campfire' ? FUEL_PER_WOOD * 1.5 : 0 };
}

export interface BuildingEffects {
  /** Degrees of effective warmth at the point. */
  warmth: number;
  /** 0..1 brightness from campfires at the point. */
  light: number;
  sheltered: boolean;
  nearLitCampfire: boolean;
  nearSleepSpot: boolean;
}

export const isLit = (p: Piece): boolean => p.kind === 'campfire' && p.fuel > 0;

/** Effects of nearby pieces at a point. Pure. */
export function effectsAt(pieces: Piece[], x: number, z: number): BuildingEffects {
  let warmth = 0, light = 0, sheltered = false, nearFire = false, sleep = false;
  for (const p of pieces) {
    const d = Math.hypot(p.x - x, p.z - z);
    if (p.kind === 'campfire' && isLit(p)) {
      if (d < CAMPFIRE_HEAT_RADIUS) {
        warmth += CAMPFIRE_MAX_WARMTH * (1 - d / CAMPFIRE_HEAT_RADIUS);
        light = Math.max(light, 1 - d / (CAMPFIRE_HEAT_RADIUS * 1.6));
      }
      if (d < 3.2) nearFire = true;
    } else if (p.kind === 'shelter' && d < PIECES.shelter.radius * 0.85) {
      sheltered = true;
    } else if (p.kind === 'sleeping_area' && d < SLEEP_RADIUS) {
      sleep = true;
    }
  }
  return { warmth: Math.min(warmth, CAMPFIRE_MAX_WARMTH), light, sheltered, nearLitCampfire: nearFire, nearSleepSpot: sleep };
}

/** Burn fuel and weather wear. Returns ids of pieces that were destroyed. */
export function tickPieces(pieces: Piece[], dt: number, rain: number, wind: number, severity: number): number[] {
  const destroyed: number[] = [];
  for (const p of pieces) {
    if (p.kind === 'campfire' && p.fuel > 0) {
      const sheltered = pieces.some((s) => s.kind === 'shelter' && Math.hypot(s.x - p.x, s.z - p.z) < PIECES.shelter.radius * 0.85);
      const wet = sheltered ? 0 : rain;
      p.fuel = Math.max(0, p.fuel - dt * (1 + wet * 2.5));
      // A violent storm can drown an exposed fire.
      if (!sheltered && rain > 0.9 && wind > 0.6 * severity && p.fuel < 40) p.fuel = 0;
    }
    const def = PIECES[p.kind];
    if (def.weatherWear > 0) p.durability -= def.weatherWear * (rain + wind) * severity * dt;
    if (p.durability <= 0) destroyed.push(p.id);
  }
  return destroyed;
}

/** Add wood to a campfire from the inventory. */
export function refuel(p: Piece, inv: Inventory): boolean {
  if (p.kind !== 'campfire' || p.fuel >= MAX_FUEL || !inv.remove('wood', 1)) return false;
  p.fuel = Math.min(MAX_FUEL, p.fuel + FUEL_PER_WOOD);
  return true;
}

/** Repair a shelter using branches and leaves. */
export function repair(p: Piece, inv: Inventory): boolean {
  if (p.kind === 'campfire' || p.durability >= PIECES[p.kind].maxDurability) return false;
  if (!inv.has('branch', 1) || !inv.has('leaf', 2)) return false;
  inv.remove('branch', 1);
  inv.remove('leaf', 2);
  p.durability = Math.min(PIECES[p.kind].maxDurability, p.durability + 35);
  return true;
}
