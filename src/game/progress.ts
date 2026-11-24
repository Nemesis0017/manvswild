/** Stats, achievements and expedition records. Pure logic. */

export interface Stats {
  distance: number;
  playSeconds: number;
  days: number;
  nights: number;
  itemsGathered: number;
  itemsCrafted: number;
  structuresBuilt: number;
  fishCaught: number;
  waterCollected: number;
  poisDiscovered: number;
  cavesExplored: number;
  animalsObserved: number;
  rescues: number;
  signals: number;
  highestPoint: number;
  swimSeconds: number;
  climbSeconds: number;
  campsitesLooted: number;
  missionsCompleted: number;
  riverCrossings: number;
  stonesThrown: number;
}

export const createStats = (): Stats => ({
  distance: 0, playSeconds: 0, days: 1, nights: 0, itemsGathered: 0, itemsCrafted: 0, structuresBuilt: 0, fishCaught: 0, waterCollected: 0,
  poisDiscovered: 0, cavesExplored: 0, animalsObserved: 0, rescues: 0, signals: 0, highestPoint: 0, swimSeconds: 0, climbSeconds: 0,
  campsitesLooted: 0, missionsCompleted: 0, riverCrossings: 0, stonesThrown: 0,
});

export const normalizeStats = (s: Partial<Stats>): Stats => ({ ...createStats(), ...s });

export const STAT_LABELS: Record<keyof Stats, string> = {
  distance: 'Distance traveled (m)', playSeconds: 'Time played (s)', days: 'Current day', nights: 'Nights survived', itemsGathered: 'Items gathered',
  itemsCrafted: 'Items crafted', structuresBuilt: 'Structures built', fishCaught: 'Fish caught', waterCollected: 'Water collected',
  poisDiscovered: 'Places discovered', cavesExplored: 'Caves explored', animalsObserved: 'Animals observed', rescues: 'Rescues',
  signals: 'Signals raised', highestPoint: 'Highest point (m)', swimSeconds: 'Time swimming (s)', climbSeconds: 'Time climbing (s)',
  campsitesLooted: 'Campsites searched', missionsCompleted: 'Missions completed', riverCrossings: 'River crossings', stonesThrown: 'Stones thrown',
};

export interface Achievement {
  id: string;
  name: string;
  description: string;
  check: (s: Stats, explorationPercent: number) => boolean;
}

export const ACHIEVEMENTS: Achievement[] = [
  { id: 'first_steps', name: 'First steps', description: 'Walk 100 meters.', check: (s) => s.distance >= 100 },
  { id: 'trailblazer', name: 'Trailblazer', description: 'Walk 5 kilometers.', check: (s) => s.distance >= 5000 },
  { id: 'gatherer', name: 'Gatherer', description: 'Gather 25 items.', check: (s) => s.itemsGathered >= 25 },
  { id: 'maker', name: 'Maker', description: 'Craft 10 items.', check: (s) => s.itemsCrafted >= 10 },
  { id: 'homesteader', name: 'Homesteader', description: 'Build 3 structures.', check: (s) => s.structuresBuilt >= 3 },
  { id: 'angler', name: 'Angler', description: 'Catch 3 fish.', check: (s) => s.fishCaught >= 3 },
  { id: 'hydrated', name: 'Hydrated', description: 'Collect water 5 times.', check: (s) => s.waterCollected >= 5 },
  { id: 'night_owl', name: 'Through the night', description: 'Survive a night.', check: (s) => s.nights >= 1 },
  { id: 'week', name: 'A week out', description: 'Reach day 7.', check: (s) => s.days >= 7 },
  { id: 'spelunker', name: 'Spelunker', description: 'Explore a cave.', check: (s) => s.cavesExplored >= 1 },
  { id: 'scavenger', name: 'Scavenger', description: 'Search an abandoned campsite.', check: (s) => s.campsitesLooted >= 1 },
  { id: 'swimmer', name: 'Strong swimmer', description: 'Swim for 60 seconds in total.', check: (s) => s.swimSeconds >= 60 },
  { id: 'climber', name: 'Climber', description: 'Climb for 60 seconds in total.', check: (s) => s.climbSeconds >= 60 },
  { id: 'crossing', name: 'Across the water', description: 'Cross a river.', check: (s) => s.riverCrossings >= 1 },
  { id: 'high', name: 'Above the trees', description: 'Reach 80 meters of altitude.', check: (s) => s.highestPoint >= 80 },
  { id: 'observer', name: 'Quiet observer', description: 'Observe animals from a distance 20 times.', check: (s) => s.animalsObserved >= 20 },
  { id: 'smoke', name: 'Smoke on the horizon', description: 'Raise a signal.', check: (s) => s.signals >= 1 },
  { id: 'explorer10', name: 'Getting around', description: 'Explore 10 percent of the map.', check: (_s, e) => e >= 10 },
  { id: 'explorer25', name: 'Cartographer', description: 'Explore 25 percent of the map.', check: (_s, e) => e >= 25 },
  { id: 'discoverer', name: 'Discoverer', description: 'Discover 8 places.', check: (s) => s.poisDiscovered >= 8 },
  { id: 'rescued', name: 'Safe hands', description: 'Be found by a rescue team.', check: (s) => s.rescues >= 1 },
  { id: 'missions5', name: 'On a mission', description: 'Complete 5 missions.', check: (s) => s.missionsCompleted >= 5 },
  { id: 'story_done', name: 'Extracted', description: 'Complete the Story mode.', check: () => false },
  { id: 'expedition_done', name: 'Expedition complete', description: 'Complete an Expedition scenario.', check: () => false },
];

