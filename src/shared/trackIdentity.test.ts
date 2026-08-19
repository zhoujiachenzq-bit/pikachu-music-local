import { describe, expect, it } from 'vitest';
import { baseTrackTitle, canonicalTrackKey, hasCompatibleTrackDuration, isDerivativeTrackVersion, stableMetadataId, trackFamilyKey, trackVersionPreference } from './trackIdentity.js';

describe('track identity', () => {
  it('deduplicates punctuation and width differences across sources', () => {
    expect(canonicalTrackKey('圣诞星（feat. 杨瑞代）', '周杰伦'))
      .toBe(canonicalTrackKey('圣诞星 (feat. 杨瑞代)', '周杰伦'));
  });

  it('creates repeatable metadata ids without using search positions', () => {
    expect(stableMetadataId('晴天', '周杰伦')).toBe(stableMetadataId('晴天', '周杰伦'));
    expect(stableMetadataId('晴天', '周杰伦')).not.toBe(stableMetadataId('花海', '周杰伦'));
  });

  it('recognizes derivative editions without rejecting an ordinary studio title', () => {
    for (const title of ['退后（翻唱）', '退后 Live', '退后-铃声版', '退后 伴奏', '退后 DJ版', '退后 Remix']) {
      expect(isDerivativeTrackVersion(title), title).toBe(true);
    }
    expect(isDerivativeTrackVersion('退后', '依然范特西')).toBe(false);
  });

  it('groups qualified titles with their base song and prefers the plain title', () => {
    expect(baseTrackTitle('退后（天空灰得像哭过）')).toBe('退后');
    expect(trackFamilyKey('退后（天空灰得像哭过）')).toBe(trackFamilyKey('退后'));
    expect(trackVersionPreference('退后')).toBe(0);
    expect(trackVersionPreference('退后（天空灰得像哭过）')).toBe(1);
    expect(trackVersionPreference('退后 Live')).toBe(2);
  });

  it('requires known and close durations for an automatic cross-source match', () => {
    expect(hasCompatibleTrackDuration(245_000, 249_000)).toBe(true);
    expect(hasCompatibleTrackDuration(245_000, 180_000)).toBe(false);
    expect(hasCompatibleTrackDuration(0, 245_000)).toBe(false);
  });
});
