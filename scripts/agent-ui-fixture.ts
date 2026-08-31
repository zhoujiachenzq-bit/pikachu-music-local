/** Loopback-only UI fixture. No .env loading, persistent database, or real model calls. */
import Fastify from 'fastify';
import { setTimeout as delay } from 'node:timers/promises';
import { createApp } from '../src/server/app.js';
import { createDatabase } from '../src/server/db.js';
import { ensureMainConversation, saveAgentMessage, updateAgentSettings } from '../src/server/agentStore.js';
import { loadAgentKeyring } from '../src/server/agentCrypto.js';

for (const key of Object.keys(process.env)) {
  if (/^(AGENT_|DEEPSEEK_|BAILIAN_|AZURE_|MINIMAX_|KOKORO_|GPT_SOVITS_|GO_MUSIC_|COOKIE_|APP_ORIGIN|TRUST_PROXY)/.test(key)) delete process.env[key];
}
Object.assign(process.env, { NODE_ENV: 'development', AGENT_ENABLED: 'true', AGENT_ADMIN_USERNAMES: 'qa-local', AGENT_MODEL_PROVIDER: 'deepseek', GPT_SOVITS_TTS_ENABLED: 'false', KOKORO_TTS_ENABLED: 'true' });
const db = createDatabase(':memory:');
const audioService = Fastify({ logger: false }); let calls = 0; let cancelled = 0;
audioService.post('/synthesize', async (_request, reply) => {
  ++calls;
  reply.raw.once('close', () => { if (!reply.raw.writableEnded) ++cancelled; });
  await delay(4000);
  if (reply.raw.destroyed) return reply;
  const samples = 16000 * 6; const audio = Buffer.alloc(44 + samples * 2);
  audio.write('RIFF'); audio.writeUInt32LE(audio.length - 8, 4); audio.write('WAVEfmt ', 8); audio.writeUInt32LE(16, 16);
  audio.writeUInt16LE(1, 20); audio.writeUInt16LE(1, 22); audio.writeUInt32LE(16000, 24); audio.writeUInt32LE(32000, 28); audio.writeUInt16LE(2, 32); audio.writeUInt16LE(16, 34); audio.write('data', 36); audio.writeUInt32LE(samples * 2, 40);
  return reply.type('audio/wav').send(audio);
});
process.env.KOKORO_TTS_URL = await audioService.listen({ host: '127.0.0.1', port: 0 });
const app = await createApp({ db, logger: false });
app.get('/__fixture/status', () => ({ speechCalls: calls, cancelledSpeech: cancelled, messages: db.prepare('SELECT COUNT(*) count FROM agent_messages').get() }));
await app.ready();
const registration = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'qa-local', password: 'Fixture-only-2026' } });
if (registration.statusCode !== 201) throw new Error('FIXTURE_REGISTRATION_FAILED');
const user = db.prepare("SELECT id FROM users WHERE username='qa-local'").get() as { id: string };
const conversation = ensureMainConversation(db, user.id); const keyring = loadAgentKeyring();
saveAgentMessage(db, keyring, user.id, conversation.id, 'assistant', '这是一条隔离的界面测试消息，用于验证朗读停止与输入。');
saveAgentMessage(db, keyring, user.id, conversation.id, 'assistant', '这是第二条测试消息，用于验证切换朗读时旧请求不会继续播放。');
updateAgentSettings(db, user.id, { proactiveEnabled: false, memoryEnabled: false });
const address = await app.listen({ host: '127.0.0.1', port: 4311 });
console.log(`Isolated agent UI fixture ready at ${address}`);
let closing = false;
const close = async () => { if (closing) return; closing = true; await app.close(); await audioService.close(); db.close(); };
process.once('SIGINT', () => { void close(); }); process.once('SIGTERM', () => { void close(); });
