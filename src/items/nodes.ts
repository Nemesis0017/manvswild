import { hashInts, mulberry32 } from '../world/rng';
import { CHUNK_SIZE, WATER_Y, type Biome, type Terrain } from '../world/terrain';
import type { ItemId } from './items';
import type { WeatherId } from '../world/weather';

export type NodeKind = 'branches' | 'log' | 'stones' | 'berry_bush' | 'fiber_plant' | 'leaf_plant' | 'wreckage';

export interface NodeDef {
  name: string;
  verb: string;
  /** Drops as [item, min, max]. */
  drops: [ItemId, number, number][];
  /** Which tool multiplier applies: 'wood' = axe, 'plant' = knife. */
  toolKind: 'wood' | 'plant' | 'none';
  /** Respawn seconds at survivor difficulty. */
  respawn: number;
  xp: [string, number];
}

export const NODE_DEFS: Record<NodeKind, NodeDef> = {
  branches: { name: 'Fallen branches', verb: 'Gather', drops: [['branch', 2, 4]], toolKind: 'wood', respawn: 420, xp: ['foraging', 1] },
  log: { name: 'Fallen log', verb: 'Chop', drops: [['wood', 2, 3], ['branch', 0, 2]], toolKind: 'wood', respawn: 600, xp: ['foraging', 2] },
  stones: { name: 'Loose stones', verb: 'Pick up', drops: [['stone', 2, 4]], toolKind: 'none', respawn: 540, xp: ['foraging', 1] },
  berry_bush: { name: 'Berry bush', verb: 'Pick', drops: [['berries', 3, 6], ['leaf', 0, 2]], toolKind: 'plant', respawn: 480, xp: ['foraging', 1] },
  fiber_plant: { name: 'Fibrous plants', verb: 'Harvest', drops: [['fiber', 3, 6]], toolKind: 'plant', respawn: 360, xp: ['foraging', 1] },
  leaf_plant: { name: 'Broad leaves', verb: 'Pick', drops: [['leaf', 4, 8], ['fiber', 0, 2]], toolKind: 'plant', respawn: 360, xp: ['foraging', 1] },
  wreckage: { name: 'Wreckage', verb: 'Salvage', drops: [['salvage', 1, 2], ['rope', 0, 1]], toolKind: 'none', respawn: 1800, xp: ['fieldcraft', 3] },
};

export const NODE_KINDS = Object.keys(NODE_DEFS) as NodeKind[];

/** Relative abundance of each node kind per biome. */
export const BIOME_NODE_WEIGHTS: Record<Biome, Record<NodeKind, number>> = {
  tropical: { branches: 3, log: 2, stones: 1, berry_bush: 3, fiber_plant: 4, leaf_plant: 4, wreckage: 0.3 },
  grassland: { branches: 3, log: 2, stones: 2, berry_bush: 2, fiber_plant: 3, leaf_plant: 2, wreckage: 0.3 },
  swamp: { branches: 3, log: 3, stones: 0.5, berry_bush: 1, fiber_plant: 4, leaf_plant: 3, wreckage: 0.4 },
  desert: { branches: 0.6, log: 0.3, stones: 4, berry_bush: 0.15, fiber_plant: 0.8, leaf_plant: 0.1, wreckage: 0.8 },
  mountain: { branches: 1.5, log: 1, stones: 5, berry_bush: 0.5, fiber_plant: 0.6, leaf_plant: 0.3, wreckage: 0.5 },
  snow: { branches: 1, log: 0.8, stones: 4, berry_bush: 0.1, fiber_plant: 0.2, leaf_plant: 0.1, wreckage: 0.5 },
};

/** Yield multiplier for a node kind in current weather. */
export function weatherYield(kind: NodeKind, w: WeatherId): number {
  const wet = w === 'heavy_rain' || w === 'thunderstorm';
  if (wet && (kind === 'fiber_plant' || kind === 'leaf_plant')) return 1.4;
  if (wet && kind === 'branches') return 0.7;
  if (w === 'snowstorm' && (kind === 'berry_bush' || kind === 'fiber_plant' || kind === 'leaf_plant')) return 0.5;
  if (w === 'heatwave' && (kind === 'berry_bush' || kind === 'leaf_plant')) return 0.7;
  if (w === 'strong_wind' && kind === 'branches') return 1.5;
  return 1;
}

