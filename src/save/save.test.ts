import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { Exploration } from '../exploration/exploration';
import { createFacts, MissionTracker, STORY_MISSIONS } from '../game/missions';
import { createStats } from '../game/progress';
import { defaultConfig, type SessionSnapshot } from '../game/session';
import { Inventory } from '../items/inventory';
import { createSkills } from '../items/skills';
import { createSurvival } from '../survival/survival';
import { SaveDb } from './db';
import { SAVE_VERSION, SLOT_IDS, slotLabel, validateSave, type SaveData } from './saveData';

function makeSave(slot: string, day = 3): SaveData {
  const inv = new Inventory();
  inv.add('wood', 7);
  inv.add('stone_axe', 1);
  const ex = new Exploration(5, 5);
  ex.reveal(5, 5, 150);
  ex.addWaypoint(50, 60, 'Camp');
  ex.discovered.add('cairn');
  const tracker = new MissionTracker(STORY_MISSIONS);
  const facts = createFacts();
  facts.waterCollected = 2;
  tracker.update(facts);
  const stats = createStats();
  stats.distance = 1234; stats.days = day;
  const survival = createSurvival();
  survival.hunger = 42;
  const skills = createSkills();
  skills.navigation = 33;
  const session: SessionSnapshot = {
    config: defaultConfig(777), facts, stats, exploration: ex.serialize(), missions: tracker.serialize(), day, sawNight: true,
    discoveredCaveVisit: false, looted: ['camp:1'], tracked: 'wp:1', spawn: { x: 5, z: 5 }, outcome: null,
  };
  return {
    version: SAVE_VERSION, slot, name: 'Test', createdAt: 1, updatedAt: Date.now() + day, seed: 777,
    summary: { day, playSeconds: 99, explorationPct: ex.percent(), mission: 'Build a shelter', modeLabel: 'story', difficulty: 'survivor' },
    player: { x: 10, y: 20, z: 30, yaw: 1, pitch: 0.2 },
    gameplay: {
      difficulty: 'survivor', survival, inventory: inv.serialize(), skills,
      pieces: [{ id: 4, kind: 'campfire', x: 1, y: 2, z: 3, yaw: 0, durability: 100, fuel: 300 }],
      storages: { 4: new Inventory(12, 200).serialize() }, depleted: { 'node:1': 55 }, gameTime: 321, weather: 'fog', timeOfDay: 0.8,
    } as SaveData['gameplay'],
    session,
  };
}

describe('IndexedDB save slots', () => {
  let db: SaveDb;
  beforeEach(() => { db = new SaveDb(new IDBFactory()); });

  it('round-trips a full save without loss', async () => {
    const s = makeSave('1');
    await db.put(s);
    const back = await db.get('1');
    expect(back).toEqual(s);
    // Restoring through the same classes the game uses gives the same state.
    const inv = Inventory.deserialize(back!.gameplay.inventory);
    expect(inv.count('wood')).toBe(7);
    expect(back!.gameplay.survival.hunger).toBe(42);
    const ex = Exploration.deserialize(back!.session.exploration, 5, 5);
    expect(ex.revealedCount).toBeGreaterThan(10);
    expect(ex.waypoints[0].name).toBe('Camp');
    const tr = new MissionTracker(STORY_MISSIONS);
    tr.restore(back!.session.missions);
    expect(tr.current!.id).toBe('shelter');
    expect(back!.gameplay.depleted['node:1']).toBe(55);
    expect(back!.gameplay.weather).toBe('fog');
    expect(back!.player).toEqual(s.player);
    expect(back!.seed).toBe(777);
  });

  it('keeps multiple slots, lists newest first and overwrites by slot', async () => {
    await db.put(makeSave('1', 1));
    await db.put(makeSave('2', 5));
    await db.put(makeSave('auto', 3));
    let list = await db.list();
    expect(list.map((m) => m.slot)).toEqual(['2', 'auto', '1']);
    expect((await db.latest())!.slot).toBe('2');
    await db.put(makeSave('1', 9));
    list = await db.list();
    expect(list.length).toBe(3);
    expect(list[0].slot).toBe('1');
    expect(list[0].summary.day).toBe(9);
  });

  it('deletes a slot and returns null for missing ones', async () => {
    await db.put(makeSave('3'));
    await db.delete('3');
    expect(await db.get('3')).toBeNull();
    expect(await db.latest()).toBeNull();
  });

  it('rejects incompatible data', async () => {
    expect(() => validateSave({ version: 99 })).toThrow(/version/);
    expect(() => validateSave(null)).toThrow();
    expect(() => validateSave({ version: SAVE_VERSION })).toThrow(/incomplete/);
  });

  it('reports when IndexedDB is missing', async () => {
    const none = new SaveDb(null);
    expect(none.available).toBe(false);
    await expect(none.list()).rejects.toThrow(/not available/);
  });

  it('exposes labelled slots', () => {
    expect(SLOT_IDS).toContain('auto');
    expect(slotLabel('auto')).toBe('Autosave');
    expect(slotLabel('2')).toBe('Slot 2');
  });
});
