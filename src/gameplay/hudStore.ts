import { Store } from '../core/store';
import type { DifficultyId } from '../survival/difficulty';
import type { Equipment, Stack } from '../items/inventory';
import type { Phase } from '../survival/survival';

export type Panel = 'none' | 'inventory' | 'storage' | 'map' | 'journal' | 'achievements' | 'stats' | 'skills';

export interface RecipeView {
  id: string;
  name: string;
  cost: string;
  description: string;
  /** Null when craftable now. */
  blocker: string | null;
  build: boolean;
}

export interface HudState {
  health: number; hunger: number; thirst: number; stamina: number; temp: number; fatigue: number; wetness: number;
  warnings: string[];
  assist: boolean;
  difficulty: DifficultyId;
  weather: string;
  ambient: number;
  clock: string;
  hotbar: (Stack | null)[];
  selected: number;
  slots: (Stack | null)[];
  equipment: Equipment;
  weight: number;
  weightLimit: number;
  prompt: string;
  messages: { id: number; text: string }[];
  panel: Panel;
  storage: (Stack | null)[] | null;
  build: { active: boolean; kind: string; valid: boolean; reason: string; recipeId: string } | null;
  recipes: RecipeView[];
  skills: { id: string; name: string; level: number }[];
  fade: number;
  phase: Phase;
  failReason: string;
  rescuesLeft: number;
  resting: boolean;
  fishing: string;
  signalActive: boolean;
  animal: string;
}

export const hudStore = new Store<HudState>({
  health: 100, hunger: 100, thirst: 100, stamina: 100, temp: 37, fatigue: 0, wetness: 0,
  warnings: [], assist: true, difficulty: 'survivor', weather: 'Clear', ambient: 20, clock: '09:00',
  hotbar: [], selected: 0, slots: [], equipment: {}, weight: 0, weightLimit: 25, prompt: '', messages: [],
  panel: 'none', storage: null, build: null, recipes: [], skills: [], fade: 0, phase: 'alive', failReason: '',
  rescuesLeft: 0, resting: false, fishing: '', signalActive: false, animal: '',
});
