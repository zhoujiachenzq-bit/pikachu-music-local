import { describe, expect, it } from 'vitest';
import { rangeProgress } from './rangeControl';

describe('player range controls', () => {
  it('maps and clamps progress without invalid CSS values', () => {
    expect(rangeProgress(30, 0, 120)).toBe(25);
    expect(rangeProgress(-5, 0, 120)).toBe(0);
    expect(rangeProgress(150, 0, 120)).toBe(100);
    expect(rangeProgress(0, 0, 0)).toBe(0);
  });
});
