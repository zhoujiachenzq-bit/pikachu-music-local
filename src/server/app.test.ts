import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createDatabase, type Db } from './db.js';
import { createApp, trustProxyFromEnv } from './app.js';
import { MediaTicketStore } from './mediaProxy.js';

describe('local API integration', () => {
  let app: FastifyInstance | undefined; let db: Db | undefined;
  afterEach(async () => { if (app) await app.close(); if (db) db.close(); app = undefined; db = undefined; });

  it('persists data per account and exports a credential-free backup', async () => {
    db = createDatabase(':memory:'); app = await createApp({ db, logger: false }); await app.ready();
    const registerA = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'Ash', password: 'Pikachu-2026' } });
    expect(registerA.statusCode).toBe(201); const cookieA = registerA.headers['set-cookie']!.split(';')[0];

    const sample = { id: 'netease:123', source: 'netease', sourceTrackId: '123', title: '测试歌曲', artist: '测试歌手', album: '测试专辑', duration: 180000, coverUrl: null, sourceUrl: 'https://music.163.com/song?id=123', keyword: '测试歌曲 测试歌手', displayIndex: 3, quality: '320k' };
    expect((await app.inject({ method: 'POST', url: '/api/favorites', headers: { cookie: cookieA }, payload: sample })).statusCode).toBe(201);
    expect((await app.inject({ method: 'POST', url: '/api/playlists', headers: { cookie: cookieA }, payload: { name: '通勤歌单' } })).statusCode).toBe(201);
    const favoritesA = await app.inject({ method: 'GET', url: '/api/favorites', headers: { cookie: cookieA } });
    expect(favoritesA.json().tracks).toHaveLength(1);
    expect(favoritesA.json().tracks[0]).toMatchObject({ keyword: sample.keyword, displayIndex: 3, quality: '320k' });

    const registerB = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'Misty', password: 'Starmie-2026' } });
    const cookieB = registerB.headers['set-cookie']!.split(';')[0];
    expect((await app.inject({ method: 'GET', url: '/api/favorites', headers: { cookie: cookieB } })).json().tracks).toHaveLength(0);
    expect((await app.inject({ method: 'GET', url: '/api/playlists', headers: { cookie: cookieB } })).json().playlists).toHaveLength(0);

    const backup = await app.inject({ method: 'GET', url: '/api/backup/export', headers: { cookie: cookieA } });
    expect(backup.statusCode).toBe(200); const data = backup.json();
    expect(data.backupVersion).toBe(2); expect(data.favorites).toHaveLength(1); expect(data.playlists).toHaveLength(1);
    expect(JSON.stringify(data)).not.toContain('password_hash'); expect(JSON.stringify(data)).not.toContain('token_hash');

    const restoredOnce = await app.inject({ method: 'POST', url: '/api/backup/restore', headers: { cookie: cookieA }, payload: { mode: 'merge', data } });
    const restoredTwice = await app.inject({ method: 'POST', url: '/api/backup/restore', headers: { cookie: cookieA }, payload: { mode: 'merge', data } });
    expect(restoredOnce.json().playlists).toBe(1); expect(restoredTwice.json().playlists).toBe(1);
  });

  it('expires all sessions after a password change', async () => {
    db = createDatabase(':memory:'); app = await createApp({ db, logger: false }); await app.ready();
    const register = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'Brock', password: 'Onix-2026' } });
    const cookie = register.headers['set-cookie']!.split(';')[0];
    const changed = await app.inject({ method: 'PATCH', url: '/api/auth/password', headers: { cookie }, payload: { currentPassword: 'Onix-2026', newPassword: 'Geodude-2026' } });
    expect(changed.statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/favorites', headers: { cookie } })).statusCode).toBe(401);
  });

  it('accepts public same-origin writes and rejects cross-origin writes', async () => {
    db = createDatabase(':memory:'); app = await createApp({ db, logger: false }); await app.ready();
    const accepted = await app.inject({
      method: 'POST', url: '/api/auth/register',
      headers: { host: 'music.example.com', origin: 'https://music.example.com' },
      payload: { username: 'Serena', password: 'Sylveon-2026' }
    });
    expect(accepted.statusCode).toBe(201);

    const rejected = await app.inject({
      method: 'POST', url: '/api/auth/register',
      headers: { host: 'music.example.com', origin: 'https://evil.example', 'x-forwarded-host': 'evil.example' },
      payload: { username: 'Dawn', password: 'Piplup-2026' }
    });
    expect(rejected.statusCode).toBe(403);
    expect(rejected.json().error.code).toBe('ORIGIN_REJECTED');
  });

  it('keeps registration convenient while throttling automated account creation', async () => {
    const previous = process.env.RATE_REGISTER_IP_DAILY; process.env.RATE_REGISTER_IP_DAILY = '1';
    try {
      db = createDatabase(':memory:'); app = await createApp({ db, logger: false }); await app.ready();
      const first = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'May', password: 'Torchic-2026' } });
      const blocked = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'Max', password: 'Ralts-2026' } });
      expect(first.statusCode).toBe(201);
      expect(blocked.statusCode).toBe(429); expect(blocked.json().error).toMatchObject({ code: 'RATE_LIMITED' });
      expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    } finally {
      if (previous === undefined) delete process.env.RATE_REGISTER_IP_DAILY; else process.env.RATE_REGISTER_IP_DAILY = previous;
    }
  });

  it('applies registration limits to the trusted proxy client IP', async () => {
    const previous = process.env.RATE_REGISTER_IP_DAILY; process.env.RATE_REGISTER_IP_DAILY = '1';
    try {
      db = createDatabase(':memory:'); app = await createApp({ db, logger: false, trustProxy: 1 }); await app.ready();
      const first = await app.inject({ method: 'POST', url: '/api/auth/register', headers: { 'x-forwarded-for': '203.0.113.10' }, payload: { username: 'Leaf', password: 'Bulbasaur-2026' } });
      const second = await app.inject({ method: 'POST', url: '/api/auth/register', headers: { 'x-forwarded-for': '198.51.100.8' }, payload: { username: 'Tracey', password: 'Marill-2026' } });
      const blocked = await app.inject({ method: 'POST', url: '/api/auth/register', headers: { 'x-forwarded-for': '198.51.100.8' }, payload: { username: 'Todd', password: 'Snap-2026' } });
      expect(first.statusCode).toBe(201); expect(second.statusCode).toBe(201); expect(blocked.statusCode).toBe(429);
    } finally {
      if (previous === undefined) delete process.env.RATE_REGISTER_IP_DAILY; else process.env.RATE_REGISTER_IP_DAILY = previous;
    }
  });

  it('sets browser security headers and prevents caching account responses', async () => {
    db = createDatabase(':memory:'); app = await createApp({ db, logger: false }); await app.ready();
    const health = await app.inject({ method: 'GET', url: '/api/health' });
    expect(health.headers['x-content-type-options']).toBe('nosniff');
    expect(health.headers['x-frame-options']).toBe('DENY');
    expect(health.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(health.headers['cache-control']).toBe('no-store');
  });

  it('protects compatibility media relay tickets by account and forwards Range', async () => {
    db = createDatabase(':memory:'); const tickets = new MediaTicketStore();
    const mediaFetcher = async () => new Response('audio', { status: 206, headers: { 'content-type': 'audio/mp4', 'content-range': 'bytes 0-4/100' } });
    app = await createApp({ db, logger: false, mediaTickets: tickets, mediaFetcher }); await app.ready();
    const first = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'MediaA', password: 'Pikachu-2026' } });
    const cookieA = first.headers['set-cookie']!.split(';')[0]; const userA = first.json().user;
    const second = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'MediaB', password: 'Pikachu-2026' } });
    const cookieB = second.headers['set-cookie']!.split(';')[0];
    const proxyUrl = tickets.issue(userA.id, { id: 'qq:1', source: 'qq', sourceTrackId: '1', title: 'Song', artist: 'Artist', album: '', duration: 1000, coverUrl: null, sourceUrl: null, audioUrl: 'https://isure6.stream.qqmusic.qq.com/song.m4a', lyric: null, actualSource: 'qq', fallback: false })!;
    expect((await app.inject({ method: 'GET', url: proxyUrl, headers: { cookie: cookieB, range: 'bytes=0-4' } })).statusCode).toBe(404);
    const streamed = await app.inject({ method: 'GET', url: proxyUrl, headers: { cookie: cookieA, range: 'bytes=0-4' } });
    expect(streamed.statusCode).toBe(206); expect(streamed.headers['content-type']).toContain('audio/mp4'); expect(streamed.headers['cache-control']).toBe('private, no-store');
  });

  it('rejects unsafe all-proxy trust and oversized nested backups', async () => {
    expect(() => trustProxyFromEnv('true')).toThrow(/TRUST_PROXY=true/);
    expect(trustProxyFromEnv('172.17.0.0/16,127.0.0.1/8')).toEqual(['172.17.0.0/16', '127.0.0.1/8']);
    expect(trustProxyFromEnv(undefined, '1')).toBe(1);
    db = createDatabase(':memory:'); app = await createApp({ db, logger: false }); await app.ready();
    const registered = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'Iris', password: 'Axew-2026' } });
    const cookie = registered.headers['set-cookie']!.split(';')[0];
    const invalid = await app.inject({ method: 'POST', url: '/api/backup/restore', headers: { cookie }, payload: {
      mode: 'preview', data: { backupVersion: 2, playlists: [{ name: 'x'.repeat(61), tracks: [] }] }
    } });
    expect(invalid.statusCode).toBe(400); expect(invalid.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('persists login throttling in SQLite', async () => {
    db = createDatabase(':memory:'); app = await createApp({ db, logger: false }); await app.ready();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const result = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'Missing', password: 'Wrong-2026' } });
      expect(result.statusCode).toBe(401);
    }
    const blocked = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'Missing', password: 'Wrong-2026' } });
    expect(blocked.statusCode).toBe(429); expect(blocked.json().error.code).toBe('TOO_MANY_ATTEMPTS');
  });

  it('stores listening behavior per account without cross-account session collisions', async () => {
    db = createDatabase(':memory:'); app = await createApp({ db, logger: false }); await app.ready();
    const first = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'Red', password: 'Charizard-2026' } });
    const cookieA = first.headers['set-cookie']!.split(';')[0];
    const track = { source: 'qq', sourceTrackId: 'behavior-1', title: 'Behavior Song', artist: 'Singer', album: '', duration: 100000, coverUrl: null, sourceUrl: 'https://y.qq.com/n/ryqq/songDetail/behavior-1' };
    await app.inject({ method: 'POST', url: '/api/favorites', headers: { cookie: cookieA }, payload: track });
    const payload = { id: 'session-shared', trackId: 'qq:behavior-1', contextType: 'favorites', actualSource: 'qq', startedAt: new Date().toISOString(), playedMs: 82000, durationMs: 100000, completed: true, skipped: false };
    expect((await app.inject({ method: 'POST', url: '/api/listening-sessions', headers: { cookie: cookieA }, payload })).statusCode).toBe(202);

    const second = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'Blue', password: 'Blastoise-2026' } });
    const cookieB = second.headers['set-cookie']!.split(';')[0];
    await app.inject({ method: 'POST', url: '/api/favorites', headers: { cookie: cookieB }, payload: track });
    expect((await app.inject({ method: 'POST', url: '/api/listening-sessions', headers: { cookie: cookieB }, payload: { ...payload, playedMs: 1 } })).statusCode).toBe(202);
    expect((await app.inject({ method: 'GET', url: '/api/listening-sessions', headers: { cookie: cookieA } })).json().sessions[0]).toMatchObject({ playedMs: 82000, completed: 1 });
    expect((await app.inject({ method: 'GET', url: '/api/listening-sessions', headers: { cookie: cookieB } })).json().sessions).toHaveLength(0);
  });
});
