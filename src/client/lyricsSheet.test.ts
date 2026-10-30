import { describe, expect, it } from 'vitest';
import { classifySwipe } from './lyricsSheet';

describe('lyrics sheet swipe', () => {
  it('reads a long vertical drag at any speed', () => {
    expect(classifySwipe(4, -120, 900)).toBe('up');
    expect(classifySwipe(-8, 90, 900)).toBe('down');
  });

  it('reads a short flick only when it is quick', () => {
    expect(classifySwipe(0, -32, 120)).toBe('up');
    expect(classifySwipe(0, -32, 500)).toBeNull();
  });

  it('ignores taps and small movements', () => {
    expect(classifySwipe(2, 3, 80)).toBeNull();
    expect(classifySwipe(0, -20, 100)).toBeNull();
  });

  it('leaves mostly sideways drags alone', () => {
    expect(classifySwipe(140, -90, 300)).toBeNull();
    expect(classifySwipe(-200, 100, 300)).toBeNull();
  });
});
