import { describe, expect, it } from 'vitest';
import { loadAgentKeyring } from './agentCrypto.js';
import { buildAgentContext, chooseAgentModelTier, directIntent, type AgentRunInput } from './agentRuntime.js';
import { createDatabase } from './db.js';
import { createAgentMemory, ensureMainConversation } from './agentStore.js';

function addUser(db: ReturnType<typeof createDatabase>, id: string, username: string) {
  const stamp = new Date().toISOString();
  db.prepare('INSERT INTO users(id,username,password_hash,password_salt,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(id, username, 'hash', 'salt', stamp, stamp);
}

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

  it('does not retrieve or infer memories while memory is disabled', async () => {
    const db = createDatabase(':memory:');
    addUser(db, 'a', 'Ash');
    const keyring = loadAgentKeyring({} as NodeJS.ProcessEnv);
    const conversation = ensureMainConversation(db, 'a');
    createAgentMemory(db, keyring, 'a', { category: 'preference', content: '喜欢民谣', confidence: 1, inferred: false });
    const input: AgentRunInput = {
      user: { id: 'a', username: 'Ash' }, conversationId: conversation.id, conversationKind: 'main',
      message: '推荐一些民谣', generation: 1, webSearch: false,
      context: { currentTrack: null, queue: [], playing: false, currentTime: 0, volume: .8, playMode: 'list' }
    };
    const noEmbedding = { configured: () => false, embed: async () => [] };

    const disabled = await buildAgentContext(db, keyring, input, noEmbedding, false);
    const enabled = await buildAgentContext(db, keyring, input, noEmbedding, true);

    expect(disabled.memories).toEqual([]);
    expect(enabled.memories).toEqual([expect.objectContaining({ content: '喜欢民谣', inferred: false })]);
    db.close();
  });
});
