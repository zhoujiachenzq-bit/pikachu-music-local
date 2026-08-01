import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createDatabase, type Db } from './db.js';
import { createApp } from './app.js';

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
    expect(data.backupVersion).toBe(1); expect(data.favorites).toHaveLength(1); expect(data.playlists).toHaveLength(1);
    expect(JSON.stringify(data)).not.toContain('password_hash'); expect(JSON.stringify(data)).not.toContain('session');
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
      headers: { host: 'music.example.com', origin: 'https://evil.example' },
      payload: { username: 'Dawn', password: 'Piplup-2026' }
    });
    expect(rejected.statusCode).toBe(403);
    expect(rejected.json().error.code).toBe('ORIGIN_REJECTED');
  });
});
