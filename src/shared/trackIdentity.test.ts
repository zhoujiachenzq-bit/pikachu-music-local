import { describe, expect, it } from 'vitest';
import { baseTrackTitle, canonicalTrackKey, hasCompatibleTrackDuration, isDerivativeTrackVersion, searchRelevance, stableMetadataId, trackFamilyKey, trackVersionPreference } from './trackIdentity.js';

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

  it('rejects the real cover and medley titles returned by public sources', () => {
    for (const title of ['说了再见 (原唱: 周杰伦)', '晴天 (原唱 周杰伦)', '七里香(指弹改编版原唱：周杰伦)', '晴天(深情版)', '下雨天(晚梦版)',
      '新歌前奏 + Julia + 晴天', '志明与春娇+听妈妈的话+干杯+晴天', '晴天（吉他弹唱）', '适合通勤听的几首歌 (长音频)', '二十年前最好听的歌 #欧美音乐', 'Wake Me Up (Hogland Tropical House Edit)']) {
      expect(isDerivativeTrackVersion(title), title).toBe(true);
    }
    expect(isDerivativeTrackVersion('下雨天', '孕妈胎教音乐盒')).toBe(true);
  });

  it('does not mistake original or ordinary editions for derivatives', () => {
    for (const title of ['Alive', 'Delivery', '晴天 (原唱版)', '晴天（电影版）', '海阔天空 (国语版)', 'C++']) {
      expect(isDerivativeTrackVersion(title), title).toBe(false);
    }
    expect(isDerivativeTrackVersion('晴天', '叶惠美 (珍藏版)')).toBe(false);
  });

  it('ranks the exact song above covers without hiding them', () => {
    const query = '晴天 周杰伦';
    const original = searchRelevance({ title: '晴天', artist: '周杰伦' }, query);
    const otherArtist = searchRelevance({ title: '晴天', artist: '张信哲' }, query);
    const sameArtist = searchRelevance({ title: '花海', artist: '周杰伦' }, query);
    const live = searchRelevance({ title: '晴天 (Live)', artist: '周杰伦' }, query);
    expect(original).toBeLessThan(otherArtist);
    expect(otherArtist).toBeLessThan(sameArtist);
    expect(sameArtist).toBeLessThan(live);
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
