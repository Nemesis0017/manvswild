import { clamp } from './rng';
import type { Biome } from './terrain';

export type WeatherId =
  | 'clear' | 'heavy_rain' | 'thunderstorm' | 'snowstorm' | 'fog' | 'strong_wind' | 'heatwave' | 'cold_front';

export const WEATHER_IDS: WeatherId[] = ['clear', 'heavy_rain', 'thunderstorm', 'snowstorm', 'fog', 'strong_wind', 'heatwave', 'cold_front'];

export const WEATHER_NAMES: Record<WeatherId, string> = {
  clear: 'Clear', heavy_rain: 'Heavy rain', thunderstorm: 'Thunderstorm', snowstorm: 'Snowstorm', fog: 'Fog',
  strong_wind: 'Strong wind', heatwave: 'Heatwave', cold_front: 'Cold front',
};

/** Odds of each weather being picked next, per biome. */
export const BIOME_WEATHER: Record<Biome, Record<WeatherId, number>> = {
  grassland: { clear: 10, heavy_rain: 3, thunderstorm: 2, snowstorm: 0, fog: 2, strong_wind: 3, heatwave: 1.5, cold_front: 1.5 },
  tropical: { clear: 6, heavy_rain: 6, thunderstorm: 4, snowstorm: 0, fog: 2, strong_wind: 1, heatwave: 1.5, cold_front: 0 },
  swamp: { clear: 5, heavy_rain: 4, thunderstorm: 3, snowstorm: 0, fog: 6, strong_wind: 1, heatwave: 1, cold_front: 0.5 },
  desert: { clear: 12, heavy_rain: 0.4, thunderstorm: 0.3, snowstorm: 0, fog: 0.2, strong_wind: 4, heatwave: 6, cold_front: 0.8 },
  mountain: { clear: 6, heavy_rain: 3, thunderstorm: 3, snowstorm: 2, fog: 3, strong_wind: 5, heatwave: 0, cold_front: 3 },
  snow: { clear: 5, heavy_rain: 0.5, thunderstorm: 0, snowstorm: 6, fog: 3, strong_wind: 4, heatwave: 0, cold_front: 4 },
};

export interface WeatherEffects {
  /** 0..1 rain amount (zero in snow biomes, where it is snow instead). */
  rain: number;
  snow: number;
  /** Multiplier on fog distance, below 1 reduces visibility. */
  visibility: number;
  /** 0..1 */
  wind: number;
  /** Degrees added to ambient temperature. */
  tempOffset: number;
  /** 0..1 chance weight of lightning. */
  lightning: number;
  /** Multiplier on player movement speed. */
  movement: number;
  /** 0..1 how overcast the sky is. */
  cloudCover: number;
  /** 0..1 how much the sun is dimmed. */
  dim: number;
}

const BASE: Record<WeatherId, WeatherEffects> = {
  clear: { rain: 0, snow: 0, visibility: 1, wind: 0.1, tempOffset: 0, lightning: 0, movement: 1, cloudCover: 0.15, dim: 0 },
  heavy_rain: { rain: 1, snow: 0, visibility: 0.55, wind: 0.4, tempOffset: -5, lightning: 0, movement: 0.95, cloudCover: 0.9, dim: 0.5 },
  thunderstorm: { rain: 1, snow: 0, visibility: 0.45, wind: 0.7, tempOffset: -6, lightning: 1, movement: 0.9, cloudCover: 1, dim: 0.7 },
  snowstorm: { rain: 0, snow: 1, visibility: 0.3, wind: 0.8, tempOffset: -12, lightning: 0, movement: 0.8, cloudCover: 0.95, dim: 0.55 },
  fog: { rain: 0, snow: 0, visibility: 0.25, wind: 0.05, tempOffset: -2, lightning: 0, movement: 1, cloudCover: 0.6, dim: 0.25 },
  strong_wind: { rain: 0, snow: 0, visibility: 0.9, wind: 1, tempOffset: -3, lightning: 0, movement: 0.9, cloudCover: 0.4, dim: 0.1 },
  heatwave: { rain: 0, snow: 0, visibility: 0.95, wind: 0.05, tempOffset: 12, lightning: 0, movement: 1, cloudCover: 0, dim: 0 },
  cold_front: { rain: 0, snow: 0, visibility: 0.8, wind: 0.5, tempOffset: -10, lightning: 0, movement: 1, cloudCover: 0.6, dim: 0.2 },
};

