import { describe, expect, it } from 'vitest';
import { hashInts, mulberry32 } from './rng';
import { SimplexNoise } from './noise';
import { BIOMES, Terrain } from './terrain';

describe('mulberry32', () => {
  it('is deterministic per seed', () => {
    const a = mulberry32(42), b = mulberry32(42);
    for (let i = 0; i < 20; i++) expect(a()).toBe(b());
  });
  it('differs between seeds and stays in [0,1)', () => {
    const a = mulberry32(1), b = mulberry32(2);
    expect(a()).not.toBe(b());
    const r = mulberry32(7);
    for (let i = 0; i < 1000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
  it('hashInts is stable and sensitive', () => {
    expect(hashInts(1, 2, 3)).toBe(hashInts(1, 2, 3));
    expect(hashInts(1, 2, 3)).not.toBe(hashInts(2, 1, 3));
  });
});

describe('SimplexNoise', () => {
  it('is deterministic and bounded', () => {
    const a = new SimplexNoise(5), b = new SimplexNoise(5);
    for (let i = 0; i < 200; i++) {
      const x = i * 3.1, y = i * -1.7;
      expect(a.noise2(x, y)).toBe(b.noise2(x, y));
      expect(Math.abs(a.fbm(x, y, 4))).toBeLessThanOrEqual(1.05);
    }
  });
});

describe('Terrain', () => {
  it('same seed yields identical heights', () => {
    const a = new Terrain(1337), b = new Terrain(1337);
    for (let i = 0; i < 300; i++) {
      const x = (i * 37) % 900 - 450, z = (i * 91) % 900 - 450;
      expect(a.heightAt(x, z)).toBe(b.heightAt(x, z));
    }
  });
  it('different seeds yield different terrain', () => {
    const a = new Terrain(1), b = new Terrain(2);
    let diff = 0;
    for (let i = 0; i < 50; i++) if (a.heightAt(i * 20, i * 13) !== b.heightAt(i * 20, i * 13)) diff++;
    expect(diff).toBeGreaterThan(40);
  });
  it('biome weights are normalised and all biomes occur in a wide sample', () => {
    const t = new Terrain(1337);
    const seen = new Set<string>();
    for (let x = -6000; x <= 6000; x += 150) {
      for (let z = -6000; z <= 6000; z += 150) {
        const w = t.biomeWeights(x, z);
        const sum = BIOMES.reduce((s, b) => s + w[b], 0);
        expect(sum).toBeCloseTo(1, 6);
        seen.add(t.biomeAt(x, z));
      }
    }
    expect(seen.size).toBeGreaterThanOrEqual(5);
  });
  it('finds a dry spawn point', () => {
    const t = new Terrain(1337);
    const p = t.findSpawn();
    expect(t.heightAt(p.x, p.z)).toBeGreaterThan(3);
  });
});