export interface WorldNode {
  id: string;
  kind: NodeKind;
  x: number; y: number; z: number;
  rot: number;
}

function pickKind(weights: Record<NodeKind, number>, r: number): NodeKind {
  let total = 0;
  for (const k of NODE_KINDS) total += weights[k];
  let t = r * total;
  for (const k of NODE_KINDS) {
    t -= weights[k];
    if (t <= 0) return k;
  }
  return 'stones';
}

/** Deterministically generate gatherable nodes for a chunk. */
export function generateNodes(terrain: Terrain, seed: number, cx: number, cz: number, perChunk = 14): WorldNode[] {
  const rng = mulberry32(hashInts(seed ^ 0x51ed, cx, cz));
  const out: WorldNode[] = [];
  for (let n = 0; n < perChunk; n++) {
    const x = (cx + rng()) * CHUNK_SIZE, z = (cz + rng()) * CHUNK_SIZE;
    const kindRoll = rng(), rot = rng() * Math.PI * 2;
    const y = terrain.heightAt(x, z);
    if (y < WATER_Y + 0.5 || terrain.slopeAt(x, z, 1) > 0.9) continue;
    const kind = pickKind(BIOME_NODE_WEIGHTS[terrain.biomeAt(x, z)], kindRoll);
    out.push({ id: `${cx},${cz},${n}`, kind, x, y, z, rot });
  }
  return out;
}

/** Roll the items dropped for one harvest. */
export function rollDrops(kind: NodeKind, rng: () => number, mult: number): { id: ItemId; count: number }[] {
  const drops: { id: ItemId; count: number }[] = [];
  for (const [id, lo, hi] of NODE_DEFS[kind].drops) {
    const base = lo + Math.floor(rng() * (hi - lo + 1));
    const scaled = base * mult;
    const n = Math.floor(scaled) + (rng() < scaled - Math.floor(scaled) ? 1 : 0);
    if (n > 0) drops.push({ id, count: n });
  }
  if (drops.length === 0) {
    const first = NODE_DEFS[kind].drops[0];
    drops.push({ id: first[0], count: 1 });
  }
  return drops;
}

/** Tracks which nodes are depleted and when they come back, in game seconds. */
export class NodeRegistry {
  private depleted = new Map<string, number>();
  private cache = new Map<string, WorldNode[]>();

  constructor(private terrain: Terrain, private seed: number) {}

  chunkNodes(cx: number, cz: number): WorldNode[] {
    const key = `${cx},${cz}`;
    let list = this.cache.get(key);
    if (!list) this.cache.set(key, (list = generateNodes(this.terrain, this.seed, cx, cz)));
    return list;
  }

  isAvailable(id: string, now: number): boolean {
    const t = this.depleted.get(id);
    if (t === undefined) return true;
    if (now >= t) { this.depleted.delete(id); return true; }
    return false;
  }

  deplete(node: WorldNode, now: number, respawnMult: number): void {
    this.depleted.set(node.id, now + NODE_DEFS[node.kind].respawn * respawnMult);
  }

  /** Available nodes within radius of a point. */
  near(x: number, z: number, radius: number, now: number): WorldNode[] {
    const out: WorldNode[] = [];
    const c0x = Math.floor((x - radius) / CHUNK_SIZE), c1x = Math.floor((x + radius) / CHUNK_SIZE);
    const c0z = Math.floor((z - radius) / CHUNK_SIZE), c1z = Math.floor((z + radius) / CHUNK_SIZE);
    for (let cx = c0x; cx <= c1x; cx++) {
      for (let cz = c0z; cz <= c1z; cz++) {
        for (const n of this.chunkNodes(cx, cz)) {
          if (Math.hypot(n.x - x, n.z - z) <= radius && this.isAvailable(n.id, now)) out.push(n);
        }
      }
    }
    return out;
  }

  /** Persistable depletion state. */
  serialize(): Record<string, number> { return Object.fromEntries(this.depleted); }
  load(d: Record<string, number>): void { this.depleted = new Map(Object.entries(d)); }
}
