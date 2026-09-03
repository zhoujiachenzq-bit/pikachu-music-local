import { describe, expect, it } from 'vitest';
import type { Track } from '../shared/types';
import { deriveVisualPalette, mobileSectionForStage, shouldPersistMobileScroll, shouldShowMiniPlayer, shouldUseDesktopWebgl, stageAfterRecommendationPlay, TRACK_COLOR_INFLUENCE } from './visualState';

const track: Track = {
  id: 'qq:1', source: 'qq', sourceTrackId: '1', title: 'Night Drive', artist: 'Pikachu', album: 'Cottage', duration: 180_000,
  coverUrl: null, sourceUrl: null,
};

describe('immersive visual state', () => {
  it('keeps the daily stage open after a recommendation starts playing', () => {
    expect(stageAfterRecommendationPlay('daily')).toBe('daily');
    expect(stageAfterRecommendationPlay('player')).toBe('player');
  });

  it('shows the mobile mini player outside the full player section only', () => {
    expect(shouldShowMiniPlayer('daily', true)).toBe(true);
    expect(shouldShowMiniPlayer('search', true)).toBe(true);
    expect(shouldShowMiniPlayer('library', true)).toBe(true);
    expect(shouldShowMiniPlayer('player', true)).toBe(false);
    expect(shouldShowMiniPlayer('daily', false)).toBe(false);
  });

  it('does not restore an outer scroll position for the player or agent', () => {
    expect(shouldPersistMobileScroll('daily')).toBe(true);
    expect(shouldPersistMobileScroll('search')).toBe(true);
    expect(shouldPersistMobileScroll('library')).toBe(true);
    expect(shouldPersistMobileScroll('player')).toBe(false);
    expect(shouldPersistMobileScroll('agent')).toBe(false);
  });

  it('uses stable track palettes', () => {
    expect(deriveVisualPalette(track)).toEqual(deriveVisualPalette({ ...track }));
    expect(deriveVisualPalette(track).primary).toBe('#ffd84d');
    expect(deriveVisualPalette(track, 'burgundy')).not.toEqual(deriveVisualPalette(track, 'cobalt'));
    expect(deriveVisualPalette(track, 'burgundy', '#f00070')).not.toEqual(deriveVisualPalette(track, 'burgundy'));
    expect(TRACK_COLOR_INFLUENCE).toBe(.55);
  });

  it('keeps an empty stage on the pure theme palette', () => {
    expect(deriveVisualPalette(null, 'paper')).toMatchObject({ primary: '#ffd84d', secondary: '#f24b2a', glow: '#1768ff' });
    expect(deriveVisualPalette(null, 'night')).toMatchObject({ primary: '#ffd84d', secondary: '#f0b93f', glow: '#ffe39a' });
    expect(deriveVisualPalette(null, 'vinyl')).toMatchObject({ secondary: '#a84432', glow: '#e2aa39' });
    expect(deriveVisualPalette(null, 'arcade')).toMatchObject({ secondary: '#2fe6ff', glow: '#ff4bd8' });
  });

  it('loads WebGL only on capable desktops', () => {
    expect(shouldUseDesktopWebgl({ width: 1440, finePointer: true, reducedMotion: false })).toBe(true);
    expect(shouldUseDesktopWebgl({ width: 1080, finePointer: true, reducedMotion: false })).toBe(false);
    expect(shouldUseDesktopWebgl({ width: 1440, finePointer: false, reducedMotion: false })).toBe(false);
    expect(shouldUseDesktopWebgl({ width: 1440, finePointer: true, reducedMotion: true })).toBe(false);
  });

  it('maps each center stage to its mobile destination', () => {
    expect(mobileSectionForStage('daily')).toBe('daily');
    expect(mobileSectionForStage('player')).toBe('player');
  });
});
