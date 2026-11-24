import { describe, expect, it } from 'vitest';
import { Inventory } from '../items/inventory';
import {
  CAMPFIRE_MAX_WARMTH, FUEL_PER_WOOD, PIECES, alignToTerrain, createPiece, effectsAt, refuel, repair, tickPieces, validatePlacement,
} from './building';

const site = { height: 10, slope: 0.1, inWater: false, inCave: false };
const player = { x: 0, z: 0 };

describe('building validity', () => {
  it('accepts flat dry ground near the player with materials', () => {
    expect(validatePlacement('campfire', 2, 2, site, [], player, true).valid).toBe(true);
  });
  it('rejects water, steep slopes, caves, distance, overlap and missing materials', () => {
    const v = (s: Partial<typeof site>, x = 2, ex = [] as ReturnType<typeof createPiece>[], mats = true) =>
      validatePlacement('campfire', x, 0, { ...site, ...s }, ex, player, mats);
    expect(v({ inWater: true }).reason).toMatch(/water/);
    expect(v({ height: 3.1 }).valid).toBe(false);
    expect(v({ slope: 0.9 }).reason).toMatch(/steep/);
    expect(v({ inCave: true }).valid).toBe(false);
    expect(v({}, 20).reason).toMatch(/far/);
    expect(v({}, 2, [createPiece(1, 'campfire', 2.5, 10, 0, 0)]).reason).toMatch(/way/);
    expect(v({}, 2, [], false).reason).toMatch(/materials/);
  });
  it('allows a campfire inside a shelter footprint but not two shelters on top of each other', () => {
    const shelter = createPiece(1, 'shelter', 2, 10, 0, 0);
    expect(validatePlacement('campfire', 3.2, 0, site, [shelter], player, true).valid).toBe(true);
    expect(validatePlacement('shelter', 3, 0, site, [shelter], player, true).valid).toBe(false);
  });
  it('slope limits differ per piece', () => {
    expect(validatePlacement('shelter', 2, 0, { ...site, slope: 0.4 }, [], player, true).valid).toBe(true);
    expect(validatePlacement('sleeping_area', 2, 0, { ...site, slope: 0.4 }, [], player, true).valid).toBe(false);
  });
  it('alignment tilts toward the slope and is clamped', () => {
    const flat = alignToTerrain(5, 5, 5, 5, 1);
    expect(flat.pitch).toBe(0);
    expect(flat.roll).toBe(0);
    const steep = alignToTerrain(0, 10, 5, 5, 1);
    expect(Math.abs(steep.roll)).toBeLessThanOrEqual(0.3);
    expect(steep.roll).not.toBe(0);
  });
});

describe('building effects', () => {
  it('campfire warmth falls with distance and needs fuel', () => {
    const fire = createPiece(1, 'campfire', 0, 0, 0, 0);
    const near = effectsAt([fire], 0.5, 0).warmth;
    const far = effectsAt([fire], 5, 0).warmth;
    expect(near).toBeGreaterThan(far);
    expect(near).toBeLessThanOrEqual(CAMPFIRE_MAX_WARMTH);
    expect(effectsAt([fire], 20, 0).warmth).toBe(0);
    expect(effectsAt([fire], 1, 0).nearLitCampfire).toBe(true);
    fire.fuel = 0;
    expect(effectsAt([fire], 1, 0).warmth).toBe(0);
    expect(effectsAt([fire], 1, 0).nearLitCampfire).toBe(false);
  });
  it('shelter gives cover inside its footprint and sleeping areas allow rest', () => {
    const sh = createPiece(1, 'shelter', 0, 0, 0, 0);
    const bed = createPiece(2, 'sleeping_area', 10, 0, 0, 0);
    expect(effectsAt([sh, bed], 0.5, 0).sheltered).toBe(true);
    expect(effectsAt([sh, bed], 5, 0).sheltered).toBe(false);
    expect(effectsAt([sh, bed], 10.5, 0).nearSleepSpot).toBe(true);
  });
  it('fires burn out faster in rain unless sheltered, and storms can drown exposed fires', () => {
    const dry = createPiece(1, 'campfire', 0, 0, 0, 0), wet = createPiece(2, 'campfire', 50, 0, 0, 0);
    tickPieces([dry], 10, 0, 0, 1);
    tickPieces([wet], 10, 1, 0, 1);
    expect(wet.fuel).toBeLessThan(dry.fuel);
    const covered = createPiece(3, 'campfire', 0, 0, 0, 0);
    tickPieces([covered, createPiece(4, 'shelter', 0, 0, 0, 0)], 10, 1, 0, 1);
    expect(covered.fuel).toBeCloseTo(dry.fuel, 5);
    const doomed = createPiece(5, 'campfire', 80, 0, 0, 0);
    doomed.fuel = 20;
    tickPieces([doomed], 0.1, 1, 1, 1);
    expect(doomed.fuel).toBe(0);
  });
  it('weather wears shelters down until they are destroyed; repair restores them', () => {
    const sh = createPiece(1, 'shelter', 0, 0, 0, 0);
    expect(tickPieces([sh], 100, 1, 1, 1)).toEqual([]);
    expect(sh.durability).toBeLessThan(PIECES.shelter.maxDurability);
    sh.durability = 1;
    expect(tickPieces([sh], 100, 1, 1, 1)).toEqual([1]);
    const inv = new Inventory();
    inv.add('branch', 1); inv.add('leaf', 2);
    sh.durability = 50;
    expect(repair(sh, inv)).toBe(true);
    expect(sh.durability).toBe(85);
    expect(inv.count('branch')).toBe(0);
    expect(repair(sh, inv)).toBe(false);
  });
  it('refuel consumes wood and adds fuel', () => {
    const fire = createPiece(1, 'campfire', 0, 0, 0, 0);
    fire.fuel = 0;
    const inv = new Inventory();
    expect(refuel(fire, inv)).toBe(false);
    inv.add('wood', 2);
    expect(refuel(fire, inv)).toBe(true);
    expect(fire.fuel).toBe(FUEL_PER_WOOD);
    expect(inv.count('wood')).toBe(1);
  });
});
