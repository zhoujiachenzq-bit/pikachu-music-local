import { describe, expect, it } from 'vitest';
import { canonicalTrackKey, stableMetadataId } from './trackIdentity.js';

describe('track identity', () => {
  it('deduplicates punctuation and width differences across sources', () => {
    expect(canonicalTrackKey('圣诞星（feat. 杨瑞代）', '周杰伦'))
      .toBe(canonicalTrackKey('圣诞星 (feat. 杨瑞代)', '周杰伦'));
  });

  it('creates repeatable metadata ids without using search positions', () => {
    expect(stableMetadataId('晴天', '周杰伦')).toBe(stableMetadataId('晴天', '周杰伦'));
    expect(stableMetadataId('晴天', '周杰伦')).not.toBe(stableMetadataId('花海', '周杰伦'));
  });
});
