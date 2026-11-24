import { describe, expect, it } from 'vitest';
import { DIFFICULTIES, DIFFICULTY_IDS } from './difficulty';
import {
  acceptRescue, addInjury, applyDamage, createSurvival, defaultEnv, equilibriumTemp, fallDamage,
  movementMultiplier, slipperyFactor, tickFailure, tickSurvival, EXHAUST_RECOVER,
} from './survival';
import { rockHits, rockfallChancePerSecond } from './hazards';

const M = DIFFICULTIES.survivor;
const run = (s: ReturnType<typeof createSurvival>, env: ReturnType<typeof defaultEnv>, secs: number, mods = M) => {
  for (let i = 0; i < secs * 10; i++) tickSurvival(s, env, 0.1, mods);
};

describe('survival tick math', () => {
  it('drains hunger and thirst at the documented rates', () => {
    const s = createSurvival();
    s.hunger = 100; s.thirst = 100;
    run(s, defaultEnv(), 60);
    expect(s.hunger).toBeCloseTo(100 - (100 / 1500) * 60, 1);
    expect(s.thirst).toBeCloseTo(100 - (100 / 900) * 60, 1);
  });

  it('thirst drains faster than hunger and faster when sprinting', () => {
    const a = createSurvival(), b = createSurvival();
    run(a, defaultEnv(), 60);
    run(b, { ...defaultEnv(), moving: true, sprinting: true }, 60);
    expect(100 - a.thirst).toBeGreaterThan(100 - a.hunger);
    expect(b.thirst).toBeLessThan(a.thirst);
  });

  it('dehydration damages health once thirst is zero', () => {
    const s = createSurvival();
    s.thirst = 0;
    const r = tickSurvival(s, defaultEnv(), 1, M);
    expect(s.health).toBeLessThan(100);
    expect(r.warnings.join(' ')).toMatch(/Dehydration/);
  });

  it('regenerates health when fed, watered and warm', () => {
    const s = createSurvival();
    s.health = 50;
    run(s, defaultEnv(), 30);
    expect(s.health).toBeGreaterThan(55);
  });

  it('cold drives body temperature down toward hypothermia and hurts', () => {
    const s = createSurvival();
    const env = { ...defaultEnv(), ambient: -15 };
    run(s, env, 400);
    expect(s.bodyTemp).toBeLessThan(33);
    expect(s.health).toBeLessThan(100);
  });

  it('a fire and jacket keep the body warm in the same cold', () => {
    const bare = createSurvival(), warm = createSurvival();
    run(bare, { ...defaultEnv(), ambient: -5 }, 400);
    run(warm, { ...defaultEnv(), ambient: -5, warmth: 14, insulation: 0.55 }, 400);
    expect(warm.bodyTemp).toBeGreaterThan(bare.bodyTemp + 2);
    expect(warm.bodyTemp).toBeGreaterThan(35);
  });

  it('heat raises body temperature, speeds thirst and eventually causes heat exhaustion damage', () => {
    const s = createSurvival();
    s.thirst = 100;
    run(s, { ...defaultEnv(), ambient: 48 }, 500);
    expect(s.bodyTemp).toBeGreaterThan(40);
    expect(s.health).toBeLessThan(100);
  });

  it('equilibrium temperature is 37C at 20C ambient and wetness cools in the cold', () => {
    expect(equilibriumTemp(defaultEnv(), 0)).toBeCloseTo(37, 5);
    const cold = { ...defaultEnv(), ambient: 5 };
    expect(equilibriumTemp(cold, 100)).toBeLessThan(equilibriumTemp(cold, 0));
  });

  it('shelter blocks rain wetness and wind chill', () => {
    const open = createSurvival(), covered = createSurvival();
    run(open, { ...defaultEnv(), precipitation: 1 }, 40);
    run(covered, { ...defaultEnv(), precipitation: 1, sheltered: true }, 40);
    expect(open.wetness).toBeGreaterThan(50);
    expect(covered.wetness).toBe(0);
    expect(equilibriumTemp({ ...defaultEnv(), ambient: 5, wind: 1, sheltered: true }, 0))
      .toBeGreaterThan(equilibriumTemp({ ...defaultEnv(), ambient: 5, wind: 1 }, 0));
  });

  it('a waterproof poncho reduces wetness gain', () => {
    const a = createSurvival(), b = createSurvival();
    run(a, { ...defaultEnv(), precipitation: 1 }, 30);
    run(b, { ...defaultEnv(), precipitation: 1, rainProof: 0.8 }, 30);
    expect(b.wetness).toBeLessThan(a.wetness / 2);
  });

  it('swimming soaks and drains stamina, a raft drains far less', () => {
    const a = createSurvival(), b = createSurvival();
    run(a, { ...defaultEnv(), swimming: true, moving: true }, 5);
    run(b, { ...defaultEnv(), swimming: true, moving: true, onRaft: true }, 5);
    expect(a.wetness).toBe(100);
    expect(a.stamina).toBeLessThan(b.stamina - 15);
  });

  it('sprinting drains stamina; exhaustion locks until recovery', () => {
    const s = createSurvival();
    run(s, { ...defaultEnv(), moving: true, sprinting: true }, 10);
    expect(s.stamina).toBe(0);
    expect(s.exhausted).toBe(true);
    expect(movementMultiplier(s, 0)).toBeLessThan(1);
    run(s, defaultEnv(), 3);
    expect(s.stamina).toBeGreaterThan(EXHAUST_RECOVER);
    expect(s.exhausted).toBe(false);
  });

  it('fatigue grows while awake and falls fast while resting', () => {
    const s = createSurvival();
    s.fatigue = 50;
    run(s, defaultEnv(), 60);
    const awake = s.fatigue;
    expect(awake).toBeGreaterThan(50);
    run(s, { ...defaultEnv(), resting: true }, 30);
    expect(s.fatigue).toBeLessThan(awake - 20);
  });

  it('injuries slow movement and expire', () => {
    const s = createSurvival();
    addInjury(s, 'sprain', 10, M);
    expect(movementMultiplier(s, 0)).toBeCloseTo(0.7);
    run(s, defaultEnv(), 11);
    expect(s.injuries.sprain).toBe(0);
    expect(movementMultiplier(s, 0)).toBe(1);
  });

  it('heavy loads slow the player', () => {
    const s = createSurvival();
    expect(movementMultiplier(s, 0.5)).toBe(1);
    expect(movementMultiplier(s, 1.2)).toBeLessThan(0.9);
  });
});

