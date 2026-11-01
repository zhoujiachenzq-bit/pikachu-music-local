// Isolated UI fixture: no real account, cookies, audio, upstream or .env.
import { createDatabase } from '../src/server/db.js';
import { createApp } from '../src/server/app.js';
for (const key of Object.keys(process.env)) if (/KEY|TOKEN|SECRET|COOKIE|GO_MUSIC|APP_ORIGIN|TRUST_PROXY|PIKACHU_DB/.test(key)) delete process.env[key];
Object.assign(process.env, { NODE_ENV: 'development', GO_MUSIC_API_URL: 'http://127.0.0.1:18088', GO_MUSIC_API_DIRECT_MEDIA: '1' });
const songs = Array.from({ length: 8 }, (_, i) => ({ source: 'netease', id: `fixture-${i}`, name: `页面验证歌曲 ${i + 1}`, artist: '合成测试资料', duration: 180, cover: 'http://127.0.0.1:4321/pikachu-192.png' }));
const original = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(String(input)); if (url.port !== '18088') return original(input, init);
  let data: unknown = { songs };
  if (url.pathname.includes('/categories')) data = [{ source: 'netease', categories: [{ id: 'daily', name: '通勤' }, { id: 'calm', name: '轻音乐' }] }];
  else if (url.pathname.includes('qr_login')) data = init?.method === 'POST' ? { key: 'fixture-qr', url: 'https://music.163.com' } : { status: 'waiting' };
  else if (url.pathname.endsWith('/detail')) data = songs;
  else if (url.pathname.endsWith('/lyric')) data = { lyric: '[00:00]固定夹具歌词\n[00:10]不代表真实音源' };
  else if (!url.searchParams.get('q')?.startsWith('http')) data = { playlists: [{ source: 'netease', id: 'fixture-list', name: '通勤时听的歌', track_count: 8, cover: songs[0].cover }] };
  return new Response(JSON.stringify({ code: 200, data }), { headers: { 'content-type': 'application/json' } });
};
const db = createDatabase(':memory:'); const app = await createApp({ db, logger: false });
let sessionCookie = '';
app.get('/__fixture/start', async (_request, reply) => { reply.header('set-cookie', sessionCookie); return reply.redirect('/'); });
await app.ready();
const registered = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'platform-qa', password: 'Fixture-only-2026' } });
sessionCookie = String(registered.headers['set-cookie']);
if (registered.statusCode !== 201) throw new Error('Fixture registration failed');
console.log(await app.listen({ host: '127.0.0.1', port: 4321 }));
process.once('SIGINT', () => { void app.close().then(() => db.close()); });
