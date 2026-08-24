import { describe, expect, it } from 'vitest';
import { loadAgentKeyring } from './agentCrypto.js';
import { buildAgentContext, chooseAgentModelTier, directIntent, AgentRuntime, type AgentRunInput } from './agentRuntime.js';
import { AgentModelProviderRegistry } from './agentModelProviders.js';
import { publishKnowledgeVersion } from './agentKnowledge.js';
import { createDatabase } from './db.js';
import { createAgentMemory, ensureMainConversation, listAgentMessages } from './agentStore.js';

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

  it('persists the public knowledge references attached to a generated reply', async () => {
    const db = createDatabase(':memory:'); addUser(db, 'a', 'Ash'); const keyring = loadAgentKeyring({} as NodeJS.ProcessEnv); const conversation = ensureMainConversation(db, 'a');
    publishKnowledgeVersion(db, { kind: 'classic', source: 'fixture', collectedAt: new Date().toISOString(), documents: [{ externalId: 'sunny', title: '晴天', artist: '周杰伦', content: '校园 回忆 雨天 安静 怀旧' }] });
    const fakeProvider = {
      id: 'deepseek', label: 'Fixture', configured: () => true, modelName: () => 'fixture-model', estimateCostCny: () => 0,
      capabilities: () => ({ text: true, streaming: true, tools: true, structuredOutput: true, reasoning: false, imageInput: false, audioInput: false }),
      stream: () => ({ fullStream: (async function* () { yield { type: 'text-delta', text: '可以从《晴天》开始。' }; yield { type: 'finish', totalUsage: { inputTokens: 10, outputTokens: 8 } }; })() })
    };
    const runtime = new AgentRuntime(db, keyring, new AgentModelProviderRegistry({} as NodeJS.ProcessEnv, [fakeProvider as never]), { id: 'off', model: 'off', configured: () => false, search: async () => ({ answer: '', citations: [], inputTokens: 0, outputTokens: 0 }) }, { configured: () => false, embed: async () => [] });
    const input: AgentRunInput = { user: { id: 'a', username: 'Ash' }, conversationId: conversation.id, conversationKind: 'main', message: '想听校园回忆', generation: 1, webSearch: false, context: { currentTrack: null, queue: [], playing: false, currentTime: 0, volume: .8, playMode: 'list' } };
    const events = []; for await (const event of runtime.run(input)) events.push(event);
    expect(events).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'citation', title: '晴天 — 周杰伦', kind: 'knowledge' })]));
    const assistant = listAgentMessages(db, keyring, 'a', conversation.id).at(-1)!;
    expect(assistant.metadata?.citations).toEqual([expect.objectContaining({ title: '晴天 — 周杰伦', kind: 'knowledge' })]); db.close();
  });
});