describe('hazards', () => {
  it('fall damage is zero for gentle landings and grows with speed', () => {
    expect(fallDamage(8, M)).toBe(0);
    expect(fallDamage(16, M)).toBeGreaterThan(0);
    expect(fallDamage(20, M)).toBeGreaterThan(fallDamage(16, M));
  });

  it('slippery ground reduces grip in rain on slopes, never below 0.6', () => {
    expect(slipperyFactor(0, 0, 0, false)).toBe(1);
    expect(slipperyFactor(100, 1, 1.2, true)).toBeLessThan(slipperyFactor(100, 1, 0.1, true));
    expect(slipperyFactor(100, 1, 5, true)).toBeGreaterThanOrEqual(0.6);
  });

  it('rockfall only occurs in mountain biomes and is likelier when climbing in rain', () => {
    expect(rockfallChancePerSecond('grassland', true, 2, 1, true)).toBe(0);
    const walk = rockfallChancePerSecond('mountain', false, 1.5, 1, false);
    const climb = rockfallChancePerSecond('mountain', true, 1.5, 1, false);
    const wet = rockfallChancePerSecond('mountain', true, 1.5, 1, true);
    expect(climb).toBeGreaterThan(walk);
    expect(wet).toBeGreaterThan(climb);
  });

  it('a rock only hits when the player stays under it', () => {
    const rock = { x: 0, z: 0, timer: 0 };
    expect(rockHits(rock, 0.5, 0.5)).toBe(true);
    expect(rockHits(rock, 6, 0)).toBe(false);
  });
});

describe('difficulty modifiers', () => {
  it('higher difficulties drain needs faster', () => {
    const left: Record<string, number> = {};
    for (const id of DIFFICULTY_IDS) {
      const s = createSurvival();
      s.thirst = 100;
      run(s, defaultEnv(), 60, DIFFICULTIES[id]);
      left[id] = s.thirst;
    }
    expect(left.explorer).toBeGreaterThan(left.survivor);
    expect(left.survivor).toBeGreaterThan(left.extreme);
    expect(left.realistic).toBeLessThan(left.survivor);
  });

  it('scarcity, weather, damage and HUD assistance scale as described', () => {
    const d = DIFFICULTIES;
    expect(d.explorer.yield).toBeGreaterThan(d.realistic.yield);
    expect(d.explorer.weatherSeverity).toBeLessThan(d.realistic.weatherSeverity);
    expect(d.explorer.damage).toBeLessThan(d.extreme.damage);
    expect(d.explorer.hudAssist).toBe(true);
    expect(d.realistic.hudAssist).toBe(false);
    expect(d.realistic.rescues).toBe(0);
  });

  it('damage multiplier changes how fast dehydration hurts', () => {
    const a = createSurvival(), b = createSurvival();
    a.thirst = 0; b.thirst = 0;
    run(a, defaultEnv(), 5, DIFFICULTIES.explorer);
    run(b, defaultEnv(), 5, DIFFICULTIES.extreme);
    expect(a.health).toBeGreaterThan(b.health);
  });
});

describe('failure and rescue', () => {
  it('fades to black, then offers rescue until the difficulty allowance is used', () => {
    const s = createSurvival();
    applyDamage(s, 200);
    tickSurvival(s, defaultEnv(), 0.1, M);
    expect(s.phase).toBe('fading');
    for (let i = 0; i < 40; i++) tickFailure(s, 0.1, M);
    expect(s.fade).toBe(1);
    expect(s.phase).toBe('rescued');
    expect(acceptRescue(s)).toBe(true);
    expect(s.phase).toBe('alive');
    expect(s.health).toBeGreaterThan(0);
    expect(s.rescuesUsed).toBe(1);
  });

  it('realistic mode ends the run with no rescue', () => {
    const s = createSurvival();
    const mods = DIFFICULTIES.realistic;
    s.health = 0.01; s.thirst = 0;
    run(s, defaultEnv(), 2, mods);
    for (let i = 0; i < 40; i++) tickFailure(s, 0.1, mods);
    expect(s.phase).toBe('ended');
    expect(acceptRescue(s)).toBe(false);
  });

  it('a stopped simulation does nothing once failing', () => {
    const s = createSurvival();
    applyDamage(s, 500);
    const hunger = s.hunger;
    tickSurvival(s, defaultEnv(), 5, M);
    expect(s.hunger).toBe(hunger);
  });
});
