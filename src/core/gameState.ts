import { Store } from './store';
import type { Biome } from '../world/terrain';

export type GameStatus = 'loading' | 'menu' | 'playing' | 'paused';

export interface GameState {
  status: GameStatus;
  loadMessage: string;
  pointerLocked: boolean;
  cameraMode: 'first' | 'third';
  introActive: boolean;
  biome: Biome;
  inCave: boolean;
  underwater: boolean;
  swimming: boolean;
  climbing: boolean;
  /** 0..1 */
  timeOfDay: number;
  heading: number; // radians, 0 = north (-Z)
  x: number; y: number; z: number;
  fps: number;
  pixelRatio: number;
  chunks: number;
  error: string | null;
}

/** Shared plain store; React reads through useSyncExternalStore. */
export const gameStore = new Store<GameState>({
  status: 'loading',
  loadMessage: 'Starting',
  pointerLocked: false,
  cameraMode: 'first',
  introActive: false,
  biome: 'grassland',
  inCave: false,
  underwater: false,
  swimming: false,
  climbing: false,
  timeOfDay: 0.38,
  heading: 0,
  x: 0, y: 0, z: 0,
  fps: 0,
  pixelRatio: 1,
  chunks: 0,
  error: null,
});
