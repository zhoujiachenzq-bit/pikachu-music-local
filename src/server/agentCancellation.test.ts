import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDatabase } from './db.js';
import { loadAgentKeyring } from './agentCrypto.js';
import { ensureMainConversation } from './agentStore.js';
import { AgentRuntime, type AgentRunInput } from './agentRuntime.js';
import { AgentModelProviderRegistry } from './agentModelProviders.js';
import { runMusicIntentShadowGraph, type ShadowModelResult } from './agentReflectionGraph.js';

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
const databases: ReturnType<typeof createDatabase>[] = [];
afterEach(() => { vi.unstubAllEnvs(); for (const db of databases.splice(0)) db.close(); });
async function collect<T>(source: AsyncIterable<T>) { const items: T[] = []; for await (const item of source) items.push(item); return items; }
function fixture() {
  vi.stubEnv('AGENT_REFLECTION_SHADOW', 'true'); vi.stubEnv('AGENT_REFLECTION_TIMEOUT_MS', '100');
  const db = createDatabase(':memory:'); databases.push(db); const stamp = new Date().toISOString();
  db.prepare('INSERT INTO users(id,username,password_hash,password_salt,created_at,updated_at) VALUES(?,?,?,?,?,?)').run('a', 'Fixture', 'hash', 'salt', stamp, stamp);
  const conversation = ensureMainConversation(db, 'a'); const gate = deferred<void>(); let signal: AbortSignal | undefined;
  const stream = vi.fn((input: { signal?: AbortSignal }) => {
    signal = input.signal;
    return { fullStream: (async function* () { await gate.promise; yield { type: 'tool-call', toolName: 'classify_music_intent', input: { intent: 'play_song', subject: '未知名字', confidence: .9, reasonCodes: [] } }; })() };
  });
  const provider = { id: 'deepseek', label: 'Fixture', configured: () => true, modelName: () => 'fixture', estimateCostCny: () => 0,
    capabilities: () => ({ text: true, streaming: true, tools: true, structuredOutput: true, reasoning: false, imageInput: false, audioInput: false }), stream };
  const runtime = new AgentRuntime(db, loadAgentKeyring({}), new AgentModelProviderRegistry({ AGENT_MODEL_PROVIDER: 'deepseek' }, [provider as never]));
  const input: AgentRunInput = { user: { id: 'a', username: 'Fixture' }, conversationId: conversation.id, conversationKind: 'main', message: '来首未知名字', generation: 1, webSearch: false,
    context: { currentTrack: null, queue: [], playing: false, currentTime: 0, volume: .8, playMode: 'list' } };
  return { db, gate, runtime, input, stream, signal: () => signal };
}

describe('reflection and action cancellation', () => {
  it('times out reflection into deterministic ambiguity, ignoring late model results', async () => {
    const f = fixture(); const events = await collect(f.runtime.run(f.input));
    expect(f.signal()?.aborted).toBe(true); expect(events.some(e => e.type === 'choice_required')).toBe(true);
    expect(events.some(e => e.type === 'client_action')).toBe(false);
    f.gate.resolve(); await new Promise(r => setTimeout(r, 10));
    expect(f.db.prepare('SELECT COUNT(*) n FROM agent_inference_audits').get()).toEqual({ n: 0 });
    expect(f.db.prepare('SELECT COUNT(*) n FROM agent_tool_actions').get()).toEqual({ n: 0 });
  });
  it('cancels a pending reflection without falling back to playback or saving an assistant reply', async () => {
    const f = fixture(); const controller = new AbortController();
    const running = collect(f.runtime.run({ ...f.input, signal: controller.signal })); await vi.waitFor(() => expect(f.stream).toHaveBeenCalled()); controller.abort();
    expect(await running).toEqual([]); expect(f.signal()?.aborted).toBe(true);
    expect(f.db.prepare('SELECT status FROM agent_runs').get()).toEqual({ status: 'cancelled' });
    expect(f.db.prepare("SELECT COUNT(*) n FROM agent_messages WHERE role='assistant'").get()).toEqual({ n: 0 }); f.gate.resolve();
  });
  it('a new request replaces an old reflection, and old cleanup does not cancel the new request', async () => {
    const f = fixture(); const old = collect(f.runtime.run(f.input)); await vi.waitFor(() => expect(f.stream).toHaveBeenCalled());
    const next = await collect(f.runtime.run({ ...f.input, message: '暂停', generation: 2 }));
    expect(await old).toEqual([]); expect(next).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'client_action', action: { type: 'pause' } }), expect.objectContaining({ type: 'done' })]));
    expect(f.db.prepare('SELECT generation,status FROM agent_runs ORDER BY generation').all()).toEqual([{ generation: 1, status: 'cancelled' }, { generation: 2, status: 'completed' }]); f.gate.resolve();
  });
  it('does not create messages for an already aborted request', async () => {
    const f = fixture(); const controller = new AbortController(); controller.abort();
    expect(await collect(f.runtime.run({ ...f.input, signal: controller.signal }))).toEqual([]); expect(f.stream).not.toHaveBeenCalled();
    expect(f.db.prepare('SELECT COUNT(*) n FROM agent_messages').get()).toEqual({ n: 0 });
  });
  it('graph cancellation interrupts a model that ignores the signal without running a late critic', async () => {
    const db = createDatabase(':memory:'); databases.push(db); const controller = new AbortController(); const gate = deferred<ShadowModelResult | null>(); const analyze = vi.fn(() => gate.promise);
    const running = runMusicIntentShadowGraph(db, { message: '来首未知名字', legacyIntent: 'ambiguous', signal: controller.signal }, analyze);
    const rejected = expect(running).rejects.toMatchObject({ name: 'AbortError' }); await vi.waitFor(() => expect(analyze).toHaveBeenCalled()); controller.abort(); await rejected;
    gate.resolve(null); await new Promise(r => setTimeout(r, 10));
  });
});
