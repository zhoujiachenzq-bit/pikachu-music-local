import { describe, expect, it } from 'vitest';
import { agentMemoryKey, extractExplicitMemoryCandidates, memoryRelevanceScore } from './agentMemory.js';

describe('agent memory extraction and ranking', () => {
  it('extracts explicit facts without turning temporary mood into a permanent trait', () => {
    const now = new Date('2026-08-24T10:00:00.000Z');
    const memories = extractExplicitMemoryCandidates('我叫大雄。我喜欢民谣。今晚心情有点低落。我计划九月去旅行。', now);
    expect(memories).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: 'person', content: '希望被称为大雄', inferred: false, expiresAt: null }),
      expect.objectContaining({ category: 'preference', content: '喜欢民谣', inferred: false, expiresAt: null }),
      expect.objectContaining({ category: 'plan', content: '计划九月去旅行', inferred: false, expiresAt: null })
    ]));
    const mood = memories.find(item => item.category === 'context');
    expect(mood?.content).toBe('今晚心情有点低落');
    expect(mood?.expiresAt).toBe('2026-08-27T10:00:00.000Z');
  });

  it('uses one semantic key for positive and negative versions of the same preference', () => {
    expect(agentMemoryKey({ category: 'preference', content: '喜欢民谣' })).toBe(agentMemoryKey({ category: 'preference', content: '不喜欢民谣' }));
  });

  it('ranks relevant stable preferences above unrelated context and rejects expired context', () => {
    const now = new Date('2026-08-24T10:00:00.000Z'); const base = { confidence: 1, inferred: false, createdAt: now.toISOString(), updatedAt: now.toISOString() };
    const preference = { id: 'p', category: 'preference' as const, content: '喜欢安静的民谣', expiresAt: null, ...base };
    const context = { id: 'c', category: 'context' as const, content: '今晚想听摇滚', expiresAt: '2026-08-25T10:00:00.000Z', ...base };
    const expired = { ...context, id: 'x', content: '今晚想听民谣', expiresAt: '2026-08-23T10:00:00.000Z' };
    expect(memoryRelevanceScore(preference, '推荐安静民谣', now)).toBeGreaterThan(memoryRelevanceScore(context, '推荐安静民谣', now));
    expect(memoryRelevanceScore(expired, '推荐民谣', now)).toBe(-Infinity);
  });
});
