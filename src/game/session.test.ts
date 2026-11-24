import { beforeEach, describe, expect, it } from 'vitest';
import { events } from '../core/events';
import { createSkills } from '../items/skills';
import { Terrain } from '../world/terrain';
import { Session, defaultConfig, sessionStore } from './session';
import { STORY_MISSIONS } from './missions';

/** Minimal stand-ins for the parts of the engine the Session reads. */
function harness(seed = 1337, cfgOver: object = {}) {
  const terrain = new Terrain(seed);
  const spawn = terrain.findSpawn();
  const said: string[] = [];
  const gameplay = {
    hooks: null as unknown, modeCtx: null as unknown, weatherLock: null as unknown, skills: createSkills(),
    survival: { phase: 'alive', failReason: '' }, wildlife: { animals: [] as unknown[] }, pieces: [] as unknown[],
    setDifficulty() {}, grantXp() {}, trickleXp() {}, setStartItems() {}, setStartWeather() {}, say(t: string) { said.push(t); },
  };
  const character = {
    feet: { x: spawn.x, y: terrain.heightAt(spawn.x, spawn.z), z: spawn.z },
    underground: false,
    state: { swimming: false, climbing: false, sprinting: false, speed: 0 },
  };
  const sky = { timeOfDay: 0.38, dayLength: 1200 };
  const session = new Session({ ...defaultConfig(seed), ...cfgOver }, terrain, gameplay as never, character as never, sky as never, spawn);
  const tick = (secs: number) => { for (let i = 0; i < secs * 4; i++) session.update(0.25); };
  const teleport = (x: number, z: number, y?: number) => { character.feet = { x, z, y: y ?? terrain.heightAt(x, z) }; };
  return { terrain, spawn, session, gameplay, character, sky, tick, teleport, said };
}

