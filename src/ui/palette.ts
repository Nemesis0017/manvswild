import type { Settings } from '../core/settings';

export interface Palette { health: string; hunger: string; thirst: string; stamina: string; cold: string; hot: string; ok: string; fatigue: string; wet: string }

const DEFAULT: Palette = { health: '#d95a5a', hunger: '#d9a441', thirst: '#4aa3df', stamina: '#7ac35a', cold: '#6aa0ff', hot: '#ff7a40', ok: '#c8d070', fatigue: '#9a7ad0', wet: '#5ac8c8' };
/** Okabe-Ito based set that stays distinguishable for red-green color blindness. */
const RG: Palette = { health: '#d55e00', hunger: '#e69f00', thirst: '#0072b2', stamina: '#f0e442', cold: '#56b4e9', hot: '#cc79a7', ok: '#f0e442', fatigue: '#999999', wet: '#56b4e9' };
const BY: Palette = { health: '#e0405e', hunger: '#ff9a30', thirst: '#20b0a0', stamina: '#dddddd', cold: '#20b0a0', hot: '#e0405e', ok: '#dddddd', fatigue: '#b070b0', wet: '#20b0a0' };

export function paletteFor(mode: Settings['colorblind']): Palette {
  return mode === 'none' ? DEFAULT : mode === 'tritanopia' ? BY : RG;
}
