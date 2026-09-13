/** Loopback-only visual QA with an in-memory account and synthetic music.
 * Run after pnpm build: pnpm exec tsx scripts/motion-ui-fixture.ts
 * Login: motion-qa / Fixture-only-2026. Never uses .env or production data.
 */
import { createApp } from '../src/server/app.js';
import { createDatabase } from '../src/server/db.js';
import { setTimeout as delay } from 'node:timers/promises';
import type { Track } from '../src/shared/types.js';

for (const key of Object.keys(process.env)) {
  if (/^(AGENT_|DEEPSEEK_|BAILIAN_|AZURE_|MINIMAX_|KOKORO_|GPT_SOVITS_|GO_MUSIC_|COOKIE_|APP_ORIGIN|TRUST_PROXY)/.test(key)) delete process.env[key];
}
Object.assign(process.env, { NODE_ENV: 'development', AGENT_ENABLED: 'true', AGENT_ADMIN_USERNAMES: 'motion-qa', AGENT_MODEL_PROVIDER: 'deepseek' });
const db = createDatabase(':memory:');
const app = await createApp({ db, logger: false });
const tracks: Track[] = ['月光纸片', '蓝色唱片', '失败验证'].map((title, i) => ({
  id: `netease:motion-${i}`, source: 'netease', sourceTrackId: `motion-${i}`, title,
  artist: '本地测试夹具', album: '合成静音 · 非真实歌曲', duration: 45,
  coverUrl: 'http://127.0.0.1:4315/pikachu-192.png', sourceUrl: null,
}));
const date = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const daily = { id: 'motion-daily', date, status: 'completed', generatedAt: new Date().toISOString(), message: '隔离动效测试', tracks: tracks.map((t, i) => ({ ...t, rank: i + 1, score: 1, reason: '本地合成夹具', kind: 'explore' })) };
app.addHook('preHandler', async (request, reply) => {
  if (request.url.startsWith('/api/search')) return reply.send({ tracks, errors: {} });
  if (request.url.startsWith('/api/recommendations/daily')) return reply.send({ daily, fallback: null });
  if (request.url.startsWith('/api/recommendations/history')) return reply.send({ history: [daily] });
  if (request.url.endsWith('/resolve')) return reply.send({ track: { ...(request.body as { track: Track }).track, actualSource: 'netease', fallback: false, audioUrl: 'http://127.0.0.1:4315/__fixture/silence.wav', lyric: '[00:00]合成静音测试\n[00:10]切换页面不应重建音频\n[00:20]仅验证布局与交互' } });
  if (request.method === 'POST' && (request.url === '/api/favorites' || /^\/api\/playlists\/[^/]+\/tracks$/.test(request.url))) {
    await delay(120);
    if ((request.body as Track)?.sourceTrackId === 'motion-2') return reply.code(503).send({ error: { code: 'QA_FAILURE', message: '夹具预期失败，不能出现成功火花' } });
  }
});
app.get('/__fixture/silence.wav', async (_req, reply) => {
  const rate = 8000; const data = Buffer.alloc(44 + rate * 45 * 2);
  data.write('RIFF'); data.writeUInt32LE(data.length - 8, 4); data.write('WAVEfmt ', 8); data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22); data.writeUInt32LE(rate, 24); data.writeUInt32LE(rate * 2, 28);
  data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34); data.write('data', 36); data.writeUInt32LE(data.length - 44, 40);
  return reply.type('audio/wav').send(data);
});
await app.ready();
const registration = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'motion-qa', password: 'Fixture-only-2026' } });
if (registration.statusCode !== 201) throw new Error('FIXTURE_REGISTRATION_FAILED');
const cookie = String(registration.headers['set-cookie']).split(';')[0];
const playlist = await app.inject({ method: 'POST', url: '/api/playlists', headers: { cookie }, payload: { name: '动效验收歌单' } });
if (playlist.statusCode !== 201) throw new Error('FIXTURE_PLAYLIST_FAILED');
console.log(`Isolated motion fixture: ${await app.listen({ host: '127.0.0.1', port: 4315 })}`);
let closing = false;
const close = async () => { if (closing) return; closing = true; await app.close(); db.close(); };
process.once('SIGINT', () => { void close(); }); process.once('SIGTERM', () => { void close(); });
