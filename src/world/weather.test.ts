import { describe, expect, it } from 'vitest';
import { mulberry32 } from './rng';
import { BIOMES } from './terrain';
import {
  BIOME_WEATHER, WEATHER_IDS, WeatherMachine, ambientTemperature, pickWeather, weatherAllowed, weatherEffectsFor,
} from './weather';

describe('weather state machine', () => {
  it('starts clear and ramps out then into the next weather when forced', () => {
    const w = new WeatherMachine(mulberry32(1), 'clear');
    expect(w.strength).toBe(1);
    w.force('heavy_rain');
    w.update(1, 'grassland', 0.5);
    expect(w.next).toBe('heavy_rain');
    expect(w.strength).toBeLessThan(1);
    for (let i = 0; i < 40; i++) w.update(1, 'grassland', 0.5);
    expect(w.current).toBe('heavy_rain');
    expect(w.next).toBeNull();
    expect(w.strength).toBeGreaterThan(0.2);
    for (let i = 0; i < 40; i++) w.update(1, 'grassland', 0.5);
    expect(w.strength).toBe(1);
  });

  it('changes weather on its own after the duration and is deterministic per seed', () => {
    const run = (seed: number) => {
      const w = new WeatherMachine(mulberry32(seed));
      const seen: string[] = [w.current];
      for (let i = 0; i < 6000; i++) {
        w.update(1, 'mountain', 0.5);
        if (seen[seen.length - 1] !== w.current) seen.push(w.current);
      }
      return seen;
    };
    const a = run(7), b = run(7);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(3);
  });

  it('biome odds forbid impossible weather', () => {
    for (const b of BIOMES) {
      for (let i = 0; i < 200; i++) {
        const w = pickWeather(b, 0.5, 'clear', i / 200);
        expect(BIOME_WEATHER[b][w]).toBeGreaterThan(0);
      }
    }
    expect(weatherAllowed('snowstorm', 'desert', 0.5)).toBe(false);
    expect(weatherAllowed('heatwave', 'snow', 0.5)).toBe(false);
    expect(weatherAllowed('heatwave', 'desert', 0.05)).toBe(false);
    expect(weatherAllowed('heatwave', 'desert', 0.5)).toBe(true);
  });

  it('covers all eight weather types', () => {
    expect(WEATHER_IDS).toHaveLength(8);
  });

  it('weather changes temperature, visibility, movement and wind', () => {
    const clear = weatherEffectsFor('clear', 'grassland', 1);
    const storm = weatherEffectsFor('thunderstorm', 'grassland', 1);
    const snow = weatherEffectsFor('snowstorm', 'snow', 1);
    expect(storm.tempOffset).toBeLessThan(clear.tempOffset);
    expect(storm.visibility).toBeLessThan(clear.visibility);
    expect(storm.lightning).toBe(1);
    expect(snow.snow).toBe(1);
    expect(snow.movement).toBeLessThan(1);
    expect(weatherEffectsFor('heatwave', 'desert', 1).tempOffset).toBeGreaterThan(5);
    expect(weatherEffectsFor('strong_wind', 'grassland', 1).wind).toBe(1);
  });

  it('heavy rain becomes snow in the snow biome', () => {
    const e = weatherEffectsFor('heavy_rain', 'snow', 1);
    expect(e.rain).toBe(0);
    expect(e.snow).toBeGreaterThan(0);
  });

  it('difficulty severity scales effects', () => {
    const mild = weatherEffectsFor('cold_front', 'mountain', 0.6);
    const harsh = weatherEffectsFor('cold_front', 'mountain', 1.6);
    expect(harsh.tempOffset).toBeLessThan(mild.tempOffset);
  });

  it('effects blend with strength', () => {
    const w = new WeatherMachine(mulberry32(3), 'thunderstorm');
    const full = w.effects('grassland', 1).rain;
    w.strength = 0.5;
    const half = w.effects('grassland', 1).rain;
    expect(half).toBeCloseTo(full / 2, 5);
  });

  it('ambient temperature follows biome, time of day, altitude and weather', () => {
    expect(ambientTemperature('desert', 0.58, 10, 0)).toBeGreaterThan(ambientTemperature('desert', 0.08, 10, 0));
    expect(ambientTemperature('snow', 0.5, 10, 0)).toBeLessThan(0);
    expect(ambientTemperature('mountain', 0.5, 100, 0)).toBeLessThan(ambientTemperature('mountain', 0.5, 10, 0));
    expect(ambientTemperature('grassland', 0.5, 10, -10)).toBeLessThan(ambientTemperature('grassland', 0.5, 10, 0));
  });
});
