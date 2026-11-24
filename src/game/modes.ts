import type { ItemId } from '../items/items';
import type { DifficultyMods } from '../survival/difficulty';
import type { Biome } from '../world/terrain';
import type { WeatherId } from '../world/weather';
import type { Facts, MissionDef } from './missions';

export type ModeId = 'story' | 'endless' | 'sandbox' | 'expedition';
export const MODE_IDS: ModeId[] = ['story', 'endless', 'sandbox', 'expedition'];

export const MODE_INFO: Record<ModeId, { label: string; description: string }> = {
  story: { label: 'Story', description: 'A guided chain of ten missions from finding water to extraction.' },
  endless: { label: 'Endless Survival', description: 'No goal but time. Each new day is harsher than the last. How many days can you last?' },
  sandbox: { label: 'Sandbox', description: 'Your rules. Switch needs, damage, weather and the clock on or off.' },
  expedition: { label: 'Expedition', description: 'A scenario in a chosen biome with its own objectives and restrictions.' },
};

export interface SandboxOptions {
  needs: boolean;
  invulnerable: boolean;
  weather: 'auto' | WeatherId;
  /** Multiplier on day length: 1 normal, 0.25 means days pass four times faster. */
  dayLengthMult: number;
  startKit: boolean;
  resourceMult: number;
}

export const DEFAULT_SANDBOX: SandboxOptions = { needs: true, invulnerable: false, weather: 'auto', dayLengthMult: 1, startKit: true, resourceMult: 1 };

export interface Character {
  id: string;
  name: string;
  description: string;
  /** Shirt color (hex). */
  color: number;
  /** Starting xp bonus. */
  perk: { skill: 'navigation' | 'foraging' | 'crafting' | 'endurance'; xp: number };
}

export const CHARACTERS: Character[] = [
  { id: 'scout', name: 'Scout', description: 'Reads maps and terrain. Starts with navigation experience.', color: 0x6a7f4a, perk: { skill: 'navigation', xp: 20 } },
  { id: 'forager', name: 'Forager', description: 'Knows plants and berries. Starts with gathering experience.', color: 0x9a6a3a, perk: { skill: 'foraging', xp: 20 } },
  { id: 'tinkerer', name: 'Tinkerer', description: 'Good with knots and tools. Starts with crafting experience.', color: 0x4a6a8a, perk: { skill: 'crafting', xp: 20 } },
  { id: 'runner', name: 'Trail runner', description: 'Fit and tireless. Starts with endurance experience.', color: 0xa84a3a, perk: { skill: 'endurance', xp: 20 } },
];

export const characterById = (id: string): Character => CHARACTERS.find((c) => c.id === id) ?? CHARACTERS[0];

export interface Scenario {
  id: string;
  name: string;
  biome: Biome;
  brief: string;
  restrictions: string[];
  startItems: { id: ItemId; count: number }[];
  weather?: WeatherId;
  drainMult?: number;
  /** Real-time minutes after which the expedition fails. */
  timeLimitMin?: number;
  missions: MissionDef[];
}

const reach = (id: string) => (f: Facts) => !!f.reached[id];
const water: MissionDef = { id: 'x_water', title: 'Find water', description: 'Collect water from a lake, river or pond (face it, E).', hint: 'Water is blue on the map.', check: (f) => f.waterCollected >= 1 };
const fire: MissionDef = { id: 'x_fire', title: 'Light a campfire', description: 'Build a campfire (B) with 3 wood and 4 stone.', hint: 'Wood comes from fallen logs.', check: (f) => f.campfires >= 1 };
const beacon: MissionDef = { id: 'x_beacon', title: 'Reach the beacon', description: 'Travel to the ranger cairn marked on your map.', hint: 'Use the compass.', check: reach('cairn') };
const extract: MissionDef = { id: 'x_extract', title: 'Reach extraction', description: 'Make it to the extraction point.', hint: 'It is marked on the map.', check: (f) => f.extractionReached };
const survive = (min: number): MissionDef => ({
  id: 'x_survive', title: `Survive ${min} minutes`, description: `Stay alive for ${min} minutes of play.`, hint: 'Keep warm, fed and hydrated.',
  check: (f) => f.minutesSurvived >= min, progress: (f) => `${Math.floor(f.minutesSurvived)} / ${min} min`,
});

