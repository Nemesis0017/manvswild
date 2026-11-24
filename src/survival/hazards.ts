import { clamp } from '../world/rng';
import type { Biome } from '../world/terrain';

/** Deterministic river-ish current vector in m/s for a swimmer at (x, z). Strong near deep, fast water. */
export function currentAt(x: number, z: number, riverStrength: number, time: number): { x: number; z: number } {
  const a = Math.sin(x * 0.013 + time * 0.02) * 1.4 + Math.cos(z * 0.011) * 1.1;
  const s = clamp(riverStrength, 0, 1) * 1.8;
  return { x: Math.cos(a) * s, z: Math.sin(a) * s };
}

/** Chance per second that loose rock lets go for a climber (or walker on a steep mountain slope). */
export function rockfallChancePerSecond(biome: Biome, climbing: boolean, slope: number, weatherSeverity: number, rainy: boolean): number {
  if (biome !== 'mountain' && biome !== 'snow') return 0;
  let p = climbing ? 0.03 : slope > 1 ? 0.012 : 0;
  if (rainy) p *= 2.5;
  return p * Math.max(0.5, weatherSeverity);
}

export interface RockFall {
  /** Where the rock will land. */
  x: number; z: number;
  /** Seconds until impact. */
  timer: number;
}

export const ROCKFALL_RADIUS = 2.4;
export const ROCKFALL_WARNING = 1.4;

/** Whether the player is still inside the impact radius when the rock lands. */
export function rockHits(rock: RockFall, px: number, pz: number): boolean {
  return Math.hypot(rock.x - px, rock.z - pz) < ROCKFALL_RADIUS;
}

export const ROCK_DAMAGE = 12;
