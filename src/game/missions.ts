import type { SkillId } from '../items/skills';

/** Cumulative facts observed by the session. Mission checks read only this. */
export interface Facts {
  waterCollected: number;
  shelters: number;
  campfires: number;
  nights: number;
  reached: Record<string, boolean>;
  riverCrossings: number;
  caveSeconds: number;
  campsitesLooted: number;
  summitReached: boolean;
  signalAtSummit: boolean;
  signals: number;
  extractionReached: boolean;
  minutesSurvived: number;
  itemsCrafted: number;
  fishCaught: number;
}

export const createFacts = (): Facts => ({
  waterCollected: 0, shelters: 0, campfires: 0, nights: 0, reached: {}, riverCrossings: 0, caveSeconds: 0, campsitesLooted: 0,
  summitReached: false, signalAtSummit: false, signals: 0, extractionReached: false, minutesSurvived: 0, itemsCrafted: 0, fishCaught: 0,
});

export interface MissionDef {
  id: string;
  title: string;
  description: string;
  hint: string;
  check: (f: Facts) => boolean;
  /** Short progress text such as "1 / 2". */
  progress?: (f: Facts) => string;
  reward?: { skill: SkillId; xp: number };
}

export const STORY_MISSIONS: MissionDef[] = [
  {
    id: 'water', title: 'Find water', description: 'Every plan starts with water. Face a lake or river and press E to fill your waterskin.',
    hint: 'Rivers and lakes show as blue on the map. Boil water at a campfire before drinking.',
    check: (f) => f.waterCollected >= 1, reward: { skill: 'fieldcraft', xp: 20 },
  },
  {
    id: 'shelter', title: 'Build a shelter', description: 'Gather branches, leaves and fiber, craft rope, then place a shelter with B.',
    hint: 'Shelter needs 8 branches, 10 leaves and 1 rope. It requires Fieldcraft 2, which you just earned.',
    check: (f) => f.shelters >= 1,
  },
  {
    id: 'night', title: 'Survive the first night', description: 'Stay warm and alive until dawn. A campfire and a shelter help a lot. You can rest with R.',
    hint: 'Night falls around 19:00 and ends around 06:30.',
    check: (f) => f.nights >= 1,
    progress: (f) => `${f.nights} / 1`,
  },
  {
    id: 'navigate', title: 'Navigate to the ranger cairn', description: 'A ranger cairn stands within a few hundred meters. Use the compass and map (M).',
    hint: 'Place waypoints on the map with a click, or press X in the world.',
    check: (f) => !!f.reached.cairn, reward: { skill: 'navigation', xp: 20 },
  },
  {
    id: 'river', title: 'Cross a river', description: 'Swim or wade across a river from one bank to the other. Currents push you downstream.',
    hint: 'Hold a raft for faster, less tiring swimming. Watch your stamina.',
    check: (f) => f.riverCrossings >= 1, reward: { skill: 'swimming', xp: 15 },
  },
  {
    id: 'cave', title: 'Explore a cave', description: 'Enter a cave in the mountains and spend a little time inside. Bring a torch.',
    hint: 'Caves are marked on the map once you discover them.',
    check: (f) => f.caveSeconds >= 15,
    progress: (f) => `${Math.min(15, Math.floor(f.caveSeconds))} / 15 s`,
  },
  {
    id: 'supplies', title: 'Find abandoned supplies', description: 'Search an abandoned campsite and take its supplies with E.',
    hint: 'Campsites appear on the map once discovered.',
    check: (f) => f.campsitesLooted >= 1,
  },
  {
    id: 'summit', title: 'Reach the summit', description: 'Climb to the highest peak. Walk into steep rock to climb. Mind the weather and loose rock.',
    hint: 'The summit is marked on the map once you have seen it. Bring warm clothing and a signal kit.',
    check: (f) => f.summitReached, reward: { skill: 'climbing', xp: 25 },
  },
  {
    id: 'signal', title: 'Light a signal', description: 'Use a signal kit at the summit to raise a tall smoke signal.',
    hint: 'Craft a signal kit: 3 branches, 6 leaves, 2 wood. It needs Fieldcraft 2.',
    check: (f) => f.signalAtSummit,
  },
  {
    id: 'extraction', title: 'Reach the extraction point', description: 'Rescuers saw your signal. Get to the extraction point to be flown out.',
    hint: 'Set a waypoint on the extraction marker and follow the compass.',
    check: (f) => f.extractionReached,
  },
];

export class MissionTracker {
  index = 0;
  completed: string[] = [];

  constructor(readonly defs: MissionDef[]) {}

  get current(): MissionDef | null { return this.defs[this.index] ?? null; }
  get finished(): boolean { return this.index >= this.defs.length; }

  /** Evaluate against facts, completing as many consecutive missions as are satisfied. */
  update(f: Facts): MissionDef[] {
    const done: MissionDef[] = [];
    while (!this.finished && this.current!.check(f)) {
      const m = this.current!;
      this.completed.push(m.id);
      this.index++;
      done.push(m);
    }
    return done;
  }

  serialize(): { index: number; completed: string[] } {
    return { index: this.index, completed: [...this.completed] };
  }

  restore(d: { index: number; completed: string[] }): void {
    this.index = Math.min(d.index, this.defs.length);
    this.completed = [...d.completed];
  }
}