export const SCENARIOS: Scenario[] = [
  {
    id: 'desert', name: 'Dry Crossing', biome: 'desert', brief: 'Heat and little water. Find a source, then reach the cairn.',
    restrictions: ['Faster thirst', 'No waterskin at start'], startItems: [{ id: 'berries', count: 2 }, { id: 'leaf', count: 6 }, { id: 'fiber', count: 4 }],
    drainMult: 1.25, missions: [water, beacon, extract],
  },
  {
    id: 'tropical', name: 'Rainforest Trek', biome: 'tropical', brief: 'Dense, wet and slippery. Build a fire in the rain and reach the cairn.',
    restrictions: ['Heavy rain throughout'], startItems: [{ id: 'waterskin', count: 1 }, { id: 'branch', count: 3 }], weather: 'heavy_rain',
    missions: [fire, beacon, extract],
  },
  {
    id: 'swamp', name: 'Black Water', biome: 'swamp', brief: 'Flat, foggy wetland. Find your footing and clean water.',
    restrictions: ['Fog throughout', 'Untreated water only'], startItems: [{ id: 'waterskin', count: 1 }, { id: 'stone', count: 4 }], weather: 'fog',
    missions: [water, fire, beacon],
  },
  {
    id: 'mountain', name: 'Pass of Winds', biome: 'mountain', brief: 'Steep and exposed. Reach the cairn before the weather turns.',
    restrictions: ['Strong wind', 'Twenty minute limit'], startItems: [{ id: 'waterskin', count: 1 }, { id: 'fiber_jacket', count: 1 }], weather: 'strong_wind',
    timeLimitMin: 20, missions: [beacon, extract],
  },
  {
    id: 'snow', name: 'Whiteout', biome: 'snow', brief: 'Bitter cold. Keep a fire alive and outlast the storm.',
    restrictions: ['Snowstorm throughout', 'Faster cooling'], startItems: [{ id: 'wood', count: 4 }, { id: 'stone', count: 6 }, { id: 'fiber_jacket', count: 1 }], weather: 'snowstorm',
    drainMult: 1.15, missions: [fire, survive(8)],
  },
  {
    id: 'grassland', name: 'River Run', biome: 'grassland', brief: 'A gentle start. Find water, light a fire and get out.',
    restrictions: ['No backpack'], startItems: [{ id: 'waterskin', count: 1 }, { id: 'berries', count: 4 }],
    missions: [water, fire, beacon, extract],
  },
];

export const scenarioById = (id: string): Scenario => SCENARIOS.find((s) => s.id === id) ?? SCENARIOS[0];

/** Endless mode escalation factor for a given day (1 on day 1). */
export const escalationForDay = (day: number): number => Math.min(2.5, 1 + 0.12 * Math.max(0, day - 1));

export interface ModeContext {
  mode: ModeId;
  escalation: number;
  sandbox: SandboxOptions;
  scenario: Scenario | null;
}

/** Apply mode adjustments on top of difficulty modifiers. Pure. */
export function adjustMods(base: DifficultyMods, ctx: ModeContext): DifficultyMods {
  const m = { ...base };
  if (ctx.mode === 'endless') {
    const e = ctx.escalation;
    m.drain *= e; m.weatherSeverity *= 1 + (e - 1) * 0.6; m.damage *= 1 + (e - 1) * 0.5;
    m.yield /= 1 + (e - 1) * 0.4; m.respawn *= 1 + (e - 1) * 0.5; m.detection *= 1 + (e - 1) * 0.3;
  } else if (ctx.mode === 'sandbox') {
    const s = ctx.sandbox;
    if (!s.needs) m.drain = 0;
    if (s.invulnerable) { m.damage = 0; m.injury = 0; }
    m.yield *= s.resourceMult;
  } else if (ctx.mode === 'expedition' && ctx.scenario?.drainMult) {
    m.drain *= ctx.scenario.drainMult;
  }
  return m;
}

/** Turn user text into a world seed. Numbers are used as given; other text is hashed. */
export function parseSeed(text: string): number {
  const t = text.trim();
  if (t === '') return 1337;
  if (/^-?\d{1,9}$/.test(t)) return Math.abs(parseInt(t, 10)) || 1;
  let h = 2166136261;
  for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) % 1000000000 || 1;
}
