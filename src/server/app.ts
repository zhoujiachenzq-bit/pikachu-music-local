import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { z, ZodError } from 'zod';
import type { Db } from './db.js';
import { createDatabase, createLocalPlaylist, getPlaylist, listFavorites, listPlaylists, rowToTrack, rowToUser, transaction, upsertTrack } from './db.js';
import { clearSessionCookie, createSession, createUserId, getSessionUser, hashPassword, requireUser, revokeToken, SESSION_COOKIE, setSessionCookie, verifyPassword } from './auth.js';
import { createImportJob, createSyncJob, getImportJob, listImportJobs, retryImportJob, runImportJob } from './imports.js';
import { resolvePlaylistInput, resolveTrackWithFallback, searchAll, SourceError } from './sources.js';
import { SOURCES, type MusicSource, type PlaylistDetail, type Track } from '../shared/types.js';

const credentialsSchema = z.object({ username: z.string().trim().min(2).max(24).regex(/^[\p{L}\p{N}_.-]+$/u), password: z.string().min(8).max(72) });
const sourceSchema = z.enum(SOURCES);
const trackSchema = z.object({
  id: z.string().optional(), source: sourceSchema, sourceTrackId: z.string().min(1), title: z.string().min(1).max(300),
  artist: z.string().max(300).default(''), album: z.string().max(300).default(''), duration: z.number().nonnegative().default(0),
  coverUrl: z.string().url().nullable().optional(), sourceUrl: z.string().url().nullable().optional(), keyword: z.string().optional(), displayIndex: z.number().optional(), quality: z.string().nullable().optional()
});

function apiError(code: string, message: string, details?: unknown) { return { error: { code, message, ...(details === undefined ? {} : { details }) } }; }
function firstHeader(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value?.split(',')[0]?.trim();
}

