import { SimplexNoise } from './noise';
import { clamp, lerp, smoothstep } from './rng';

export const WATER_Y = 3;
export const CHUNK_SIZE = 64;

export type Biome = 'grassland' | 'tropical' | 'desert' | 'swamp' | 'mountain' | 'snow';
export const BIOMES: Biome[] = ['grassland', 'tropical', 'desert', 'swamp', 'mountain', 'snow'];

export type BiomeWeights = Record<Biome, number>;

export interface TerrainSample {
  height: number;
  river: number; // 0..1 how much river carving applies
  mountain: number; // 0..1 mountain mask
  temp: number;
  moist: number;
}

export const BIOME_COLORS: Record<Biome, [number, number, number]> = {
  grassland: [0.36, 0.55, 0.2],
  tropical: [0.12, 0.45, 0.14],
  desert: [0.82, 0.68, 0.4],
  swamp: [0.26, 0.33, 0.16],
  mountain: [0.45, 0.42, 0.4],
  snow: [0.95, 0.97, 1.0],
};

/** Pure, seeded terrain description. Same seed always yields identical values. */
export class Terrain {
  readonly seed: number;
  private nBase: SimplexNoise;
  private nMtn: SimplexNoise;
  private nDetail: SimplexNoise;
  private nRiver: SimplexNoise;
  private nTemp: SimplexNoise;
  private nMoist: SimplexNoise;

  constructor(seed: number) {
    this.seed = seed;
    this.nBase = new SimplexNoise(seed ^ 0x1111);
    this.nMtn = new SimplexNoise(seed ^ 0x2222);
    this.nDetail = new SimplexNoise(seed ^ 0x3333);
    this.nRiver = new SimplexNoise(seed ^ 0x4444);
    this.nTemp = new SimplexNoise(seed ^ 0x5555);
    this.nMoist = new SimplexNoise(seed ^ 0x6666);
  }

  sample(x: number, z: number): TerrainSample {
    const continent = this.nBase.fbm(x * 0.0018, z * 0.0018, 3);
    const mtnField = this.nMtn.fbm(x * 0.0009 + 50, z * 0.0009 - 20, 2);
    const mountain = smoothstep(0.08, 0.5, mtnField);
    const ridge = this.nMtn.ridged(x * 0.0035, z * 0.0035, 4);
    const detail = this.nDetail.fbm(x * 0.02, z * 0.02, 3) * 1.6 + this.nDetail.noise2(x * 0.15, z * 0.15) * 0.25;

    const temp = this.nTemp.fbm(x * 0.0006 + 10, z * 0.0006 + 10, 2) * 1.6;
    const moist = this.nMoist.fbm(x * 0.0007 - 30, z * 0.0007 + 5, 2) * 1.6;

    let h = 7 + continent * 9 + detail * (1 + mountain * 2.5);
    h += mountain * (ridge * 85 - 8);

    // Swamps are flat and sit around the water level.
    const swampiness = smoothstep(0.25, 0.6, moist) * (1 - smoothstep(0.1, 0.4, temp)) * (1 - mountain);
    h = lerp(h, WATER_Y + 0.2 + detail * 0.35, swampiness * 0.85 * (1 - smoothstep(14, 24, h)));

    // Rivers: a narrow channel where a low-frequency noise crosses zero.
    const rn = Math.abs(this.nRiver.fbm(x * 0.0028, z * 0.0028, 2));
    const width = 0.018 + 0.02 * (1 - mountain);
    const river = (1 - smoothstep(0, width, rn)) * (1 - smoothstep(0.55, 0.9, mountain));
    if (river > 0) {
      const bed = WATER_Y - 2.2 + rn * 40;
      h = lerp(h, Math.min(h, bed), river);
    }

    return { height: h, river, mountain, temp, moist };
  }

  /** Raw river field; channels lie where it crosses zero. */
  riverField(x: number, z: number): number {
    return this.nRiver.fbm(x * 0.0028, z * 0.0028, 2);
  }

  heightAt(x: number, z: number): number {
    return this.sample(x, z).height;
  }

