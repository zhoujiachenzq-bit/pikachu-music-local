import { describe, expect, it } from 'vitest';
import { dominantArtworkColor } from './artworkPalette';

describe('artwork palette extraction', () => {
  it('selects the dominant saturated colour family', () => {
    const pixels = new Uint8ClampedArray([
      220, 28, 68, 255, 230, 34, 78, 255, 214, 24, 62, 255,
      30, 70, 220, 255, 5, 5, 7, 255, 250, 250, 250, 255,
    ]);
    expect(dominantArtworkColor(pixels)).toBe('#de1d46');
  });

  it('ignores neutral and transparent pixels', () => {
    expect(dominantArtworkColor(new Uint8ClampedArray([10, 10, 10, 255, 245, 245, 245, 255, 230, 20, 90, 0]))).toBeNull();
  });
});
