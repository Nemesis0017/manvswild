import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../world/rng';
import { Terrain } from '../world/terrain';
import { BIOME_NODE_WEIGHTS, NODE_DEFS, NodeRegistry, generateNodes, rollDrops, weatherYield } from './nodes';

const t = new Terrain(1337);

describe('harvest nodes', () => {
  it('are deterministic per chunk and stand on dry land', () => {
    const a = generateNodes(t, 1337, 3, -2), b = generateNodes(t, 1337, 3, -2);
    expect(a).toEqual(b);
    for (const n of a) expect(n.y).toBeGreaterThan(3);
  });
  it('respect biome resource tables', () => {
    expect(BIOME_NODE_WEIGHTS.desert.stones).toBeGreaterThan(BIOME_NODE_WEIGHTS.desert.berry_bush * 5);
    expect(BIOME_NODE_WEIGHTS.tropical.fiber_plant).toBeGreaterThan(BIOME_NODE_WEIGHTS.snow.fiber_plant * 5);
  });
  it('rain boosts plants, snowstorms cut them', () => {
    expect(weatherYield('fiber_plant', 'heavy_rain')).toBeGreaterThan(1);
    expect(weatherYield('berry_bush', 'snowstorm')).toBeLessThan(1);
    expect(weatherYield('stones', 'thunderstorm')).toBe(1);
  });
  it('yield scales with multiplier and always gives at least one item', () => {
    const r = mulberry32(2);
    const rich = rollDrops('fiber_plant', r, 1.5).reduce((s, d) => s + d.count, 0);
    expect(rich).toBeGreaterThanOrEqual(3);
    for (let i = 0; i < 50; i++) expect(rollDrops('stones', r, 0.1).length).toBeGreaterThan(0);
    expect(NODE_DEFS.log.drops[0][0]).toBe('wood');
  });
  it('depleted nodes respawn after their timer, slower on hard difficulty', () => {
    const reg = new NodeRegistry(t, 1337);
    let node = generateNodes(t, 1337, 0, 0)[0];
    for (let c = 1; !node && c < 20; c++) node = generateNodes(t, 1337, c, 0)[0];
    reg.deplete(node, 100, 1);
    expect(reg.isAvailable(node.id, 101)).toBe(false);
    expect(reg.isAvailable(node.id, 100 + NODE_DEFS[node.kind].respawn + 1)).toBe(true);
    reg.deplete(node, 100, 2);
    expect(reg.isAvailable(node.id, 100 + NODE_DEFS[node.kind].respawn + 1)).toBe(false);
    const saved = reg.serialize();
    const reg2 = new NodeRegistry(t, 1337);
    reg2.load(saved);
    expect(reg2.isAvailable(node.id, 101)).toBe(false);
  });
  it('near() finds available nodes within a radius', () => {
    const reg = new NodeRegistry(t, 1337);
    const nodes = generateNodes(t, 1337, 1, 1);
    const n = nodes[0];
    const found = reg.near(n.x, n.z, 5, 0);
    expect(found.some((x) => x.id === n.id)).toBe(true);
    reg.deplete(n, 0, 1);
    expect(reg.near(n.x, n.z, 5, 1).some((x) => x.id === n.id)).toBe(false);
  });
});
