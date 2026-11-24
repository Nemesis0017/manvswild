import { Store } from './store';

export type GraphicsPreset = 'low' | 'medium' | 'high' | 'ultra';

export interface Settings {
  preset: GraphicsPreset;
  fov: number;
  sensitivity: number;
  invertY: boolean;
  masterVolume: number;
  adaptiveResolution: boolean;
  /** Accessibility */
  reducedMotion: boolean;
  highContrast: boolean;
  uiScale: number;
  colorblind: 'none' | 'protanopia' | 'deuteranopia' | 'tritanopia';
  subtitles: boolean;
  seed: number;
}

export interface PresetValues {
  viewDistance: number; // in chunks
  pixelRatio: number;
  shadows: boolean;
  shadowMapSize: number;
  vegetationDensity: number;
  antialias: boolean;
}

export const PRESETS: Record<GraphicsPreset, PresetValues> = {
  low: { viewDistance: 3, pixelRatio: 0.75, shadows: false, shadowMapSize: 512, vegetationDensity: 0.4, antialias: false },
  medium: { viewDistance: 4, pixelRatio: 1, shadows: true, shadowMapSize: 1024, vegetationDensity: 0.7, antialias: false },
  high: { viewDistance: 5, pixelRatio: 1.25, shadows: true, shadowMapSize: 2048, vegetationDensity: 1, antialias: true },
  ultra: { viewDistance: 7, pixelRatio: 1.5, shadows: true, shadowMapSize: 4096, vegetationDensity: 1.3, antialias: true },
};

export const DEFAULT_SETTINGS: Settings = {
  preset: 'medium',
  fov: 70,
  sensitivity: 1,
  invertY: false,
  masterVolume: 0.7,
  adaptiveResolution: true,
  reducedMotion: false,
  highContrast: false,
  uiScale: 1,
  colorblind: 'none',
  subtitles: true,
  seed: 1337,
};

const KEY = 'manvswild.settings.v1';

export function loadSettings(): Settings {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null;
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    /* ignore corrupt data */
  }
  return { ...DEFAULT_SETTINGS };
}

export const settingsStore = new Store<Settings>(loadSettings());

settingsStore.subscribe(() => {
  try {
    localStorage.setItem(KEY, JSON.stringify(settingsStore.getState()));
  } catch {
    /* storage unavailable */
  }
});
