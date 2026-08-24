import { describe, expect, it } from 'vitest';
import { chooseAgentModelTier, directIntent } from './agentRuntime.js';

describe('agent deterministic routing', () => {
  it('routes unambiguous player controls without asking a model', () => {
    expect(directIntent('暂停')).toEqual({ type: 'pause' });
    expect(directIntent('下一首！')).toEqual({ type: 'next' });
    expect(directIntent('上一首')).toEqual({ type: 'previous' });
    expect(directIntent('换一首')).toBeNull();
    expect(directIntent('播放退后')).toBeNull();
  });

  it('uses the complex model only before the soft budget threshold', () => {
    expect(chooseAgentModelTier('为什么我最近总跳过这些歌？', false, 10, 150)).toBe('plus');
    expect(chooseAgentModelTier('你好', false, 10, 150)).toBe('flash');
    expect(chooseAgentModelTier('请联网看看', true, 10, 150)).toBe('plus');
    expect(chooseAgentModelTier('请深入分析', true, 120, 150)).toBe('flash');
  });
});
