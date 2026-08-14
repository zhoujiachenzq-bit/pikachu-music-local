import { describe, expect, it } from 'vitest';
import { DEFAULT_VISUAL_PREFERENCES, parseVisualPreferences, readVisualPreferences, resolveToneTheme, selectSceneQuality, shouldAnimateCssScene, visualPreferencesStorageKey, writeVisualPreferences } from './visualTheme';

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

describe('visual theme preferences', () => {
  it('falls back to Pikachu Night for missing or invalid data', () => {
    expect(parseVisualPreferences(null)).toEqual(DEFAULT_VISUAL_PREFERENCES);
    expect(parseVisualPreferences('{"version":1,"theme":"unknown","motionEnabled":true}')).toEqual(DEFAULT_VISUAL_PREFERENCES);
    expect(parseVisualPreferences('not-json')).toEqual(DEFAULT_VISUAL_PREFERENCES);
  });

  it('isolates preferences by local account', () => {
    const storage = new MemoryStorage();
    writeVisualPreferences(storage, 'user-a', { version: 1, theme: 'burgundy', motionEnabled: false });
    expect(readVisualPreferences(storage, 'user-a')).toEqual({ version: 1, theme: 'burgundy', motionEnabled: false });
    expect(readVisualPreferences(storage, 'user-b')).toEqual(DEFAULT_VISUAL_PREFERENCES);
    expect(visualPreferencesStorageKey('user-a')).not.toBe(visualPreferencesStorageKey('user-b'));
  });

  it('uses preview without overwriting the committed theme', () => {
    expect(resolveToneTheme('night', 'paper')).toBe('paper');
    expect(resolveToneTheme('night', null)).toBe('night');
  });

  it('selects scene quality and supports the full mobile center scene', () => {
    expect(selectSceneQuality({ width: 1440, reducedMotion: false, motionEnabled: true })).toBe('desktop');
    expect(selectSceneQuality({ width: 1024, reducedMotion: false, motionEnabled: true })).toBe('tablet');
    expect(selectSceneQuality({ width: 760, reducedMotion: false, motionEnabled: true })).toBe('off');
    expect(selectSceneQuality({ width: 390, reducedMotion: false, motionEnabled: true, fullMobile: true })).toBe('desktop');
    expect(selectSceneQuality({ width: 1440, reducedMotion: true, motionEnabled: true })).toBe('off');
    expect(selectSceneQuality({ width: 1440, reducedMotion: false, motionEnabled: false })).toBe('off');
  });

  it('honors motion and reduced-motion preferences for CSS effects', () => {
    expect(shouldAnimateCssScene({ motionEnabled: true, reducedMotion: false })).toBe(true);
    expect(shouldAnimateCssScene({ motionEnabled: false, reducedMotion: false })).toBe(false);
    expect(shouldAnimateCssScene({ motionEnabled: true, reducedMotion: true })).toBe(false);
  });
});