/** Whether this weather can start in this biome at this time (0..1 day fraction). */
export function weatherAllowed(w: WeatherId, biome: Biome, timeOfDay: number): boolean {
  if (BIOME_WEATHER[biome][w] <= 0) return false;
  const day = timeOfDay > 0.27 && timeOfDay < 0.76;
  if (w === 'heatwave' && !day) return false;
  return true;
}

/** Effects at full strength for a weather in a biome, scaled by difficulty severity. */
export function weatherEffectsFor(w: WeatherId, biome: Biome, severity: number): WeatherEffects {
  const e = { ...BASE[w] };
  // Heavy precipitation falls as snow in cold biomes.
  if (biome === 'snow' && e.rain > 0) { e.snow = e.rain; e.rain = 0; }
  if (biome === 'mountain' && w === 'heavy_rain') { e.tempOffset -= 3; }
  const sev = (v: number) => v * severity;
  e.tempOffset = e.tempOffset * severity;
  e.wind = clamp(sev(e.wind), 0, 1);
  e.visibility = clamp(1 - (1 - e.visibility) * severity, 0.15, 1);
  e.movement = clamp(1 - (1 - e.movement) * severity, 0.5, 1);
  return e;
}

export function pickWeather(biome: Biome, timeOfDay: number, current: WeatherId, r: number): WeatherId {
  const entries = WEATHER_IDS.filter((w) => weatherAllowed(w, biome, timeOfDay));
  // Strong bias against repeating the same weather and toward clear after stormy spells.
  const weights = entries.map((w) => BIOME_WEATHER[biome][w] * (w === current ? 0.2 : 1));
  const total = weights.reduce((a, b) => a + b, 0);
  let t = r * total;
  for (let i = 0; i < entries.length; i++) {
    t -= weights[i];
    if (t <= 0) return entries[i];
  }
  return 'clear';
}

/** Ambient air temperature (deg C) from biome, time of day, altitude, weather. */
export function ambientTemperature(biome: Biome, timeOfDay: number, altitude: number, weatherOffset: number): number {
  const base: Record<Biome, [number, number]> = {
    grassland: [18, 7], tropical: [27, 4], swamp: [24, 4], desert: [31, 14], mountain: [5, 6], snow: [-8, 5],
  };
  const [mean, swing] = base[biome];
  const diurnal = Math.cos((timeOfDay - 0.58) * Math.PI * 2) * swing;
  const lapse = -Math.max(0, altitude - 10) * 0.05;
  return mean + diurnal + lapse + weatherOffset;
}

export const CAVE_TEMPERATURE = 11;

/**
 * Weather state machine. The current weather ramps in and out via `strength`
 * (0..1). When the current spell ends it ramps to zero, then the next one starts.
 */
export class WeatherMachine {
  current: WeatherId = 'clear';
  next: WeatherId | null = null;
  /** 0..1 ramp for the current weather. */
  strength = 1;
  timeInState = 0;
  duration: number;
  private rampTime = 25;

  constructor(private rng: () => number, initial: WeatherId = 'clear') {
    this.current = initial;
    this.duration = this.rollDuration(initial);
  }

  private rollDuration(w: WeatherId): number {
    const base = w === 'clear' ? 240 : 150;
    return base * (0.6 + this.rng() * 0.9);
  }

  /** Force a weather (for debugging or tests); starts ramping immediately. */
  force(w: WeatherId): void {
    this.next = w;
    this.timeInState = this.duration;
  }

  update(dt: number, biome: Biome, timeOfDay: number): void {
    this.timeInState += dt;
    if (this.next === null) {
      if (this.strength < 1) this.strength = clamp(this.strength + dt / this.rampTime, 0, 1);
      if (this.timeInState >= this.duration) {
        const pick = pickWeather(biome, timeOfDay, this.current, this.rng());
        if (pick === this.current) this.timeInState = 0;
        else this.next = pick;
      }
      return;
    }
    // Ramp out the current weather, then switch to the next one and ramp it in.
    this.strength = clamp(this.strength - dt / this.rampTime, 0, 1);
    if (this.strength <= 0) {
      this.current = this.next;
      this.next = null;
      this.timeInState = 0;
      this.duration = this.rollDuration(this.current);
    }
  }

  /** Blended effects of the current weather at its present strength. */
  effects(biome: Biome, severity: number): WeatherEffects {
    const calm = weatherEffectsFor('clear', biome, severity);
    const cur = weatherEffectsFor(this.current, biome, severity);
    const out = { ...calm } as WeatherEffects;
    for (const k of Object.keys(calm) as (keyof WeatherEffects)[]) out[k] = calm[k] + (cur[k] - calm[k]) * this.strength;
    return out;
  }
}
