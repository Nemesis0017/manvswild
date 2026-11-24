import { WATER_Y, type Biome } from '../world/terrain';

export type Surface = 'grass' | 'sand' | 'rock' | 'snow' | 'mud' | 'shallow';

/** Footstep surface from where the player stands. */
export function surfaceAt(biome: Biome, height: number, inCave: boolean): Surface {
  if (inCave) return 'rock';
  if (height < WATER_Y + 0.35) return 'shallow';
  switch (biome) {
    case 'desert': return 'sand';
    case 'snow': return 'snow';
    case 'mountain': return 'rock';
    case 'swamp': return 'mud';
    default: return 'grass';
  }
}

export interface StepParams { type: BiquadFilterType; freq: number; q: number; dur: number; gain: number }

export const STEP_PARAMS: Record<Surface, StepParams> = {
  grass: { type: 'lowpass', freq: 1100, q: 0.7, dur: 0.09, gain: 0.5 },
  sand: { type: 'highpass', freq: 1800, q: 0.5, dur: 0.14, gain: 0.35 },
  rock: { type: 'bandpass', freq: 2200, q: 1.4, dur: 0.05, gain: 0.7 },
  snow: { type: 'highpass', freq: 1400, q: 0.6, dur: 0.17, gain: 0.45 },
  mud: { type: 'lowpass', freq: 450, q: 1.2, dur: 0.16, gain: 0.7 },
  shallow: { type: 'bandpass', freq: 1500, q: 0.8, dur: 0.22, gain: 0.6 },
};

/** Distance walked between footsteps in meters. */
export function stepInterval(speed: number, sprinting: boolean, crouching: boolean): number {
  if (crouching) return 1.1;
  return sprinting ? 2.3 : speed > 3 ? 1.9 : 1.5;
}