/** Achievements with the given manual flag unlock through `unlockFlag`. */
export const FLAG_ACHIEVEMENTS: Record<string, string> = { story_complete: 'story_done', expedition_complete: 'expedition_done' };

export class AchievementTracker {
  unlocked = new Map<string, number>();

  /** Returns achievements unlocked by this call. */
  update(stats: Stats, explorationPercent: number): Achievement[] {
    const out: Achievement[] = [];
    for (const a of ACHIEVEMENTS) {
      if (this.unlocked.has(a.id)) continue;
      if (a.check(stats, explorationPercent)) { this.unlocked.set(a.id, stats.playSeconds); out.push(a); }
    }
    return out;
  }

  unlockFlag(flag: string, at = 0): Achievement | null {
    const id = FLAG_ACHIEVEMENTS[flag];
    if (!id || this.unlocked.has(id)) return null;
    this.unlocked.set(id, at);
    return ACHIEVEMENTS.find((a) => a.id === id) ?? null;
  }

  serialize(): [string, number][] { return [...this.unlocked]; }
  restore(d: [string, number][]): void { this.unlocked = new Map(d); }
}

export interface Records {
  story: { bestSeconds: number | null; completions: number };
  endless: { bestDays: number };
  expeditions: Record<string, { bestSeconds: number; completions: number }>;
  /** Achievements are account wide, not per save. */
  achievements: [string, number][];
}

export const createRecords = (): Records => ({ story: { bestSeconds: null, completions: 0 }, endless: { bestDays: 0 }, expeditions: {}, achievements: [] });

export function recordStory(r: Records, seconds: number): void {
  r.story.completions++;
  r.story.bestSeconds = r.story.bestSeconds === null ? seconds : Math.min(r.story.bestSeconds, seconds);
}
export function recordEndless(r: Records, days: number): void {
  r.endless.bestDays = Math.max(r.endless.bestDays, days);
}
export function recordExpedition(r: Records, id: string, seconds: number): void {
  const e = r.expeditions[id] ?? { bestSeconds: seconds, completions: 0 };
  e.completions++;
  e.bestSeconds = Math.min(e.bestSeconds, seconds);
  r.expeditions[id] = e;
}

const KEY = 'manvswild.records.v1';
export function loadRecords(storage: Pick<Storage, 'getItem'> | undefined = typeof localStorage !== 'undefined' ? localStorage : undefined): Records {
  try {
    const raw = storage?.getItem(KEY);
    if (raw) return { ...createRecords(), ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return createRecords();
}
export function saveRecords(r: Records, storage: Pick<Storage, 'setItem'> | undefined = typeof localStorage !== 'undefined' ? localStorage : undefined): void {
  try { storage?.setItem(KEY, JSON.stringify(r)); } catch { /* ignore */ }
}

export function formatDuration(sec: number): string {
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return (h ? `${h}h ` : '') + `${String(m).padStart(h ? 2 : 1, '0')}m ${String(r).padStart(2, '0')}s`;
}