describe('Session scripted story playthrough', () => {
  beforeEach(() => sessionStore.setState({ active: false }));

  it('completes all ten missions through game events and movement', () => {
    const h = harness();
    const { session, terrain } = h;
    const p = session.pois;
    expect(session.tracker.defs.length).toBe(10);

    events.emit('waterCollected', undefined);
    h.tick(1.2);
    expect(session.tracker.current!.id).toBe('shelter');

    events.emit('built', { kind: 'shelter' });
    h.tick(1.2);
    expect(session.tracker.current!.id).toBe('night');

    // Let the sky run through a night to dawn.
    for (const tod of [0.85, 0.95, 0.05, 0.15, 0.3]) { h.sky.timeOfDay = tod; h.tick(0.5); }
    h.tick(1.2);
    expect(session.facts.nights).toBe(1);
    expect(session.day).toBe(2);
    expect(session.tracker.current!.id).toBe('navigate');

    h.teleport(p.cairn!.x, p.cairn!.z);
    h.tick(1.5);
    expect(session.tracker.current!.id).toBe('river');

    // Cross a river: find a river cell and step across it.
    let crossed = false;
    for (let gx = -600; gx <= 600 && !crossed; gx += 20) {
      for (let gz = -600; gz <= 600 && !crossed; gz += 20) {
        const x = h.spawn.x + gx, z = h.spawn.z + gz;
        if (terrain.sample(x, z).river < 0.5) continue;
        const e = 3;
        const gxr = terrain.riverField(x + e, z) - terrain.riverField(x - e, z);
        const gzr = terrain.riverField(x, z + e) - terrain.riverField(x, z - e);
        const gl = Math.hypot(gxr, gzr);
        if (gl < 1e-7) continue;
        const nx = gxr / gl, nz = gzr / gl;
        const a = { x: x - nx * 70, z: z - nz * 70 }, b = { x: x + nx * 70, z: z + nz * 70 };
        if (terrain.sample(a.x, a.z).river > 0.02 || terrain.sample(b.x, b.z).river > 0.02) continue;
        if (Math.sign(terrain.riverField(a.x, a.z)) === Math.sign(terrain.riverField(b.x, b.z))) continue;
        for (let k = -70; k <= 70; k += 5) { h.teleport(x + nx * k, z + nz * k); h.tick(0.25); }
        crossed = true;
      }
    }
    expect(crossed).toBe(true);
    h.teleport(h.spawn.x, h.spawn.z);
    h.tick(1.5);
    expect(session.facts.riverCrossings).toBeGreaterThanOrEqual(1);
    expect(session.tracker.current!.id).toBe('cave');

    h.character.underground = true;
    h.tick(16);
    h.character.underground = false;
    expect(session.tracker.current!.id).toBe('supplies');
    expect(session.stats.cavesExplored).toBe(1);

    events.emit('campsiteLooted', { id: 'camp:0' });
    h.tick(1.2);
    expect(session.tracker.current!.id).toBe('summit');

    h.teleport(p.summit!.x, p.summit!.z, p.summit!.y);
    h.tick(1.5);
    expect(session.tracker.current!.id).toBe('signal');

    events.emit('signalRaised', { x: p.summit!.x, z: p.summit!.z });
    h.tick(1.2);
    expect(session.tracker.current!.id).toBe('extraction');

    h.teleport(p.extraction!.x, p.extraction!.z);
    h.tick(1.5);
    expect(session.tracker.finished).toBe(true);
    expect(session.outcome?.kind).toBe('victory');
    expect(session.stats.missionsCompleted).toBe(10);
    expect(session.achievements.unlocked.has('story_done')).toBe(true);
    expect(session.exploration.percent()).toBeGreaterThan(0);
    session.dispose();
  });

  it('refuses extraction before a signal is raised', () => {
    const h = harness();
    h.teleport(h.session.pois.extraction!.x, h.session.pois.extraction!.z);
    h.tick(1.5);
    expect(h.session.facts.extractionReached).toBe(false);
    expect(h.said.some((t) => /signal/i.test(t))).toBe(true);
    h.session.dispose();
  });

  it('a signal away from the summit does not count', () => {
    const h = harness();
    events.emit('signalRaised', { x: h.spawn.x, z: h.spawn.z });
    expect(h.session.facts.signalAtSummit).toBe(false);
    expect(h.session.facts.signals).toBe(1);
    h.session.dispose();
  });

  it('snapshot and restore keep progress', () => {
    const h = harness();
    events.emit('waterCollected', undefined);
    h.tick(1.5);
    const snap = JSON.parse(JSON.stringify(h.session.snapshot()));
    h.session.dispose();
    const h2 = harness();
    const restored = new Session(h2.session.config, h2.terrain, h2.gameplay as never, h2.character as never, h2.sky as never, h2.spawn, snap);
    expect(restored.tracker.current!.id).toBe('shelter');
    expect(restored.stats.waterCollected).toBe(1);
    expect(restored.exploration.revealedCount).toBeGreaterThan(0);
    restored.dispose();
    h2.session.dispose();
  });

  it('tracks the objective target for navigation assist', () => {
    const h = harness();
    expect(h.session.objectiveTarget()).toBeNull();
    h.session.tracker.restore({ index: STORY_MISSIONS.findIndex((m) => m.id === 'summit'), completed: [] });
    expect(h.session.objectiveTarget()!.x).toBe(h.session.pois.summit!.x);
    h.session.setNavAssist(false);
    expect(h.session.trackTarget()).toBeNull();
    h.session.addWaypoint(10, 10);
    h.session.setTracked('wp:1');
    expect(h.session.trackTarget()!.x).toBe(10);
    h.session.dispose();
  });

  it('endless mode escalates by day and ends on failure', () => {
    const h = harness(1337, { mode: 'endless' });
    expect(h.session.tracker.defs.length).toBe(0);
    h.sky.timeOfDay = 0.95; h.tick(0.5);
    h.sky.timeOfDay = 0.02; h.tick(0.5);
    expect(h.session.day).toBe(2);
    expect(h.session.modeCtx.escalation).toBeGreaterThan(1);
    h.gameplay.survival.phase = 'ended';
    h.gameplay.survival.failReason = 'You succumbed';
    h.tick(0.5);
    expect(h.session.outcome?.kind).toBe('failed');
    expect(h.session.outcome?.text).toMatch(/day/);
    h.session.dispose();
  });
});
