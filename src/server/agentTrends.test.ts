import { createHash, createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createDatabase } from './db.js';
import { buildTrendPublishPayload, listTrendUpdateRuns, normalizeTrendSnapshot, publishTrendSnapshot, runTrendRehearsal, signKnowledgePublishPayload, TREND_REHEARSAL_FIXTURE } from './agentTrends.js';

describe('agent trend publication pipeline', () => {
  it('merges derivative duplicates in favor of the original and preserves rank evidence', () => {
    const result = normalizeTrendSnapshot(TREND_REHEARSAL_FIXTURE);
    expect(result.documents).toHaveLength(5); expect(result.duplicateCount).toBe(1); expect(result.derivativeCount).toBe(0);
    expect(result.documents.find(item => item.title === '夜空中最亮的星')?.metadata).toMatchObject({ rank: 4, derivative: false });
  });

  it('rejects duplicate ranks and unofficial source URLs', () => {
    expect(() => normalizeTrendSnapshot({ ...TREND_REHEARSAL_FIXTURE, items: TREND_REHEARSAL_FIXTURE.items.map((item, index) => index === 1 ? { ...item, rank: 1 } : item) })).toThrow('排名');
    expect(() => normalizeTrendSnapshot({ ...TREND_REHEARSAL_FIXTURE, items: [{ ...TREND_REHEARSAL_FIXTURE.items[0], sourceUrl: 'https://example.com/fake' }] })).toThrow('官方');
  });

  it('signs the exact body sent to the protected publish endpoint', () => {
    const payload = buildTrendPublishPayload(TREND_REHEARSAL_FIXTURE); const signed = signKnowledgePublishPayload(payload, 'secret', '1787529600000', 'fixture_nonce_beta3');
    const bodyHash = createHash('sha256').update(signed.body).digest('hex'); const expected = createHmac('sha256', 'secret').update(`1787529600000.fixture_nonce_beta3.${bodyHash}`).digest('hex');
    expect(signed.headers['x-zhenqi-signature']).toBe(expected);
  });

  it('does not claim success when the remote publication fails', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ error: true }), { status: 503, headers: { 'content-type': 'application/json' } }));
    await expect(publishTrendSnapshot('https://zqmusic.cn/api/admin/agent/knowledge/publish', 'secret', TREND_REHEARSAL_FIXTURE, fetcher as typeof fetch)).rejects.toThrow('HTTP 503');
  });

  it('records a dry rehearsal without activating fixture knowledge', () => {
    const db = createDatabase(':memory:'); const before = db.prepare("SELECT id FROM knowledge_versions WHERE kind='douyin' AND status='active'").get(); const result = runTrendRehearsal(db); const after = db.prepare("SELECT id FROM knowledge_versions WHERE kind='douyin' AND status='active'").get();
    expect(result).toMatchObject({ itemCount: 5, duplicateCount: 1 }); expect(after).toEqual(before); expect(listTrendUpdateRuns(db, 1)[0]).toMatchObject({ status: 'completed', mode: 'fixture', itemCount: 5 }); db.close();
  });
});
