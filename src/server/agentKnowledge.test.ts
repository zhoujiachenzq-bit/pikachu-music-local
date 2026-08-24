import { createHash, createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createDatabase } from './db.js';
import { activateKnowledgeVersion, listKnowledgeChunksMissingEmbeddings, publishKnowledgeVersion, retrieveKnowledge, setKnowledgeChunkEmbedding, verifyKnowledgeSignature } from './agentKnowledge.js';

describe('versioned agent knowledge', () => {
  it('publishes atomically, retrieves by mixed ranking and can roll back', () => {
    const db = createDatabase(':memory:');
    const first = publishKnowledgeVersion(db, { kind: 'classic', source: 'fixture-v1', collectedAt: new Date().toISOString(), documents: [
      { externalId: '1', title: '晴天', artist: '周杰伦', content: '校园 回忆 雨天 安静 怀旧' },
      { externalId: '2', title: '倔强', artist: '五月天', content: '坚持 勇气 低谷 打气' }
    ] });
    expect(retrieveKnowledge(db, '想听安静怀旧的歌', 3)[0]).toMatchObject({ title: '晴天' });
    const second = publishKnowledgeVersion(db, { kind: 'classic', source: 'fixture-v2', collectedAt: new Date().toISOString(), documents: [{ externalId: '3', title: '宁夏', artist: '梁静茹', content: '夏夜 安心 睡前 放松' }] });
    expect(retrieveKnowledge(db, '睡前放松', 3)[0]).toMatchObject({ title: '宁夏' });
    expect(activateKnowledgeVersion(db, first.id)?.status).toBe('active'); expect(retrieveKnowledge(db, '校园回忆', 3)[0]).toMatchObject({ title: '晴天' });
    expect(db.prepare('SELECT status FROM knowledge_versions WHERE id=?').get(second.id)).toMatchObject({ status: 'archived' }); db.close();
  });

  it('validates time-bound HMAC signatures', () => {
    const secret = 'local-publish-secret'; const body = JSON.stringify({ kind: 'douyin', documents: [] }); const timestamp = '1787558400000'; const nonce = 'fixture_nonce_123';
    const hash = createHash('sha256').update(body).digest('hex'); const signature = createHmac('sha256', secret).update(`${timestamp}.${nonce}.${hash}`).digest('hex');
    expect(verifyKnowledgeSignature(body, { timestamp, nonce, signature }, secret, () => Number(timestamp))).toBe(true);
    expect(verifyKnowledgeSignature(`${body}x`, { timestamp, nonce, signature }, secret, () => Number(timestamp))).toBe(false);
    expect(verifyKnowledgeSignature(body, { timestamp, nonce, signature }, secret, () => Number(timestamp) + 6 * 60_000)).toBe(false);
  });

  it('adds vector ranking without exposing private memory or breaking lexical fallback', () => {
    const db = createDatabase(':memory:'); const version = publishKnowledgeVersion(db, { kind: 'classic', source: 'fixture-vector', collectedAt: new Date().toISOString(), documents: [
      { externalId: 'calm', title: '安静', artist: '歌手甲', content: '夜晚 放松' },
      { externalId: 'energy', title: '热烈', artist: '歌手乙', content: '运动 高能' }
    ] });
    const chunks = listKnowledgeChunksMissingEmbeddings(db, version.id, 10); expect(chunks).toHaveLength(2);
    for (const chunk of chunks) setKnowledgeChunkEmbedding(db, chunk.id, chunk.title === '安静' ? [1, 0] : [0, 1]);
    expect(retrieveKnowledge(db, '给我一首歌', 1, [0, 1])[0]).toMatchObject({ title: '热烈' });
    expect(listKnowledgeChunksMissingEmbeddings(db, version.id, 10)).toEqual([]); db.close();
  });
});