  /** Smooth biome weights (sum to 1). */
  biomeWeights(x: number, z: number, s: TerrainSample = this.sample(x, z)): BiomeWeights {
    const { height: h, mountain, temp, moist } = s;
    const snow = smoothstep(42, 62, h + temp * -8);
    const rock = smoothstep(24, 36, h) * (1 - snow) + mountain * 0.6 * (1 - snow);
    const lowland = 1 - Math.min(1, rock + snow);
    const hot = smoothstep(0.05, 0.35, temp);
    const dry = smoothstep(0.1, -0.25, moist);
    const wet = smoothstep(0.0, 0.3, moist);
    const swampy = smoothstep(0.3, 0.55, moist) * (1 - hot * 0.7) * (1 - smoothstep(WATER_Y + 3, WATER_Y + 8, h));
    const w: BiomeWeights = {
      desert: lowland * hot * dry,
      tropical: lowland * hot * wet * (1 - swampy),
      swamp: lowland * swampy,
      mountain: Math.min(1, rock),
      snow,
      grassland: 0,
    };
    const used = w.desert + w.tropical + w.swamp + w.mountain + w.snow;
    w.grassland = Math.max(0, 1 - used);
    const total = w.desert + w.tropical + w.swamp + w.mountain + w.snow + w.grassland;
    for (const b of BIOMES) w[b] /= total;
    return w;
  }

  biomeAt(x: number, z: number): Biome {
    const w = this.biomeWeights(x, z);
    let best: Biome = 'grassland';
    for (const b of BIOMES) if (w[b] > w[best]) best = b;
    return best;
  }

  /** True where open water covers the terrain surface. */
  isWater(x: number, z: number): boolean {
    return this.heightAt(x, z) < WATER_Y;
  }

  slopeAt(x: number, z: number, d = 1): number {
    const dx = (this.heightAt(x + d, z) - this.heightAt(x - d, z)) / (2 * d);
    const dz = (this.heightAt(x, z + d) - this.heightAt(x, z - d)) / (2 * d);
    return Math.hypot(dx, dz);
  }

  /** Nearest dry, gentle spot to the origin; used for spawn. */
  findSpawn(): { x: number; z: number } {
    for (let r = 0; r < 600; r += 6) {
      const steps = Math.max(1, Math.floor(r / 4));
      for (let i = 0; i < steps; i++) {
        const a = (i / steps) * Math.PI * 2;
        const x = Math.cos(a) * r;
        const z = Math.sin(a) * r;
        const h = this.heightAt(x, z);
        if (h > WATER_Y + 1.5 && h < 20 && this.slopeAt(x, z, 2) < 0.3 && this.biomeAt(x, z) !== 'swamp') {
          return { x, z };
        }
      }
    }
    return { x: 0, z: 0 };
  }

  /** Rock/cliff surface that the player may climb. */
  isClimbable(x: number, z: number): boolean {
    const s = this.sample(x, z);
    return s.mountain > 0.25 && s.height > WATER_Y + 4;
  }

  colorAt(x: number, z: number, out: [number, number, number], s: TerrainSample = this.sample(x, z)): void {
    const w = this.biomeWeights(x, z, s);
    let r = 0, g = 0, b = 0;
    for (const biome of BIOMES) {
      const c = BIOME_COLORS[biome];
      r += c[0] * w[biome]; g += c[1] * w[biome]; b += c[2] * w[biome];
    }
    // Wet sand along shores, dark riverbed.
    const shore = 1 - smoothstep(WATER_Y, WATER_Y + 1.4, s.height);
    if (shore > 0) {
      r = lerp(r, 0.7, shore * 0.8); g = lerp(g, 0.62, shore * 0.8); b = lerp(b, 0.42, shore * 0.8);
    }
    const dark = clamp(1 - smoothstep(WATER_Y - 3, WATER_Y, s.height), 0, 1);
    out[0] = r * (1 - dark * 0.45);
    out[1] = g * (1 - dark * 0.4);
    out[2] = b * (1 - dark * 0.3);
  }
}
