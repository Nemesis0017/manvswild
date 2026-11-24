import { hashInts, mulberry32 } from './rng';
import { CHUNK_SIZE, Terrain, WATER_Y } from './terrain';

export interface CaveSite {
  id: string;
  x: number; y: number; z: number;
  /** unit vector pointing out of the hillside */
  dx: number; dz: number;
  /** centre of the underground chamber */
  chamber: { x: number; y: number; z: number };
}

export interface WaterfallSite {
  x: number; z: number;
  /** unit downhill direction along the river channel */
  tx: number; tz: number;
  drop: number;
}

export function caveSiteForChunk(terrain: Terrain, cx: number, cz: number): CaveSite | null {
  const rnd = mulberry32(hashInts(cx, cz, terrain.seed ^ 0xca7e));
  if (rnd() > 0.28) return null;
  for (let i = 0; i < 16; i++) {
    const x = cx * CHUNK_SIZE + 8 + rnd() * (CHUNK_SIZE - 16);
    const z = cz * CHUNK_SIZE + 8 + rnd() * (CHUNK_SIZE - 16);
    const s = terrain.sample(x, z);
    if (s.mountain < 0.35 || s.height < WATER_Y + 8) continue;
    const e = 2;
    const gx = (terrain.heightAt(x + e, z) - terrain.heightAt(x - e, z)) / (2 * e);
    const gz = (terrain.heightAt(x, z + e) - terrain.heightAt(x, z - e)) / (2 * e);
    const slope = Math.hypot(gx, gz);
    if (slope < 0.45 || slope > 1.6) continue;
    // Outward direction is downhill.
    const dx = -gx / slope, dz = -gz / slope;
    return {
      id: `cave:${cx},${cz}`,
      x, y: s.height, z, dx, dz,
      chamber: { x, y: -140 - (Math.abs(cx * 7 + cz * 3) % 5) * 40, z },
    };
  }
  return null;
}

export function waterfallSitesForChunk(terrain: Terrain, cx: number, cz: number, max = 2): WaterfallSite[] {
  const out: WaterfallSite[] = [];
  const rnd = mulberry32(hashInts(cx, cz, terrain.seed ^ 0xfa11));
  for (let tries = 0; tries < 40 && out.length < max; tries++) {
    const x = cx * CHUNK_SIZE + rnd() * CHUNK_SIZE;
    const z = cz * CHUNK_SIZE + rnd() * CHUNK_SIZE;
    const s = terrain.sample(x, z);
    if (s.river < 0.55 || s.mountain < 0.12 || s.height < WATER_Y + 5) continue;
    const e = 1.5;
    const gx = terrain.riverField(x + e, z) - terrain.riverField(x - e, z);
    const gz = terrain.riverField(x, z + e) - terrain.riverField(x, z - e);
    const gl = Math.hypot(gx, gz);
    if (gl < 1e-6) continue;
    let tx = -gz / gl, tz = gx / gl;
    const ha = terrain.heightAt(x - tx * 6, z - tz * 6);
    const hb = terrain.heightAt(x + tx * 6, z + tz * 6);
    if (hb > ha) { tx = -tx; tz = -tz; }
    const drop = Math.abs(ha - hb);
    if (drop < 3) continue;
    out.push({ x, z, tx, tz, drop });
  }
  return out;
}
