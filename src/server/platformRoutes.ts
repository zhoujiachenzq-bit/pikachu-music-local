import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from './db.js';
import { createLocalPlaylist, getPlaylist, rowToTrack, transaction, upsertTrack } from './db.js';
import { requireUser } from './auth.js';
import { platformQuerySchema, platformRequest, queryPlatform, safePlatformImage } from './platformGateway.js';
import { QR_SOURCES } from '../shared/platform.js';
import type { Track } from '../shared/types.js';
import { inspectGoMusicAudio } from './goMusicApi.js';

export function registerPlatformRoutes(app: FastifyInstance, db: Db) {
  const previews = new Map<string, { userId: string; tracks: Track[]; expires: number; playlistId?: string }>();
  const sessions = new Map<string, { userId: string; source: string; key: string; expires: number }>();
  const localAccounts = () => Boolean(process.env.GO_MUSIC_API_DIRECT_MEDIA);
  const fail = (message: string) => ({ error: { code: 'PLATFORM_UNAVAILABLE', message } });
  app.get('/api/platform/capabilities', async (request, reply) => {
    if (!requireUser(db, request, reply)) return;
    return { localAccounts: localAccounts() };
  });
  app.get('/api/platform/browse', async (request, reply) => {
    const user = requireUser(db, request, reply); if (!user) return;
    const query = platformQuerySchema.parse(request.query);
    if (query.mode === 'personal' && !localAccounts()) return reply.code(403).send(fail('个人平台账号仅在手机本地模式开放。'));
    try {
      const result = await queryPlatform(query);
      for (const track of result.tracks) upsertTrack(db, track);
      const now = Date.now(); for (const [id, preview] of previews) if (preview.expires < now) previews.delete(id);
      if (previews.size >= 100) previews.delete(previews.keys().next().value!);
      const previewId = result.tracks.length ? randomUUID() : undefined;
      if (previewId) previews.set(previewId, { userId: user.id, tracks: result.tracks, expires: now + 15 * 60000 });
      reply.header('cache-control', 'private, no-store');
      return { ...result, previewId, localAccounts: localAccounts() };
    } catch (error) { return reply.code(502).send(fail(error instanceof Error ? error.message : '平台暂不可用。')); }
  });
  for (const kind of ['inspect', 'lyric'] as const) app.get(`/api/platform/${kind}`, async (request, reply) => {
    if (!requireUser(db, request, reply)) return;
    const { id } = z.object({ id: z.string().min(1).max(700) }).parse(request.query);
    const row = db.prepare('SELECT * FROM tracks WHERE id=?').get(id) as Record<string, unknown> | undefined;
    if (!row) return reply.code(404).send(fail('歌曲不存在，请重新打开列表。'));
    const track = rowToTrack(row);
    try {
      if (kind === 'inspect') return await inspectGoMusicAudio(track);
      const result = await platformRequest(`music/${kind}`, { source: track.source, id: track.sourceTrackId, name: track.title, artist: track.artist, duration: String(track.duration / 1000) });
      if (kind === 'lyric') {
        const lyric = result.data?.lyric;
        if (typeof lyric !== 'string' || !lyric) throw new Error('该歌曲没有可导出的歌词。');
        return { lyric: lyric.slice(0, 200000) };
      }
    } catch (error) { return reply.code(502).send(fail(error instanceof Error ? error.message : '平台暂不可用。')); }
  });
  app.post('/api/platform/save', async (request, reply) => {
    const user = requireUser(db, request, reply); if (!user) return;
    const body = z.object({ previewId: z.string().uuid(), name: z.string().trim().min(1).max(60) }).parse(request.body);
    const preview = previews.get(body.previewId);
    if (!preview || preview.userId !== user.id || preview.expires < Date.now()) return reply.code(410).send(fail('预览已过期，请重新打开歌曲列表。'));
    if (preview.playlistId) return { playlist: getPlaylist(db, user.id, preview.playlistId) };
    if (Number((db.prepare('SELECT count(*) AS n FROM playlists WHERE user_id=?').get(user.id) as { n: number }).n) >= 200) return reply.code(409).send(fail('歌单数量已达上限。'));
    const playlist = transaction(db, () => {
      const playlist = createLocalPlaylist(db, user.id, body.name);
      const insert = db.prepare("INSERT OR IGNORE INTO playlist_items(playlist_id,track_id,position,origin,excluded,created_at) VALUES(?,?,?,'local',0,?)");
      preview.tracks.forEach((track, index) => insert.run(playlist.id, upsertTrack(db, track).id, index, new Date().toISOString()));
      return getPlaylist(db, user.id, playlist.id)!;
    });
    preview.playlistId = playlist.id; return { playlist };
  });
  app.post('/api/platform/login', async (request, reply) => {
    const user = requireUser(db, request, reply); if (!user) return;
    if (!localAccounts()) return reply.code(403).send(fail('平台账号仅在手机本地模式开放，避免多个用户共用凭据。'));
    const { source } = z.object({ source: z.enum(QR_SOURCES) }).parse(request.body);
    try {
      const response = await platformRequest(`system/qr_login/${source}`, {}, { method: 'POST' });
      const data = response.data || {}; if (typeof data.key !== 'string' || !data.key) throw new Error('平台未返回有效登录会话。');
      for (const [id, value] of sessions) if (value.expires < Date.now() || value.userId === user.id && value.source === source) sessions.delete(id);
      if (sessions.size >= 20) throw new Error('登录请求过多，请稍后重试。');
      const session = randomUUID(); const expiresAt = Math.min(Date.now() + 180000, Number(data.expires_at) > 0 ? Number(data.expires_at) * 1000 : Infinity);
      sessions.set(session, { userId: user.id, source, key: data.key, expires: expiresAt });
      reply.header('cache-control', 'private, no-store');
      return { session, url: safePlatformImage(data.url) || '', imageUrl: safePlatformImage(data.image_url) || '', expiresAt };
    } catch (error) { return reply.code(502).send(fail(error instanceof Error ? error.message : '登录请求失败。')); }
  });
  app.get('/api/platform/login/:session', async (request, reply) => {
    const user = requireUser(db, request, reply); if (!user) return;
    if (!localAccounts()) return reply.code(403).send(fail('仅限手机本地模式。'));
    const { session } = z.object({ session: z.string().uuid() }).parse(request.params); const pending = sessions.get(session);
    if (!pending || pending.userId !== user.id || pending.expires < Date.now()) return { status: 'expired', message: '二维码已过期，请重新获取。' };
    try {
      const response = await platformRequest(`system/qr_login/${pending.source}`, { key: pending.key });
      const status = ['waiting', 'scanned', 'success', 'expired', 'failed'].includes(response.data?.status) ? response.data.status : 'failed';
      if (['success', 'expired', 'failed'].includes(status)) sessions.delete(session);
      reply.header('cache-control', 'private, no-store');
      // Never forward cookie/cookies/extra fields from the upstream QR result.
      return { status, message: ({ waiting: '等待扫码', scanned: '已扫码，请在平台确认', success: '登录成功，凭据保存在本机', expired: '二维码已过期', failed: '平台登录失败' } as Record<string, string>)[status] };
    } catch { return reply.code(502).send(fail('登录状态暂时无法读取，请稍后重试。')); }
  });
  app.post('/api/platform/logout', async (request, reply) => {
    const user = requireUser(db, request, reply); if (!user) return;
    if (!localAccounts()) return reply.code(403).send(fail('仅限手机本地模式。'));
    const { source } = z.object({ source: z.enum(QR_SOURCES) }).parse(request.body);
    try {
      const all = await platformRequest('system/cookies');
      const cookies = all.data || all; const actual = source === 'qq_wx' ? 'qq' : source;
      const updated = Object.fromEntries(Object.entries(cookies).filter(([key, value]) => typeof value === 'string' && key !== actual));
      updated[actual] = '';
      await platformRequest('system/cookies', {}, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(updated) });
      for (const [id, pending] of sessions) if (pending.userId === user.id && (pending.source === source || actual === 'qq' && ['qq', 'qq_wx'].includes(pending.source))) sessions.delete(id);
      return { ok: true };
    } catch { return reply.code(502).send(fail('退出失败，请重试。')); }
  });
}
