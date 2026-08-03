import { describe, expect, it } from 'vitest';
import { mediaPosition } from './mediaSession';

describe('mediaPosition', () => {
  it('clamps playback position to a valid media-session range', () => {
    expect(mediaPosition(100, 130)).toEqual({ duration: 100, position: 100, playbackRate: 1 });
    expect(mediaPosition(100, -4, 1.25)).toEqual({ duration: 100, position: 0, playbackRate: 1.25 });
  });

  it('rejects streams without a finite positive duration', () => {
    expect(mediaPosition(Number.NaN, 0)).toBeNull();
    expect(mediaPosition(0, 0)).toBeNull();
  });
});
