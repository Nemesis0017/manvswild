import { describe, expect, it } from 'vitest';
import { adjustMods, CHARACTERS, DEFAULT_SANDBOX, escalationForDay, SCENARIOS, scenarioById } from './modes';
import { createFacts, MissionTracker, STORY_MISSIONS } from './missions';
import {
  ACHIEVEMENTS, AchievementTracker, createRecords, createStats, formatDuration, loadRecords, recordEndless, recordExpedition, recordStory, saveRecords,
} from './progress';
import { DIFFICULTIES } from '../survival/difficulty';
import { addXp, createSkills, skillLevel, SKILL_IDS, SKILL_NAMES } from '../items/skills';

describe('mission chain', () => {
  it('has the ten story missions in order', () => {
    expect(STORY_MISSIONS.map((m) => m.id)).toEqual(['water', 'shelter', 'night', 'navigate', 'river', 'cave', 'supplies', 'summit', 'signal', 'extraction']);
  });
  it('advances one mission at a time as facts become true', () => {
    const t = new MissionTracker(STORY_MISSIONS);
    const f = createFacts();
    expect(t.update(f)).toEqual([]);
    f.waterCollected = 1;
    expect(t.update(f).map((m) => m.id)).toEqual(['water']);
    expect(t.current!.id).toBe('shelter');
    // Doing later things early only counts once their turn arrives.
    f.reached.cairn = true;
    expect(t.update(f)).toEqual([]);
    f.shelters = 1; f.nights = 1;
    expect(t.update(f).map((m) => m.id)).toEqual(['shelter', 'night', 'navigate']);
  });
  it('scripted playthrough completes the whole story', () => {
    const t = new MissionTracker(STORY_MISSIONS);
    const f = createFacts();
    const steps: (() => void)[] = [
      () => { f.waterCollected = 1; }, () => { f.shelters = 1; }, () => { f.nights = 1; }, () => { f.reached.cairn = true; },
      () => { f.riverCrossings = 1; }, () => { f.caveSeconds = 15; }, () => { f.campsitesLooted = 1; }, () => { f.summitReached = true; },
      () => { f.signalAtSummit = true; }, () => { f.extractionReached = true; },
    ];
    steps.forEach((step, i) => {
      expect(t.finished).toBe(false);
      step();
      expect(t.update(f).length).toBe(1);
      expect(t.index).toBe(i + 1);
    });
    expect(t.finished).toBe(true);
    const copy = new MissionTracker(STORY_MISSIONS);
    copy.restore(JSON.parse(JSON.stringify(t.serialize())));
    expect(copy.finished).toBe(true);
  });
  it('expedition scenarios have objectives and a start biome', () => {
    expect(SCENARIOS.length).toBeGreaterThanOrEqual(6);
    for (const s of SCENARIOS) {
      expect(s.missions.length).toBeGreaterThan(0);
      expect(scenarioById(s.id).biome).toBe(s.biome);
    }
    const snow = scenarioById('snow');
    const t = new MissionTracker(snow.missions);
    const f = createFacts();
    f.campfires = 1; f.minutesSurvived = 9;
    expect(t.update(f).length).toBe(2);
    expect(t.finished).toBe(true);
  });
});

describe('modes', () => {
  const base = DIFFICULTIES.survivor;
  const ctx = (over: object) => ({ mode: 'story' as const, escalation: 1, sandbox: { ...DEFAULT_SANDBOX }, scenario: null, ...over });
  it('endless gets harder every day and is capped', () => {
    expect(escalationForDay(1)).toBe(1);
    expect(escalationForDay(6)).toBeGreaterThan(escalationForDay(2));
    expect(escalationForDay(500)).toBe(2.5);
    const d1 = adjustMods(base, ctx({ mode: 'endless', escalation: 1 }));
    const d9 = adjustMods(base, ctx({ mode: 'endless', escalation: escalationForDay(9) }));
    expect(d1.drain).toBe(base.drain);
    expect(d9.drain).toBeGreaterThan(d1.drain);
    expect(d9.yield).toBeLessThan(d1.yield);
  });
  it('sandbox options switch needs and damage off', () => {
    const m = adjustMods(base, ctx({ mode: 'sandbox', sandbox: { ...DEFAULT_SANDBOX, needs: false, invulnerable: true, resourceMult: 2 } }));
    expect(m.drain).toBe(0);
    expect(m.damage).toBe(0);
    expect(m.yield).toBe(base.yield * 2);
  });
  it('story mode leaves difficulty unchanged', () => {
    expect(adjustMods(base, ctx({}))).toEqual(base);
  });
  it('characters grant a skill perk', () => {
    const s = createSkills();
    const c = CHARACTERS[0];
    addXp(s, c.perk.skill, c.perk.xp);
    expect(skillLevel(s[c.perk.skill])).toBe(2);
  });
});

describe('skills, stats and achievements', () => {
  it('has the nine named skills plus fieldcraft', () => {
    for (const n of ['Navigation', 'Endurance', 'Crafting', 'Gathering', 'Shelter', 'Swimming', 'Climbing', 'Awareness', 'Wildlife observation']) {
      expect(Object.values(SKILL_NAMES)).toContain(n);
    }
    expect(SKILL_IDS.length).toBe(10);
  });
  it('unlocks achievements once and reports them', () => {
    const a = new AchievementTracker();
    const s = createStats();
    expect(a.update(s, 0)).toEqual([]);
    s.distance = 150;
    expect(a.update(s, 0).map((x) => x.id)).toContain('first_steps');
    expect(a.update(s, 0)).toEqual([]);
    expect(a.unlockFlag('story_complete')!.id).toBe('story_done');
    expect(a.unlockFlag('story_complete')).toBeNull();
    const b = new AchievementTracker();
    b.restore(a.serialize());
    expect(b.unlocked.has('first_steps')).toBe(true);
    expect(new Set(ACHIEVEMENTS.map((x) => x.id)).size).toBe(ACHIEVEMENTS.length);
  });
  it('keeps records and persists them', () => {
    const r = createRecords();
    recordStory(r, 900); recordStory(r, 700);
    recordEndless(r, 4); recordEndless(r, 2);
    recordExpedition(r, 'snow', 300); recordExpedition(r, 'snow', 400);
    expect(r.story).toEqual({ bestSeconds: 700, completions: 2 });
    expect(r.endless.bestDays).toBe(4);
    expect(r.expeditions.snow).toEqual({ bestSeconds: 300, completions: 2 });
    const mem = new Map<string, string>();
    const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); } };
    saveRecords(r, storage);
    expect(loadRecords(storage)).toEqual(r);
    expect(formatDuration(3725)).toBe('1h 02m 05s');
  });
});
