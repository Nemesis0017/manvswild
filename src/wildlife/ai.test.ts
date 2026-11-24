import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../world/rng';
import { Terrain } from '../world/terrain';
import {
  SPECIES, advanceAnimal, detectionRange, newAnimal, spawnForChunk, stepAnimal,
  type Animal, type Perception, type Species,
} from './ai';

const rng = () => mulberry32(5);
const per = (over: Partial<Perception> = {}): Perception => ({
  playerX: 0, playerZ: 0, playerSpeed: 3, crouching: false, sprinting: false, visibility: 1, night: false,
  detectMult: 1, noises: [], ...over,
});
const make = (sp: Species, dist: number): Animal => {
  const a = newAnimal(1, sp, dist, 5, 0, rng());
  return a;
};
const run = (a: Animal, p: Perception, secs: number, r = rng()) => {
  const events = { strike: 0, warned: 0 };
  for (let i = 0; i < secs * 10; i++) {
    const ev = stepAnimal(a, p, 0.1, r);
    if (ev.strike) events.strike++;
    if (ev.warned) events.warned++;
  }
  return events;
};

describe('prey AI', () => {
  it('wanders, feeds and rests when the player is far away', () => {
    const a = make('deer', 300);
    const seen = new Set<string>();
    const r = rng();
    for (let i = 0; i < 3000; i++) {
      stepAnimal(a, per(), 0.1, r);
      advanceAnimal(a, 0.1, () => true, r);
      seen.add(a.state);
    }
    expect(seen.has('wander')).toBe(true);
    expect(seen.has('feed')).toBe(true);
    expect(seen.has('rest')).toBe(true);
    expect(seen.has('flee')).toBe(false);
  });

  it('flees when it notices the player, then calms down after getting away', () => {
    const a = make('deer', 15);
    run(a, per(), 3);
    expect(a.state).toBe('flee');
    expect(a.speed).toBe(SPECIES.deer.run);
    // Move the animal away and let it calm down.
    a.x = 200;
    run(a, per(), 6);
    expect(a.state).toBe('wander');
  });

  it('crouching shrinks detection range and sprinting grows it', () => {
    const def = SPECIES.deer;
    const walk = detectionRange(def, per());
    expect(detectionRange(def, per({ crouching: true }))).toBeLessThan(walk * 0.5);
    expect(detectionRange(def, per({ sprinting: true }))).toBeGreaterThan(walk);
    expect(detectionRange(def, per({ playerSpeed: 0 }))).toBeLessThan(walk);
    expect(detectionRange(def, per({ visibility: 0.3 }))).toBeLessThan(walk);
    expect(detectionRange(def, per({ detectMult: 1.4 }))).toBeGreaterThan(walk);
  });

  it('a crouching player can approach closer without alarming a deer', () => {
    const stand = make('deer', 25), sneak = make('deer', 25);
    run(stand, per(), 4);
    run(sneak, per({ crouching: true, playerSpeed: 1.5 }), 4);
    expect(stand.state).toBe('flee');
    expect(sneak.state).not.toBe('flee');
  });

  it('investigates a thrown stone then goes back to feeding', () => {
    const a = make('deer', 100);
    stepAnimal(a, per({ noises: [{ x: 80, z: 20, loudness: 1.2 }] }), 0.1, rng());
    expect(a.state).toBe('investigate');
    expect(a.tx).toBe(80);
    a.x = 80; a.z = 20;
    run(a, per(), 1);
    expect(['feed', 'wander']).toContain(a.state);
  });
});

describe('territorial AI', () => {
  it('warns first when the player enters its territory, without attacking', () => {
    const a = make('bear', 12);
    const ev = run(a, per({ playerSpeed: 1 }), 2);
    expect(a.state).toBe('warn');
    expect(ev.warned).toBe(1);
    expect(a.speed).toBe(0);
    expect(ev.strike).toBe(0);
  });

  it('backing away resolves the warning peacefully', () => {
    const a = make('wolf', 15);
    run(a, per(), 2);
    expect(a.state).toBe('warn');
    a.x = 60;
    run(a, per(), 6);
    expect(a.state).toBe('wander');
  });

  it('standing its ground leads to a defensive push, then retreat (no kill, no health damage)', () => {
    const a = make('bear', 14);
    let struck = 0;
    const r = rng();
    for (let i = 0; i < 200; i++) {
      const ev = stepAnimal(a, per({ playerSpeed: 0 }), 0.1, r);
      advanceAnimal(a, 0.1, () => true, r);
      if (ev.strike) struck++;
    }
    expect(struck).toBe(1);
    expect(['retreat', 'wander', 'warn']).toContain(a.state);
    expect(a.cooldown).toBeGreaterThan(0);
  });

  it('after striking it retreats toward home and will not strike again during cooldown', () => {
    const a = make('snake', 1);
    a.awareness = 1;
    a.state = 'defensive';
    const ev = stepAnimal(a, per(), 0.1, rng());
    expect(ev.strike).toBe(true);
    expect(a.state).toBe('retreat');
    a.state = 'warn';
    a.stateTime = 10;
    stepAnimal(a, per(), 0.1, rng());
    expect(a.state).toBe('warn');
  });

  it('a thrown stone distracts a warning predator', () => {
    const a = make('wolf', 15);
    run(a, per(), 2);
    expect(a.state).toBe('warn');
    stepAnimal(a, per({ noises: [{ x: 40, z: 40, loudness: 1.2 }] }), 0.1, rng());
    expect(a.state).toBe('investigate');
    expect(a.tx).toBe(40);
  });

  it('fog hides the player from territorial animals', () => {
    const a = make('bear', 12);
    run(a, per({ visibility: 0.2, crouching: true }), 3);
    expect(a.state).not.toBe('warn');
  });

  it('every species has sane stats and none can deal health damage by design', () => {
    for (const d of Object.values(SPECIES)) {
      expect(d.run).toBeGreaterThanOrEqual(d.walk);
      expect(d.detect).toBeGreaterThan(0);
    }
    const ev = stepAnimal(make('wolf', 5), per(), 0.1, rng());
    expect(Object.keys(ev).sort()).toEqual(['strike', 'warned']);
  });
});

describe('movement and spawning', () => {
  it('animals move toward their target and refuse blocked positions', () => {
    const a = make('rabbit', 50);
    a.speed = 2; a.tx = 60; a.tz = 0; a.yaw = Math.PI / 2;
    advanceAnimal(a, 1, () => true, rng());
    expect(a.x).toBeGreaterThan(50);
    const b = make('rabbit', 50);
    b.speed = 2; b.tx = 60; b.tz = 0; b.yaw = Math.PI / 2;
    advanceAnimal(b, 1, () => false, rng());
    expect(b.x).toBe(50);
  });

  it('chunk spawns are deterministic and only place fish in water', () => {
    const t = new Terrain(1337);
    const a = spawnForChunk(t, 1337, 2, 3), b = spawnForChunk(t, 1337, 2, 3);
    expect(a.map((x) => [x.id, x.species, x.x])).toEqual(b.map((x) => [x.id, x.species, x.x]));
    let fish = 0, land = 0;
    for (let cx = -6; cx < 6; cx++) for (let cz = -6; cz < 6; cz++) {
      for (const an of spawnForChunk(t, 1337, cx, cz)) {
        if (an.species === 'fish') { fish++; expect(t.heightAt(an.x, an.z)).toBeLessThan(3); }
        else { land++; expect(t.heightAt(an.x, an.z)).toBeGreaterThan(3); }
      }
    }
    expect(land).toBeGreaterThan(20);
    expect(fish).toBeGreaterThanOrEqual(0);
  });
});
