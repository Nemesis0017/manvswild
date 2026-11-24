import { caveSiteForChunk } from '../world/features';
import { hashInts, mulberry32 } from '../world/rng';
import { CHUNK_SIZE, WATER_Y, type Biome, type Terrain } from '../world/terrain';

export type PoiKind = 'landmark' | 'campsite' | 'cave' | 'summit' | 'extraction' | 'cairn' | 'beacon';

export interface Poi {
  id: string;
  kind: PoiKind;
  name: string;
  x: number; y: number; z: number;
}

export const POI_LABEL: Record<PoiKind, string> = {
  landmark: 'Landmark', campsite: 'Abandoned campsite', cave: 'Cave', summit: 'Summit', extraction: 'Extraction point', cairn: 'Ranger cairn', beacon: 'Beacon',
};

const LANDMARK_NAMES: Record<Biome, string[]> = {
  grassland: ['Split Oak', 'Windy Meadow', 'Shepherd Stone'],
  tropical: ['Strangler Fig', 'Parrot Hollow', 'Mist Grove'],
  desert: ['Red Arch', 'Dry Wash', 'Bone Dune'],
  swamp: ['Heron Flats', 'Black Reeds', 'Sunk Stump'],
  mountain: ['Eagle Ledge', 'Grey Tooth', 'Echo Rock'],
  snow: ['Frost Needle', 'White Hollow', 'Ice Shelf'],
};

const isLand = (t: Terrain, x: number, z: number): boolean => {
  const h = t.heightAt(x, z);
  return h > WATER_Y + 1.2 && h < 40 && t.slopeAt(x, z, 2) < 0.45;
};

/** Find a flat, dry spot near a target angle and radius from the origin. */
function landNear(t: Terrain, ox: number, oz: number, angle: number, radius: number): { x: number; z: number } | null {
  for (let dr = 0; dr < 160; dr += 16) {
    for (let da = 0; da < 0.8; da += 0.1) {
      for (const sgn of [1, -1]) {
        const a = angle + da * sgn, r = radius + dr;
        const x = ox + Math.cos(a) * r, z = oz + Math.sin(a) * r;
        if (isLand(t, x, z)) return { x, z };
      }
    }
  }
  return null;
}

export interface PoiSet {
  all: Poi[];
  cairn: Poi | null;
  summit: Poi | null;
  extraction: Poi | null;
  cave: Poi | null;
  campsites: Poi[];
}

/** Deterministic points of interest for a seed, relative to the spawn point. */
export function generatePois(t: Terrain, spawn: { x: number; z: number }): PoiSet {
  const rnd = mulberry32(hashInts(t.seed, 4242, 1));
  const all: Poi[] = [];
  const push = (p: Poi) => { all.push(p); return p; };
  const at = (x: number, z: number) => t.heightAt(x, z);

  // Ranger cairn: the navigation target, roughly 300 to 450 m away.
  const a0 = rnd() * Math.PI * 2;
  const cp = landNear(t, spawn.x, spawn.z, a0, 300 + rnd() * 150);
  const cairn = cp ? push({ id: 'cairn', kind: 'cairn', name: 'Ranger cairn', x: cp.x, y: at(cp.x, cp.z), z: cp.z }) : null;

  // Landmarks in a spread of directions.
  for (let i = 0; i < 6; i++) {
    const p = landNear(t, spawn.x, spawn.z, a0 + 1 + i * 1.0 + rnd() * 0.4, 200 + rnd() * 700);
    if (!p) continue;
    const biome = t.biomeAt(p.x, p.z);
    const names = LANDMARK_NAMES[biome];
    push({ id: `landmark:${i}`, kind: 'landmark', name: names[i % names.length], x: p.x, y: at(p.x, p.z), z: p.z });
  }

  // Abandoned campsites with salvage.
  const campsites: Poi[] = [];
  for (let i = 0; i < 4; i++) {
    const p = landNear(t, spawn.x, spawn.z, a0 + 0.7 + i * 1.5 + rnd() * 0.5, 160 + rnd() * 500);
    if (p) campsites.push(push({ id: `camp:${i}`, kind: 'campsite', name: 'Abandoned campsite', x: p.x, y: at(p.x, p.z), z: p.z }));
  }

  // Caves: reuse the world generator's cave sites in a radius of chunks.
  const caves: Poi[] = [];
  const R = 12;
  const scx = Math.floor(spawn.x / CHUNK_SIZE), scz = Math.floor(spawn.z / CHUNK_SIZE);
  for (let dx = -R; dx <= R; dx++) {
    for (let dz = -R; dz <= R; dz++) {
      const s = caveSiteForChunk(t, scx + dx, scz + dz);
      if (s) caves.push({ id: s.id, kind: 'cave', name: 'Cave entrance', x: s.x, y: s.y, z: s.z });
    }
  }
  caves.sort((a, b) => Math.hypot(a.x - spawn.x, a.z - spawn.z) - Math.hypot(b.x - spawn.x, b.z - spawn.z));
  for (const c of caves.slice(0, 4)) push(c);
  const cave = caves[0] ?? null;

  // Summit: the highest point on a coarse grid, refined by hill climbing.
  let best = { x: spawn.x, z: spawn.z, h: -1e9 };
  for (let gx = -900; gx <= 900; gx += 30) {
    for (let gz = -900; gz <= 900; gz += 30) {
      const x = spawn.x + gx, z = spawn.z + gz;
      const h = at(x, z);
      if (h > best.h) best = { x, z, h };
    }
  }
  for (let step = 15; step >= 1; step /= 2) {
    for (let k = 0; k < 40; k++) {
      let moved = false;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const x = best.x + dx * step, z = best.z + dz * step;
        const h = at(x, z);
        if (h > best.h) { best = { x, z, h }; moved = true; }
      }
      if (!moved) break;
    }
  }
  const summit = push({ id: 'summit', kind: 'summit', name: 'The Summit', x: best.x, y: best.h, z: best.z });

  // Extraction point on open ground, 500 to 800 m away on the far side from the summit.
  const aSummit = Math.atan2(summit.z - spawn.z, summit.x - spawn.x);
  const ep = landNear(t, spawn.x, spawn.z, aSummit + Math.PI * (0.6 + rnd() * 0.8), 500 + rnd() * 300);
  const extraction = ep ? push({ id: 'extraction', kind: 'extraction', name: 'Extraction point', x: ep.x, y: at(ep.x, ep.z), z: ep.z }) : null;

  return { all, cairn, summit, extraction, cave, campsites };
}

/** Find a dry, flat spawn inside a given biome. Falls back to null if the seed has none nearby. */
export function findBiomeSpawn(t: Terrain, biome: Biome): { x: number; z: number } | null {
  for (let r = 0; r <= 2600; r += 40) {
    const steps = Math.max(1, Math.floor(r / 40));
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const h = t.heightAt(x, z);
      if (h < WATER_Y + 1.2 || h > 140 || t.slopeAt(x, z, 2) > 0.5) continue;
      if (t.biomeAt(x, z) === biome) {
        const w = t.biomeWeights(x, z)[biome];
        if (w > 0.6) return { x, z };
      }
    }
  }
  return null;
}
