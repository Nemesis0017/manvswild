import { describe, expect, it } from 'vitest';
import { DEFAULT_BINDINGS } from '../core/input';
import { parseSeed } from '../game/modes';
import { ACTION_LABELS, ACTION_ORDER, codeLabel } from './bindings';

describe('bindings table', () => {
  it('lists every action once and labels it', () => {
    const actions = Object.keys(DEFAULT_BINDINGS);
    expect([...ACTION_ORDER].sort()).toEqual([...actions].sort());
    for (const a of ACTION_ORDER) expect(ACTION_LABELS[a]).toBeTruthy();
  });
  it('formats key codes', () => {
    expect(codeLabel('KeyW')).toBe('W');
    expect(codeLabel('Digit3')).toBe('3');
    expect(codeLabel('Mouse0')).toBe('Left click');
    expect(codeLabel('ArrowUp')).toBe('Up arrow');
  });
  it('turns seed text into a stable number', () => {
    expect(parseSeed('42')).toBe(42);
    expect(parseSeed('')).toBe(1337);
    expect(parseSeed('wolf')).toBe(parseSeed('wolf'));
    expect(parseSeed('wolf')).not.toBe(parseSeed('bear'));
  });
});
