import { describe, expect, it } from 'vitest';
import { STEP_PARAMS, stepInterval, surfaceAt } from './surface';

describe('footstep surfaces', () => {
  it('maps biome and height to a surface', () => {
    expect(surfaceAt('desert', 10, false)).toBe('sand');
    expect(surfaceAt('snow', 10, false)).toBe('snow');
    expect(surfaceAt('mountain', 30, false)).toBe('rock');
    expect(surfaceAt('swamp', 4, false)).toBe('mud');
    expect(surfaceAt('grassland', 10, false)).toBe('grass');
    expect(surfaceAt('grassland', 3.1, false)).toBe('shallow');
    expect(surfaceAt('grassland', 10, true)).toBe('rock');
  });
  it('every surface has parameters', () => {
    for (const s of ['grass', 'sand', 'rock', 'snow', 'mud', 'shallow'] as const) expect(STEP_PARAMS[s].dur).toBeGreaterThan(0);
  });
  it('steps are closer together when walking slowly than sprinting', () => {
    expect(stepInterval(5, true, false)).toBeGreaterThan(stepInterval(2, false, false));
    expect(stepInterval(2, false, true)).toBeLessThan(stepInterval(2, false, false));
  });
});