function safeOrigin(origin: string | undefined, host: string | undefined, forwardedHost: string | string[] | undefined) {
  if (!origin) return true;
  try {
    const url = new URL(origin);
    if (['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) return true;
    const allowedHosts = [host, firstHeader(forwardedHost)].filter((value): value is string => Boolean(value)).map(value => value.toLowerCase());
    if (allowedHosts.includes(url.host.toLowerCase())) return true;
    const configuredOrigins = (process.env.APP_ORIGIN || '').split(',').map(value => value.trim()).filter(Boolean);
    return configuredOrigins.includes(url.origin);
  } catch { return false; }
}

export interface AppOptions { db?: Db; staticDir?: string; logger?: boolean; }

export async function createApp(options: AppOptions = {}): Promise<FastifyInstance> {
  const db = options.db || createDatabase();
  const app = Fastify({ logger: options.logger ?? true, bodyLimit: 5 * 1024 * 1024 });
  await app.register(cookie);

  app.addHook('onRequest', async (request, reply) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && !safeOrigin(request.headers.origin, request.headers.host, request.headers['x-forwarded-host'])) {
      return reply.code(403).send(apiError('ORIGIN_REJECTED', '只接受来自同源页面的写入请求。'));
    }
  });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) return reply.code(400).send(apiError('VALIDATION_ERROR', '提交的数据格式不正确。', error.issues));
    if (error instanceof SourceError) return reply.code(error.code === 'FALLBACK_CONFIRM_REQUIRED' ? 409 : 502).send(apiError(error.code, error.message, error.details));
    const safeError = error instanceof Error ? error : new Error(String(error));
    const statusValue = (error as { statusCode?: unknown })?.statusCode;
    const status = typeof statusValue === 'number' ? statusValue : 500;
    app.log.error(safeError);
    return reply.code(status).send(apiError('INTERNAL_ERROR', status >= 500 ? '本地服务发生错误。' : safeError.message));
  });

  app.get('/api/health', async () => ({ ok: true, service: 'pikachu-music-local', time: new Date().toISOString() }));

  const loginAttempts = new Map<string, { count: number; resetAt: number }>();
  app.post('/api/auth/register', async (request, reply) => {
    const body = credentialsSchema.parse(request.body); const username = body.username.trim();
    const exists = db.prepare('SELECT 1 FROM users WHERE username=?').get(username);
    if (exists) return reply.code(409).send(apiError('USERNAME_EXISTS', '这个用户名已经存在。'));
    const { salt, hash } = await hashPassword(body.password); const id = createUserId(); const stamp = new Date().toISOString();
    db.prepare(`INSERT INTO users(id,username,password_hash,password_salt,created_at,updated_at) VALUES(?,?,?,?,?,?)`).run(id, username, hash, salt, stamp, stamp);
    const token = createSession(db, id); setSessionCookie(reply, token);
    const created = db.prepare('SELECT * FROM users WHERE id=?').get(id) as Record<string, unknown>;
    return reply.code(201).send({ user: rowToUser(created) });
  });

  app.post('/api/auth/login', async (request, reply) => {
    const body = credentialsSchema.parse(request.body); const key = `${request.ip}:${body.username.toLowerCase()}`; const current = loginAttempts.get(key);
    if (current && current.resetAt > Date.now() && current.count >= 5) return reply.code(429).send(apiError('TOO_MANY_ATTEMPTS', '尝试次数过多，请 15 分钟后再试。'));
    const row = db.prepare('SELECT * FROM users WHERE username=?').get(body.username) as Record<string, unknown> | undefined;
    if (!row || !(await verifyPassword(body.password, String(row.password_salt), String(row.password_hash)))) {
      loginAttempts.set(key, { count: (current?.resetAt || 0) > Date.now() ? current!.count + 1 : 1, resetAt: Date.now() + 15 * 60_000 });
      return reply.code(401).send(apiError('INVALID_CREDENTIALS', '用户名或密码不正确。'));
    }
    loginAttempts.delete(key); const token = createSession(db, String(row.id)); setSessionCookie(reply, token);
    return { user: rowToUser(row) };
  });

  app.get('/api/auth/me', async request => ({ user: getSessionUser(db, request) }));
  app.post('/api/auth/logout', async (request, reply) => { revokeToken(db, request.cookies[SESSION_COOKIE]); clearSessionCookie(reply); return { ok: true }; });
  app.patch('/api/auth/password', async (request, reply) => {
    const user = requireUser(db, request, reply); if (!user) return;
    const body = z.object({ currentPassword: z.string(), newPassword: z.string().min(8).max(72) }).parse(request.body);
    const row = db.prepare('SELECT password_hash,password_salt FROM users WHERE id=?').get(user.id) as Record<string, unknown>;
    if (!(await verifyPassword(body.currentPassword, String(row.password_salt), String(row.password_hash)))) return reply.code(401).send(apiError('INVALID_PASSWORD', '当前密码不正确。'));
    const { salt, hash } = await hashPassword(body.newPassword);
    transaction(db, () => { db.prepare('UPDATE users SET password_hash=?,password_salt=?,updated_at=? WHERE id=?').run(hash, salt, new Date().toISOString(), user.id); db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id); });
    clearSessionCookie(reply); return { ok: true, relogin: true };
  });
  app.patch('/api/auth/preferences', async (request, reply) => {
    const user = requireUser(db, request, reply); if (!user) return;
    const body = z.object({ language: z.enum(['zh', 'en']).optional(), volume: z.number().min(0).max(1).optional(), playMode: z.enum(['list', 'loop', 'shuffle']).optional() }).parse(request.body);
    db.prepare(`UPDATE users SET language=COALESCE(?,language),volume=COALESCE(?,volume),play_mode=COALESCE(?,play_mode),updated_at=? WHERE id=?`)
      .run(body.language ?? null, body.volume ?? null, body.playMode ?? null, new Date().toISOString(), user.id);
    return { user: getSessionUser(db, request) };
  });
  app.delete('/api/auth/account', async (request, reply) => {
    const user = requireUser(db, request, reply); if (!user) return;
    const body = z.object({ password: z.string() }).parse(request.body);
    const row = db.prepare('SELECT password_hash,password_salt FROM users WHERE id=?').get(user.id) as Record<string, unknown>;
    if (!(await verifyPassword(body.password, String(row.password_salt), String(row.password_hash)))) return reply.code(401).send(apiError('INVALID_PASSWORD', '密码不正确。'));
    db.prepare('DELETE FROM users WHERE id=?').run(user.id); clearSessionCookie(reply); return { ok: true };
  });

  app.get('/api/search', async (request, reply) => {
    const user = requireUser(db, request, reply); if (!user) return;
    const query = z.object({ q: z.string().trim().min(1).max(100), sources: z.string().optional(), limit: z.coerce.number().int().min(1).max(30).default(10) }).parse(request.query);
    const sources = (query.sources?.split(',').filter(v => SOURCES.includes(v as MusicSource)) || [...SOURCES]) as MusicSource[];
    return searchAll(db, query.q, sources.length ? sources : [...SOURCES], query.limit);
  });

  app.post('/api/tracks/:id/resolve', async (request, reply) => {
    const user = requireUser(db, request, reply); if (!user) return;
    const params = z.object({ id: z.string() }).parse(request.params); const body = z.object({ track: trackSchema.optional() }).parse(request.body || {});
    let input: Track | null = body.track ? { ...body.track, id: body.track.id || `${body.track.source}:${body.track.sourceTrackId}`, coverUrl: body.track.coverUrl || null, sourceUrl: body.track.sourceUrl || null } : null;
    if (input) input = upsertTrack(db, input);
    if (!input) { const row = db.prepare('SELECT * FROM tracks WHERE id=?').get(params.id) as Record<string, unknown> | undefined; if (row) input = rowToTrack(row); }
    if (!input) return reply.code(404).send(apiError('TRACK_NOT_FOUND', '歌曲不存在。'));
    const resolved = await resolveTrackWithFallback(input, db); return { track: resolved };
  });
  app.get('/api/tracks/:id/lyrics', async (request, reply) => {
    const user = requireUser(db, request, reply); if (!user) return;
    const params = z.object({ id: z.string() }).parse(request.params); const row = db.prepare('SELECT * FROM tracks WHERE id=?').get(params.id) as Record<string, unknown> | undefined;
    if (!row) return reply.code(404).send(apiError('TRACK_NOT_FOUND', '歌曲不存在。'));
    const resolved = await resolveTrackWithFallback(rowToTrack(row), db); return { lyric: resolved.lyric, actualSource: resolved.actualSource };
  });
  app.get('/api/tracks/:id/download', async (request, reply) => {
    const user = requireUser(db, request, reply); if (!user) return;
    const params = z.object({ id: z.string() }).parse(request.params); const row = db.prepare('SELECT * FROM tracks WHERE id=?').get(params.id) as Record<string, unknown> | undefined;
    if (!row) return reply.code(404).send(apiError('TRACK_NOT_FOUND', '歌曲不存在。'));
    try { const resolved = await resolveTrackWithFallback(rowToTrack(row), db); return reply.redirect(resolved.audioUrl); }
    catch { const sourceUrl = row.source_url ? String(row.source_url) : null; if (sourceUrl) return reply.redirect(sourceUrl); throw new SourceError('UNPLAYABLE', '当前歌曲没有可公开下载的媒体地址。'); }
  });

  app.get('/api/favorites', async (request, reply) => { const user = requireUser(db, request, reply); if (!user) return; return { tracks: listFavorites(db, user.id) }; });
  app.post('/api/favorites', async (request, reply) => {
    const user = requireUser(db, request, reply); if (!user) return;
    const item = trackSchema.parse(request.body); const saved = upsertTrack(db, { ...item, id: item.id || `${item.source}:${item.sourceTrackId}`, coverUrl: item.coverUrl || null, sourceUrl: item.sourceUrl || null });
    db.prepare('INSERT OR IGNORE INTO favorites(user_id,track_id,created_at) VALUES(?,?,?)').run(user.id, saved.id, new Date().toISOString());
    return reply.code(201).send({ track: saved });
  });
  app.delete('/api/favorites/:trackId', async (request, reply) => {
    const user = requireUser(db, request, reply); if (!user) return; const { trackId } = z.object({ trackId: z.string() }).parse(request.params);
    db.prepare('DELETE FROM favorites WHERE user_id=? AND track_id=?').run(user.id, trackId); return { ok: true };
  });

  app.get('/api/playlists', async (request, reply) => { const user = requireUser(db, request, reply); if (!user) return; return { playlists: listPlaylists(db, user.id) }; });
  app.post('/api/playlists', async (request, reply) => {
    const user = requireUser(db, request, reply); if (!user) return; const body = z.object({ name: z.string().trim().min(1).max(60), description: z.string().max(500).default('') }).parse(request.body);
    return reply.code(201).send({ playlist: createLocalPlaylist(db, user.id, body.name, body.description) });
  });
  app.get('/api/playlists/:id', async (request, reply) => {
    const user = requireUser(db, request, reply); if (!user) return; const { id } = z.object({ id: z.string() }).parse(request.params); const playlist = getPlaylist(db, user.id, id);
    if (!playlist) return reply.code(404).send(apiError('PLAYLIST_NOT_FOUND', '歌单不存在。')); return { playlist };
  });
  app.patch('/api/playlists/:id', async (request, reply) => {
    const user = requireUser(db, request, reply); if (!user) return; const { id } = z.object({ id: z.string() }).parse(request.params);
    const body = z.object({ name: z.string().trim().min(1).max(60).optional(), description: z.string().max(500).optional() }).parse(request.body);
    const changed = db.prepare('UPDATE playlists SET name=COALESCE(?,name),description=COALESCE(?,description),updated_at=? WHERE id=? AND user_id=?').run(body.name ?? null, body.description ?? null, new Date().toISOString(), id, user.id);
    if (!changed.changes) return reply.code(404).send(apiError('PLAYLIST_NOT_FOUND', '歌单不存在。')); return { playlist: getPlaylist(db, user.id, id) };
  });
  app.delete('/api/playlists/:id', async (request, reply) => { const user = requireUser(db, request, reply); if (!user) return; const { id } = z.object({ id: z.string() }).parse(request.params); db.prepare('DELETE FROM playlists WHERE id=? AND user_id=?').run(id, user.id); return { ok: true }; });
  app.post('/api/playlists/:id/tracks', async (request, reply) => {
    const user = requireUser(db, request, reply); if (!user) return; const { id } = z.object({ id: z.string() }).parse(request.params);
    if (!getPlaylist(db, user.id, id)) return reply.code(404).send(apiError('PLAYLIST_NOT_FOUND', '歌单不存在。'));
    const item = trackSchema.parse(request.body); const saved = upsertTrack(db, { ...item, id: item.id || `${item.source}:${item.sourceTrackId}`, coverUrl: item.coverUrl || null, sourceUrl: item.sourceUrl || null });
    const max = db.prepare('SELECT COALESCE(MAX(position),-1) max_pos FROM playlist_items WHERE playlist_id=?').get(id) as { max_pos: number };
    db.prepare(`INSERT INTO playlist_items(playlist_id,track_id,position,origin,excluded,created_at) VALUES(?,?,?,'local',0,?)
      ON CONFLICT(playlist_id,track_id) DO UPDATE SET origin='local',excluded=0`).run(id, saved.id, Number(max.max_pos) + 1, new Date().toISOString());
    db.prepare('UPDATE playlists SET updated_at=? WHERE id=?').run(new Date().toISOString(), id); return reply.code(201).send({ playlist: getPlaylist(db, user.id, id) });
  });
  app.delete('/api/playlists/:id/tracks/:trackId', async (request, reply) => {
    const user = requireUser(db, request, reply); if (!user) return; const p = z.object({ id: z.string(), trackId: z.string() }).parse(request.params);
    const owner = db.prepare('SELECT 1 FROM playlists WHERE id=? AND user_id=?').get(p.id, user.id); if (!owner) return reply.code(404).send(apiError('PLAYLIST_NOT_FOUND', '歌单不存在。'));
    const item = db.prepare('SELECT origin FROM playlist_items WHERE playlist_id=? AND track_id=?').get(p.id, p.trackId) as { origin: string } | undefined;
    if (item?.origin === 'source') db.prepare('UPDATE playlist_items SET excluded=1 WHERE playlist_id=? AND track_id=?').run(p.id, p.trackId);
    else db.prepare('DELETE FROM playlist_items WHERE playlist_id=? AND track_id=?').run(p.id, p.trackId);
    return { ok: true };
  });
  app.post('/api/playlists/:id/reorder', async (request, reply) => {
    const user = requireUser(db, request, reply); if (!user) return; const { id } = z.object({ id: z.string() }).parse(request.params); const { trackIds } = z.object({ trackIds: z.array(z.string()).max(2000) }).parse(request.body);
    if (!getPlaylist(db, user.id, id)) return reply.code(404).send(apiError('PLAYLIST_NOT_FOUND', '歌单不存在。'));
    transaction(db, () => trackIds.forEach((trackId, position) => db.prepare('UPDATE playlist_items SET position=? WHERE playlist_id=? AND track_id=? AND excluded=0').run(position, id, trackId)));
    return { playlist: getPlaylist(db, user.id, id) };
  });

  app.get('/api/imports', async (request, reply) => { const user = requireUser(db, request, reply); if (!user) return; return { jobs: listImportJobs(db, user.id) }; });
  app.post('/api/imports', async (request, reply) => {
    const user = requireUser(db, request, reply); if (!user) return; const body = z.object({ input: z.string().trim().min(1).max(1000), source: sourceSchema.optional() }).parse(request.body);
    const parsed = await resolvePlaylistInput(body.input, body.source); const job = createImportJob(db, user.id, body.input, body.source, parsed); void runImportJob(db, job.id); return reply.code(202).send({ job });
  });
  app.get('/api/imports/:id', async (request, reply) => { const user = requireUser(db, request, reply); if (!user) return; const { id } = z.object({ id: z.string() }).parse(request.params); const job = getImportJob(db, user.id, id); if (!job) return reply.code(404).send(apiError('IMPORT_NOT_FOUND', '导入任务不存在。')); return { job }; });
  app.post('/api/imports/:id/retry', async (request, reply) => { const user = requireUser(db, request, reply); if (!user) return; const { id } = z.object({ id: z.string() }).parse(request.params); const job = retryImportJob(db, user.id, id); if (!job) return reply.code(404).send(apiError('IMPORT_NOT_FOUND', '导入任务不存在。')); void runImportJob(db, job.id); return reply.code(202).send({ job }); });
  app.post('/api/playlists/:id/sync', async (request, reply) => { const user = requireUser(db, request, reply); if (!user) return; const { id } = z.object({ id: z.string() }).parse(request.params); const job = createSyncJob(db, user.id, id); if (!job) return reply.code(400).send(apiError('NOT_LINKED_PLAYLIST', '这不是来源关联歌单。')); void runImportJob(db, job.id); return reply.code(202).send({ job }); });
  app.get('/api/imports/:id/events', async (request, reply) => {
    const user = requireUser(db, request, reply); if (!user) return; const { id } = z.object({ id: z.string() }).parse(request.params);
    if (!getImportJob(db, user.id, id)) return reply.code(404).send(apiError('IMPORT_NOT_FOUND', '导入任务不存在。'));
    reply.hijack(); reply.raw.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', connection: 'keep-alive' });
    const send = () => { const job = getImportJob(db, user.id, id); if (!job) return; reply.raw.write(`data: ${JSON.stringify(job)}\n\n`); if (['completed', 'partial', 'failed'].includes(job.status)) { clearInterval(timer); reply.raw.end(); } };
    const timer = setInterval(send, 500); send(); request.raw.on('close', () => clearInterval(timer));
  });

  app.get('/api/backup/export', async (request, reply) => {
    const user = requireUser(db, request, reply); if (!user) return;
    const playlists = listPlaylists(db, user.id).map(item => getPlaylist(db, user.id, item.id));
    reply.header('content-disposition', `attachment; filename="pikachu-backup-${new Date().toISOString().slice(0, 10)}.json"`);
    return { backupVersion: 1, exportedAt: new Date().toISOString(), profile: { username: user.username, language: user.language, volume: user.volume, playMode: user.playMode }, favorites: listFavorites(db, user.id), playlists };
  });
  app.post('/api/backup/restore', async (request, reply) => {
    const user = requireUser(db, request, reply); if (!user) return;
    const body = z.object({ mode: z.enum(['preview', 'merge']).default('preview'), data: z.object({ backupVersion: z.literal(1), favorites: z.array(trackSchema).default([]), playlists: z.array(z.any()).default([]) }) }).parse(request.body);
    if (body.mode === 'preview') return { preview: { favorites: body.data.favorites.length, playlists: body.data.playlists.length, tracks: body.data.playlists.reduce((sum, p) => sum + (Array.isArray(p?.tracks) ? p.tracks.length : 0), 0) } };
    transaction(db, () => {
      for (const item of body.data.favorites) { const saved = upsertTrack(db, { ...item, id: item.id || `${item.source}:${item.sourceTrackId}`, coverUrl: item.coverUrl || null, sourceUrl: item.sourceUrl || null }); db.prepare('INSERT OR IGNORE INTO favorites(user_id,track_id,created_at) VALUES(?,?,?)').run(user.id, saved.id, new Date().toISOString()); }
      for (const raw of body.data.playlists as PlaylistDetail[]) {
        const backupId = String(raw.id || randomUUID());
        let local = db.prepare('SELECT id FROM playlists WHERE user_id=? AND origin_backup_id=?').get(user.id, backupId) as { id: string } | undefined;
        if (!local && raw.source && raw.sourcePlaylistId) local = db.prepare('SELECT id FROM playlists WHERE user_id=? AND source=? AND source_playlist_id=?').get(user.id, raw.source, raw.sourcePlaylistId) as { id: string } | undefined;
        const playlistId = local?.id || randomUUID(); const stamp = new Date().toISOString();
        if (!local) db.prepare(`INSERT INTO playlists(id,user_id,name,description,cover_url,source,source_playlist_id,source_url,origin_backup_id,last_synced_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
          .run(playlistId, user.id, String(raw.name || '恢复的歌单'), String(raw.description || ''), raw.coverUrl || null, raw.source || null, raw.sourcePlaylistId || null, raw.sourceUrl || null, backupId, raw.lastSyncedAt || null, stamp, stamp);
        for (const [index, item] of (Array.isArray(raw.tracks) ? raw.tracks : []).entries()) { const parsed = trackSchema.parse(item); const saved = upsertTrack(db, { ...parsed, id: parsed.id || `${parsed.source}:${parsed.sourceTrackId}`, coverUrl: parsed.coverUrl || null, sourceUrl: parsed.sourceUrl || null }); db.prepare(`INSERT OR IGNORE INTO playlist_items(playlist_id,track_id,position,origin,excluded,created_at) VALUES(?,?,?,?,?,?)`).run(playlistId, saved.id, index, item.origin === 'source' ? 'source' : 'local', item.excluded ? 1 : 0, stamp); }
      }
    });
    return { ok: true, favorites: listFavorites(db, user.id).length, playlists: listPlaylists(db, user.id).length };
  });

  const staticDir = options.staticDir || resolve('dist/client');
  if (existsSync(staticDir)) {
    await app.register(fastifyStatic, { root: staticDir, wildcard: false });
    app.setNotFoundHandler((request, reply) => request.url.startsWith('/api/') ? reply.code(404).send(apiError('NOT_FOUND', '接口不存在。')) : reply.sendFile('index.html'));
  }
  app.addHook('onClose', async () => { if (!options.db) db.close(); });
  return app;
}
