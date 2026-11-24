export type DifficultyId = 'explorer' | 'survivor' | 'extreme' | 'realistic';

export interface DifficultyMods {
  label: string;
  description: string;
  /** Multiplier on hunger, thirst, fatigue and temperature drift rates. */
  drain: number;
  /** Multiplier on how much resource nodes yield (lower is scarcer). */
  yield: number;
  /** Multiplier on node respawn time (higher is slower). */
  respawn: number;
  /** Multiplier on weather intensity, temperature swings and weather change of bad weather. */
  weatherSeverity: number;
  /** Multiplier on health damage from hazards. */
  damage: number;
  /** Multiplier on animal detection range. */
  detection: number;
  /** Multiplier on injury duration. */
  injury: number;
  /** HUD shows exact numbers, warnings and interaction hints. */
  hudAssist: boolean;
  /** Number of times the rescue team may bring the player back. Infinity means unlimited. */
  rescues: number;
}

export const DIFFICULTIES: Record<DifficultyId, DifficultyMods> = {
  explorer: {
    label: 'Explorer', description: 'Relaxed. Slow needs, generous resources, mild weather, unlimited rescues.',
    drain: 0.5, yield: 1.5, respawn: 0.6, weatherSeverity: 0.6, damage: 0.5, detection: 0.7, injury: 0.5, hudAssist: true, rescues: Infinity,
  },
  survivor: {
    label: 'Survivor', description: 'Balanced. Standard needs and weather. Three rescues.',
    drain: 1, yield: 1, respawn: 1, weatherSeverity: 1, damage: 1, detection: 1, injury: 1, hudAssist: true, rescues: 3,
  },
  extreme: {
    label: 'Extreme', description: 'Fast needs, scarce resources, harsh weather. One rescue.',
    drain: 1.5, yield: 0.7, respawn: 1.6, weatherSeverity: 1.4, damage: 1.5, detection: 1.3, injury: 1.5, hudAssist: true, rescues: 1,
  },
  realistic: {
    label: 'Realistic', description: 'Harsh and unforgiving. No exact numbers on the HUD, no rescue.',
    drain: 1.3, yield: 0.6, respawn: 2, weatherSeverity: 1.6, damage: 1.8, detection: 1.4, injury: 2, hudAssist: false, rescues: 0,
  },
};

export const DIFFICULTY_IDS = Object.keys(DIFFICULTIES) as DifficultyId[];
