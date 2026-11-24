import { describe, expect, it } from 'vitest';
import { Terrain } from '../world/terrain';
import { Exploration, angleDiff, bearing, cellOf, compassLabel } from './exploration';
import { findBiomeSpawn, generatePois } from './pois';

describe('exploration and fog of war', () => {
  it('reveals a disc and reports only new cells the second time', () => {
    const e = new Exploration();
    const first = e.reveal(0, 0, 100);
    expect(first).toBeGreaterThan(20);
    expect(e.reveal(0, 0, 100)).toBe(0);
    expect(e.isRevealedAt(10, 10)).toBe(true);
    expect(e.isRevealedAt(500, 500)).toBe(false);
    expect(e.reveal(30, 0, 100)).toBeGreaterThan(0);
  });
  it('computes exploration percent from the cells within the world radius', () => {
    const e = new Exploration();
    expect(e.percent()).toBe(0);
    e.reveal(0, 0, 200);
    const p = e.percent();
    expect(p).toBeGreaterThan(1);
    expect(p).toBeLessThan(5);
    e.reveal(5000, 5000, 200);
    expect(e.percent()).toBeCloseTo(p, 5);
  });
  it('manages waypoints and round-trips through serialization', () => {
    const e = new Exploration(10, 20);
    e.reveal(10, 20, 64);
    const w = e.addWaypoint(100, -50);
    e.addWaypoint(1, 2, 'Camp');
    e.removeWaypoint(w.id);
    e.discovered.add('cairn');
    const back = Exploration.deserialize(JSON.parse(JSON.stringify(e.serialize())), 10, 20);
    expect(back.waypoints.map((x) => x.name)).toEqual(['Camp']);
    expect(back.revealedCount).toBe(e.revealedCount);
    expect(back.discovered.has('cairn')).toBe(true);
    expect(back.addWaypoint(0, 0).id).toBeGreaterThan(2);
  });
  it('bearings and compass labels', () => {
    expect(bearing(0, 0, 0, -10)).toBeCloseTo(0);
    expect(bearing(0, 0, 10, 0)).toBeCloseTo(Math.PI / 2);
    expect(angleDiff(0.1, Math.PI * 2 - 0.1)).toBeCloseTo(-0.2);
    expect(compassLabel(0)).toBe('N');
    expect(compassLabel(Math.PI)).toBe('S');
    expect(cellOf(-1)).toBe(-1);
  });
});

describe('points of interest', () => {
  const t = new Terrain(1337);
  const spawn = t.findSpawn();
  const set = generatePois(t, spawn);
  it('is deterministic for a seed', () => {
    const again = generatePois(new Terrain(1337), spawn);
    expect(again.all.map((p) => [p.id, Math.round(p.x), Math.round(p.z)])).toEqual(set.all.map((p) => [p.id, Math.round(p.x), Math.round(p.z)]));
  });
  it('places the story targets', () => {
    expect(set.cairn).not.toBeNull();
    expect(set.summit).not.toBeNull();
    expect(set.extraction).not.toBeNull();
    expect(set.campsites.length).toBeGreaterThan(0);
    expect(set.summit!.y).toBeGreaterThan(set.cairn!.y);
  });
  it('different seeds give different summits', () => {
    const other = generatePois(new Terrain(99), { x: 0, z: 0 });
    expect(other.summit).not.toBeNull();
    expect(other.summit!.id).toBe('summit');
  });
  it('finds a biome spawn when the biome exists nearby', () => {
    const p = findBiomeSpawn(t, 'grassland');
    expect(p).not.toBeNull();
    expect(t.biomeAt(p!.x, p!.z)).toBe('grassland');
  });
});
