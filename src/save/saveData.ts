import type { Gameplay } from '../gameplay/gameplay';
import type { SessionSnapshot } from '../game/session';

export const SAVE_VERSION = 1;

export interface SaveSummary {
  day: number;
  playSeconds: number;
  explorationPct: number;
  mission: string;
  modeLabel: string;
  difficulty: string;
}

export interface SaveData {
  version: number;
  slot: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  seed: number;
  summary: SaveSummary;
  player: { x: number; y: number; z: number; yaw: number; pitch: number };
  gameplay: ReturnType<Gameplay['snapshot']>;
  session: SessionSnapshot;
}

export type SaveMeta = Pick<SaveData, 'slot' | 'name' | 'createdAt' | 'updatedAt' | 'seed' | 'summary' | 'version'>;

export const SLOT_IDS = ['auto', 'quick', '1', '2', '3', '4', '5'] as const;
export const slotLabel = (id: string): string => (id === 'auto' ? 'Autosave' : id === 'quick' ? 'Quicksave' : `Slot ${id}`);

export const toMeta = (d: SaveData): SaveMeta => ({
  slot: d.slot, name: d.name, createdAt: d.createdAt, updatedAt: d.updatedAt, seed: d.seed, summary: d.summary, version: d.version,
});

/** Throws if the data cannot be loaded by this version of the game. */
export function validateSave(d: unknown): SaveData {
  const s = d as Partial<SaveData> | null;
  if (!s || typeof s !== 'object') throw new Error('Save is empty');
  if (s.version !== SAVE_VERSION) throw new Error(`Unsupported save version ${String(s.version)}`);
  if (!s.gameplay || !s.session || !s.player || typeof s.seed !== 'number') throw new Error('Save is incomplete');
  return s as SaveData;
}
