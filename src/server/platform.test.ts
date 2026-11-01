import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from './app.js';
import { createDatabase } from './db.js';
import { normalizePlatformResult, platformQuerySchema, queryPlatform } from './platformGateway.js';

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const response = (data: unknown) => new Response(JSON.stringify({ code: 200, data }), { headers: { 'content-type': 'application/json' } });
const song = { source: 'qq', id: 'real-mid', name: '歌曲', artist: '歌手', duration: 200, link: 'https://y.qq.com/n/ryqq/songDetail/real-mid' };

describe('platform discovery', () => {
  it('normalizes songs, album results and unsafe source links', () => {
    expect(normalizePlatformResult({ songs: [song, { ...song, id: 'other', link: 'https://example.test' }] }, 'qq', 'album').tracks)
      .toMatchObject([{ id: 'qq:real-mid', duration: 200000 }, { sourceUrl: null }]);
    expect(normalizePlatformResult({ albums: [{ source: 'netease', id: 'album', name: '专辑' }] }, 'qq', 'album').items)
      .toMatchObject([{ source: 'netease', kind: 'album', id: 'album' }]);
  });
  it('unwraps grouped platform categories and forwards the selected source', async () => {
    vi.stubEnv('GO_MUSIC_API_URL', 'http://127.0.0.1:8080');
    const fetcher = vi.fn(async () => response([{ source: 'qq', categories: [{ id: '11', name: '通勤', source: 'qq' }] }])); vi.stubGlobal('fetch', fetcher);
    expect(await queryPlatform(platformQuerySchema.parse({ mode: 'categories', source: 'qq' }))).toMatchObject({ categories: [{ id: '11', name: '通勤' }], items: [] });
    expect(new URL(fetcher.mock.calls[0][0] as string).searchParams.get('sources')).toBe('qq');
  });
  it('refuses off-platform or credential-bearing share URLs before contacting upstream', async () => {
    vi.stubEnv('GO_MUSIC_API_URL', 'http://127.0.0.1:8080'); const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    for (const q of ['http://127.0.0.1/private', 'https://user:secret@y.qq.com/test']) await expect(queryPlatform(platformQuerySchema.parse({ mode: 'link', q }))).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('binds save previews to the owner and commits a repeated confirmation once', async () => {
    vi.stubEnv('GO_MUSIC_API_URL', 'http://127.0.0.1:8080'); vi.stubGlobal('fetch', vi.fn(async () => response({ songs: [song] })));
    const db = createDatabase(':memory:'); const app = await createApp({ db, logger: false });
    try {
      const a = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'PlatformA', password: 'Fixture-only-2026' } });
      const b = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'PlatformB', password: 'Fixture-only-2026' } });
      const cookieA = a.headers['set-cookie']!.split(';')[0]; const cookieB = b.headers['set-cookie']!.split(';')[0];
      const data = (await app.inject({ url: '/api/platform/browse?mode=search&source=qq&q=test', headers: { cookie: cookieA } })).json();
      expect(data.tracks).toHaveLength(1);
      const payload = { previewId: data.previewId, name: '通勤' };
      expect((await app.inject({ method: 'POST', url: '/api/platform/save', headers: { cookie: cookieB }, payload })).statusCode).toBe(410);
      const first = (await app.inject({ method: 'POST', url: '/api/platform/save', headers: { cookie: cookieA }, payload })).json();
      const second = (await app.inject({ method: 'POST', url: '/api/platform/save', headers: { cookie: cookieA }, payload })).json();
      expect(first.playlist.id).toBe(second.playlist.id); expect(first.playlist.tracks).toHaveLength(1);
      expect(db.prepare('SELECT count(*) AS n FROM playlists').get()).toMatchObject({ n: 1 });
      expect((await app.inject({ method: 'POST', url: '/api/platform/login', headers: { cookie: cookieA }, payload: { source: 'qq' } })).statusCode).toBe(403);
    } finally { await app.close(); db.close(); }
  });
  it('does not return platform cookies or the upstream login key to the UI', async () => {
    vi.stubEnv('GO_MUSIC_API_URL', 'http://127.0.0.1:8080'); vi.stubEnv('GO_MUSIC_API_DIRECT_MEDIA', '1');
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => init?.method === 'POST'
      ? response({ key: 'private-upstream-key', url: 'https://y.qq.com/login' })
      : response({ status: 'success', cookie: 'private-cookie', cookies: { token: 'private-token' }, extra: { secret: 'hidden' } }));
    vi.stubGlobal('fetch', fetcher);
    const db = createDatabase(':memory:'); const app = await createApp({ db, logger: false });
    try {
      const registered = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'QrFixture', password: 'Fixture-only-2026' } });
      const cookie = registered.headers['set-cookie']!.split(';')[0];
      const created = await app.inject({ method: 'POST', url: '/api/platform/login', headers: { cookie }, payload: { source: 'qq' } });
      expect(created.body).not.toContain('private-upstream-key');
      const checked = await app.inject({ url: `/api/platform/login/${created.json().session}`, headers: { cookie } });
      expect(checked.json().status).toBe('success');
      expect(checked.body).not.toContain('private-cookie'); expect(checked.body).not.toContain('private-token'); expect(checked.body).not.toContain('hidden');
    } finally { await app.close(); db.close(); }
  });
});
