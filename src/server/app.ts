import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { z, ZodError } from 'zod';
import type { Db } from './db.js';
import { createDatabase, createLocalPlaylist, getPlaylist, listFavorites, listPlaylists, rowToTrack, rowToUser, transaction, upsertTrack } from './db.js';
import { clearSessionCookie, createSession, createUserId, getSessionUser, hashPassword, requireUser, revokeToken, SESSION_COOKIE, setSessionCookie, verifyPassword } from './auth.js';
import { createImportJob, createSyncJob, getImportJob, listImportJobs, recoverImportJobs, retryImportJob, runImportJob } from './imports.js';
import { resolvePlaylistInput, resolveTimedLyric, resolveTrackWithFallback, searchAll, SourceError } from './sources.js';
import { getDailyRecommendation, listRecommendationHistory, startDailyGeneration } from './recommendations.js';
import { goMusicApiBaseUrl, openGoMusicApiStream } from './goMusicApi.js';
import { MediaTicketStore, openMediaTicket } from './mediaProxy.js';
import { applyRateLimitHeaders, clearRateLimit, consumeRateLimits, positiveEnvInt, type RateLimitRule } from './rateLimit.js';
import { resetSourceHealthCircuits } from './sourceHealth.js';
import { registerAgentRoutes } from './agentRoutes.js';
import { SOURCES, type MusicSource, type Track } from '../shared/types.js';

const credentialsSchema = z.object({ username: z.string().trim().min(2).max(24).regex(/^[\p{L}\p{N}_.-]+$/u), password: z.string().min(8).max(72) });
const registerSchema = credentialsSchema.extend({ inviteCode: z.string().max(128).optional() });
const sourceSchema = z.enum(SOURCES);
const webUrlSchema = z.string().url().refine(value => ['http:', 'https:'].includes(new URL(value).protocol), '只允许 HTTP/HTTPS 地址');
const trackSourceHosts: Record<MusicSource, string[]> = { migu: ['music.migu.cn'], netease: ['music.163.com'], qq: ['y.qq.com', 'qq.com'], kuwo: ['kuwo.cn'] };
const trackSchema = z.object({
  id: z.string().optional(), source: sourceSchema, sourceTrackId: z.string().min(1), title: z.string().min(1).max(300),
  artist: z.string().max(300).default(''), album: z.string().max(300).default(''), duration: z.number().nonnegative().default(0),
  coverUrl: webUrlSchema.nullable().optional(), sourceUrl: webUrlSchema.nullable().optional(), keyword: z.string().max(300).optional(), displayIndex: z.number().int().positive().optional(), quality: z.string().max(60).nullable().optional(), canonicalKey: z.string().max(700).optional()
}).superRefine((value, context) => {
  if (!value.sourceUrl) return; const host = new URL(value.sourceUrl).hostname.toLowerCase();
  if (!trackSourceHosts[value.source].some(allowed => host === allowed || host.endsWith(`.${allowed}`))) context.addIssue({ code: 'custom', path: ['sourceUrl'], message: '歌曲来源页必须属于所选音乐平台。' });
});

const backupPlaylistTrackSchema = trackSchema.and(z.object({
  position: z.number().int().min(0).max(2_000_000).optional(), origin: z.enum(['source', 'local']).optional(), excluded: z.boolean().optional()
}));
const backupPlaylistSchema = z.object({
  id: z.string().min(1).max(200).optional(), name: z.string().trim().min(1).max(60), description: z.string().max(500).default(''),
  coverUrl: webUrlSchema.nullable().optional(), source: sourceSchema.nullable().optional(), sourcePlaylistId: z.string().max(300).nullable().optional(),
  sourceUrl: webUrlSchema.nullable().optional(), lastSyncedAt: z.string().datetime().nullable().optional(), tracks: z.array(backupPlaylistTrackSchema).max(2000).default([])
});
const backupListeningSchema = z.object({
  id: z.string().min(1).max(100).optional(), track: trackSchema,
  contextType: z.enum(['search', 'favorites', 'playlist', 'daily', 'unknown']).default('unknown'), contextId: z.string().max(200).nullable().optional(),
  actualSource: sourceSchema.nullable().optional(), startedAt: z.string().datetime().optional(), updatedAt: z.string().datetime().optional(),
  playedMs: z.number().int().min(0).max(31 * 24 * 60 * 60_000).default(0), durationMs: z.number().int().min(0).max(24 * 60 * 60_000).default(0),
  completed: z.boolean().default(false), skipped: z.boolean().default(false), errorCode: z.string().max(100).nullable().optional()
});
const backupFeedbackSchema = z.object({
  canonicalKey: z.string().min(1).max(700), action: z.enum(['not_interested', 'less_artist']), artistKey: z.string().max(300).nullable().optional(),
  createdAt: z.string().datetime().optional(), updatedAt: z.string().datetime().optional()
});
const backupRecommendationTrackSchema = trackSchema.and(z.object({
  rank: z.number().int().min(1).max(100).optional(), score: z.number().finite().min(-1_000_000).max(1_000_000).optional(),
  reason: z.string().max(300).optional(), kind: z.enum(['familiar', 'explore']).optional()
}));
const backupRecommendationSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), message: z.string().max(500).default(''), generatedAt: z.string().datetime().nullable().optional(),
  tracks: z.array(backupRecommendationTrackSchema).max(100)
});
const backupSchema = z.object({
  backupVersion: z.union([z.literal(1), z.literal(2)]),
  profile: z.object({ language: z.enum(['zh', 'en']).optional(), volume: z.number().min(0).max(1).optional(), playMode: z.enum(['list', 'loop', 'shuffle']).optional() }).optional(),
  favorites: z.array(trackSchema).max(5000).default([]), playlists: z.array(backupPlaylistSchema).max(200).default([]),
  listeningSessions: z.array(backupListeningSchema).max(10_000).default([]), feedback: z.array(backupFeedbackSchema).max(5000).default([]),
  recommendations: z.array(backupRecommendationSchema).max(30).default([])
});

const MINUTE = 60_000; const HOUR = 60 * MINUTE; const DAY = 24 * HOUR;
const MAX_PLAYLISTS_PER_USER = 200; const MAX_TRACKS_PER_PLAYLIST = 2000; const MAX_LISTENING_SESSIONS_PER_USER = 10_000;

export function trustProxyFromEnv(raw = process.env.TRUST_PROXY, hopsRaw = process.env.TRUST_PROXY_HOPS): false | string[] | number {
  if (!raw || raw.trim().toLowerCase() === 'false') {
    if (!hopsRaw) return false;
    const hops = Number(hopsRaw); if (Number.isInteger(hops) && hops >= 1 && hops <= 3) return hops;
    throw new Error('TRUST_PROXY_HOPS 必须是 1–3 的整数。');
  }
  if (raw.trim().toLowerCase() === 'true') throw new Error('TRUST_PROXY=true 不安全；请填写 Caddy/反向代理的明确 IP 或 CIDR，多个值用逗号分隔。');
  const proxies = raw.split(',').map(value => value.trim()).filter(Boolean);
  if (!proxies.length) return false;
  return proxies;
}

function securityHeaders(reply: FastifyReply, production: boolean) {
  reply.header('x-content-type-options', 'nosniff');
  reply.header('x-frame-options', 'DENY');
  reply.header('referrer-policy', 'strict-origin-when-cross-origin');
  reply.header('permissions-policy', 'camera=(), microphone=(self), geolocation=(), payment=(), usb=()');
  reply.header('cross-origin-opener-policy', 'same-origin');
  reply.header('cross-origin-resource-policy', 'same-origin');
  reply.header('content-security-policy', "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; media-src 'self' blob: https: http:; connect-src 'self' https: http:; worker-src 'self'; manifest-src 'self'");
  if (production) reply.header('strict-transport-security', 'max-age=31536000; includeSubDomains');
}

function apiError(code: string, message: string, details?: unknown) { return { error: { code, message, ...(details === undefined ? {} : { details }) } }; }
function firstHeader(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value?.split(',')[0]?.trim();
}

function safeOrigin(origin: string | undefined, host: string | undefined) {
  if (!origin) return true;
  try {
    const url = new URL(origin);
    if (['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) return true;
    const allowedHosts = [firstHeader(host)].filter((value): value is string => Boolean(value)).map(value => value.toLowerCase());
    if (allowedHosts.includes(url.host.toLowerCase())) return true;
    const configuredOrigins = (process.env.APP_ORIGIN || '').split(',').map(value => value.trim()).filter(Boolean);
    return configuredOrigins.includes(url.origin);
  } catch { return false; }
}

export interface AppOptions { db?: Db; staticDir?: string; logger?: boolean; trustProxy?: boolean | string | string[] | number; mediaTickets?: MediaTicketStore; mediaFetcher?: typeof fetch; }

export async function createApp(options: AppOptions = {}): Promise<FastifyInstance> {
  const db = options.db || createDatabase();
  const app = Fastify({ logger: options.logger ?? true, bodyLimit: 5 * 1024 * 1024, trustProxy: options.trustProxy ?? trustProxyFromEnv() });
  const resetSourceCircuits = resetSourceHealthCircuits(db);
  if (resetSourceCircuits) app.log.info({ resetSourceCircuits }, 'Cleared stale music-source circuit state after startup');
  const mediaTickets = options.mediaTickets || new MediaTicketStore();
  await app.register(cookie);

  const limits = {
    registrationIp: positiveEnvInt('RATE_REGISTER_IP_DAILY', 3), registrationGlobal: positiveEnvInt('RATE_REGISTER_GLOBAL_HOURLY', 20),
    loginAccount: positiveEnvInt('RATE_LOGIN_ACCOUNT_15M', 5), loginIp: positiveEnvInt('RATE_LOGIN_IP_15M', 30),
    searchUser: positiveEnvInt('RATE_SEARCH_USER_MINUTE', 30), searchIp: positiveEnvInt('RATE_SEARCH_IP_MINUTE', 120),
    resolveUser: positiveEnvInt('RATE_RESOLVE_USER_MINUTE', 20), resolveIp: positiveEnvInt('RATE_RESOLVE_IP_MINUTE', 80),
    importUser: positiveEnvInt('RATE_IMPORT_USER_DAILY', 10), importIp: positiveEnvInt('RATE_IMPORT_IP_DAILY', 30),
    recommendationUser: positiveEnvInt('RATE_RECOMMENDATION_USER_DAILY', 5), listeningUser: positiveEnvInt('RATE_LISTENING_USER_MINUTE', 120),
    backupUser: positiveEnvInt('RATE_BACKUP_USER_HOURLY', 10)
  };
  const limited = (reply: FastifyReply, rules: RateLimitRule[], message: string, code = 'RATE_LIMITED') => {
    const result = consumeRateLimits(db, rules); applyRateLimitHeaders(reply, result);
    if (result.allowed) return false;
    const wait = result.retryAfterSeconds < 60 ? `${result.retryAfterSeconds} 秒` : result.retryAfterSeconds < HOUR / 1000
      ? `${Math.ceil(result.retryAfterSeconds / 60)} 分钟` : `${Math.ceil(result.retryAfterSeconds / 3600)} 小时`;
    reply.code(429).send(apiError(code, `${message} 约 ${wait}后可重试。`, { retryAfterSeconds: result.retryAfterSeconds, scope: result.scope }));
    return true;
  };
  const limitImportRequest = (user: { id: string; createdAt: string }, request: FastifyRequest, reply: FastifyReply) => {
    const active = Number((db.prepare("SELECT COUNT(*) count FROM import_jobs WHERE user_id=? AND status IN ('queued','running')").get(user.id) as { count: number }).count);
    if (active >= 1) { reply.code(409).send(apiError('IMPORT_IN_PROGRESS', '当前已有导入或同步任务，请等待它完成。')); return true; }
    const accountAge = Date.now() - Date.parse(user.createdAt); const userLimit = accountAge < DAY ? Math.min(3, limits.importUser) : limits.importUser;
    return limited(reply, [
      { scope: 'import:user', identifier: user.id, limit: userLimit, windowMs: DAY },
      { scope: 'import:ip', identifier: request.ip, limit: limits.importIp, windowMs: DAY }
    ], '歌单导入或同步过于频繁。');
  };

  app.addHook('onRequest', async (request, reply) => {
    securityHeaders(reply, process.env.NODE_ENV === 'production');
    if (request.url.startsWith('/api/')) reply.header('cache-control', 'no-store');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && !safeOrigin(request.headers.origin, request.headers.host)) {
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

  app.get('/api/health', async () => ({
    ok: true, service: 'pikachu-music-local', backupSourceConfigured: Boolean(goMusicApiBaseUrl()), time: new Date().toISOString()
  }));
  app.get('/api/config', async () => {
    const mode = process.env.REGISTRATION_MODE || 'open'; const count = Number((db.prepare('SELECT COUNT(*) count FROM users').get() as { count: number }).count);
    return { registrationOpen: mode === 'open' || (mode === 'first-user' && count === 0), inviteRequired: Boolean(process.env.REGISTRATION_INVITE_CODE) };
  });

  app.post('/api/auth/register', async (request, reply) => {
    const body = registerSchema.parse(request.body); const username = body.username.trim();
    const registrationMode = process.env.REGISTRATION_MODE || 'open';
    const userCount = Number((db.prepare('SELECT COUNT(*) count FROM users').get() as { count: number }).count);
    if (registrationMode === 'closed' || (registrationMode === 'first-user' && userCount > 0)) return reply.code(403).send(apiError('REGISTRATION_CLOSED', '当前服务器已关闭公开注册。'));
    if (process.env.REGISTRATION_INVITE_CODE && body.inviteCode !== process.env.REGISTRATION_INVITE_CODE) return reply.code(403).send(apiError('INVITE_REQUIRED', '邀请码不正确。'));
    const exists = db.prepare('SELECT 1 FROM users WHERE username=?').get(username);
    if (exists) return reply.code(409).send(apiError('USERNAME_EXISTS', '这个用户名已经存在。'));
    if (limited(reply, [
      { scope: 'register:ip', identifier: request.ip, limit: limits.registrationIp, windowMs: DAY },
      { scope: 'register:global', identifier: 'all', limit: limits.registrationGlobal, windowMs: HOUR }
    ], '注册请求过于频繁。')) return;
    const { salt, hash } = await hashPassword(body.password); const id = createUserId(); const stamp = new Date().toISOString();
    db.prepare(`INSERT INTO users(id,username,password_hash,password_salt,created_at,updated_at) VALUES(?,?,?,?,?,?)`).run(id, username, hash, salt, stamp, stamp);
    const token = createSession(db, id); setSessionCookie(reply, token);
    const created = db.prepare('SELECT * FROM users WHERE id=?').get(id) as Record<string, unknown>;
    return reply.code(201).send({ user: rowToUser(created) });
  });

  app.post('/api/auth/login', async (request, reply) => {
    const body = credentialsSchema.parse(request.body); const accountIdentifier = body.username.trim().toLowerCase();
    if (limited(reply, [
      { scope: 'login:account', identifier: accountIdentifier, limit: limits.loginAccount, windowMs: 15 * MINUTE },
      { scope: 'login:ip', identifier: request.ip, limit: limits.loginIp, windowMs: 15 * MINUTE }
    ], '登录尝试次数过多。', 'TOO_MANY_ATTEMPTS')) return;
    const row = db.prepare('SELECT * FROM users WHERE username=?').get(body.username) as Record<string, unknown> | undefined;
    if (!row || !(await verifyPassword(body.password, String(row.password_salt), String(row.password_hash)))) {
      return reply.code(401).send(apiError('INVALID_CREDENTIALS', '用户名或密码不正确。'));
    }
    clearRateLimit(db, { scope: 'login:account', identifier: accountIdentifier });
    const token = createSession(db, String(row.id)); setSessionCookie(reply, token);
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
    if (limited(reply, [
      { scope: 'search:user', identifier: user.id, limit: limits.searchUser, windowMs: MINUTE },
      { scope: 'search:ip', identifier: request.ip, limit: limits.searchIp, windowMs: MINUTE }
    ], '搜索过于频繁。')) return;
    const sources = (query.sources?.split(',').filter(v => SOURCES.includes(v as MusicSource)) || [...SOURCES]) as MusicSource[];
    return searchAll(db, query.q, sources.length ? sources : [...SOURCES], query.limit);
  });

  app.post('/api/tracks/:id/resolve', async (request, reply) => {
    const user = requireUser(db, request, reply); if (!user) return;
    const params = z.object({ id: z.string() }).parse(request.params); const body = z.object({ track: trackSchema.optional(), refresh: z.boolean().default(false) }).parse(request.body || {});
    if (limited(reply, [
      { scope: 'resolve:user', identifier: user.id, limit: limits.resolveUser, windowMs: MINUTE },
      { scope: 'resolve:ip', identifier: request.ip, limit: limits.resolveIp, windowMs: MINUTE }
    ], '播放地址解析过于频繁。')) return;
    let input: Track | null = body.track ? { ...body.track, id: body.track.id || `${body.track.source}:${body.track.sourceTrackId}`, coverUrl: body.track.coverUrl || null, sourceUrl: body.track.sourceUrl || null } : null;
    if (input) input = upsertTrack(db, input);
    if (!input) { const row = db.prepare('SELECT * FROM tracks WHERE id=?').get(params.id) as Record<string, unknown> | undefined; if (row) input = rowToTrack(row); }
    if (!input) return reply.code(404).send(apiError('TRACK_NOT_FOUND', '歌曲不存在。'));
    const resolved = await resolveTrackWithFallback(input, db, body.refresh);
    return { track: { ...resolved, proxyUrl: mediaTickets.issue(user.id, resolved) } };
  });
  app.get('/api/media/:token', async (request, reply) => {
    const user = requireUser(db, request, reply); if (!user) return;
    const params = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{32}$/) }).parse(request.params);
    const ticket = mediaTickets.get(params.token, user.id);
    if (!ticket) return reply.code(404).send(apiError('MEDIA_TICKET_EXPIRED', '兼容播放地址已过期，请重新播放歌曲。'));
    let upstream: Response;
    try { upstream = await openMediaTicket(ticket, request.headers.range, options.mediaFetcher); }
    catch (error) { return reply.code(502).send(apiError('MEDIA_PROXY_FAILED', '兼容连接未能读取音频。', { source: ticket.source, reason: error instanceof Error ? error.message : String(error) })); }
    for (const header of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified']) {
      const value = upstream.headers.get(header); if (value) reply.header(header, value);
    }
    reply.header('cache-control', 'private, no-store'); reply.code(upstream.status);
    return reply.send(Readable.fromWeb(upstream.body as never));
  });
  app.get('/api/backup-media', async (request, reply) => {
    const user = requireUser(db, request, reply); if (!user) return;
    const query = z.object({
      source: sourceSchema, id: z.string().min(1).max(300), name: z.string().min(1).max(300),
      artist: z.string().max(300).default(''), duration: z.coerce.number().int().positive().max(24 * 60 * 60).optional()
    }).parse(request.query);
    const upstream = await openGoMusicApiStream(query, request.headers.range);
    if (!upstream) return reply.code(503).send(apiError('BACKUP_SOURCE_DISABLED', '备用音源服务尚未启用。'));
    if (![200, 206].includes(upstream.status) || !upstream.body) {
      await upstream.body?.cancel().catch(() => undefined);
      return reply.code(502).send(apiError('BACKUP_STREAM_FAILED', '备用音源暂时无法返回有效音频。'));
    }
    for (const header of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified']) {
      const value = upstream.headers.get(header); if (value) reply.header(header, value);
    }
    reply.header('cache-control', 'private, no-store'); reply.code(upstream.status);
    return reply.send(Readable.fromWeb(upstream.body as never));
  });
  app.get('/api/tracks/:id/lyrics', async (request, reply) => {
    const user = requireUser(db, request, reply); if (!user) return;
    const params = z.object({ id: z.string() }).parse(request.params); const row = db.prepare('SELECT * FROM tracks WHERE id=?').get(params.id) as Record<string, unknown> | undefined;
    if (!row) return reply.code(404).send(apiError('TRACK_NOT_FOUND', '歌曲不存在。'));
    return resolveTimedLyric(rowToTrack(row), db);
  });
  app.get('/api/tracks/:id/download', async (request, reply) => {
    const user = requireUser(db, request, reply); if (!user) return;
    const params = z.object({ id: z.string() }).parse(request.params); const row = db.prepare('SELECT * FROM tracks WHERE id=?').get(params.id) as Record<string, unknown> | undefined;
    if (!row) return reply.code(404).send(apiError('TRACK_NOT_FOUND', '歌曲不存在。'));
    try { const resolved = await resolveTrackWithFallback(rowToTrack(row), db); return reply.redirect(resolved.audioUrl); }
    catch { const sourceUrl = row.source_url ? String(row.source_url) : null; if (sourceUrl) return reply.redirect(sourceUrl); throw new SourceError('UNPLAYABLE', '当前歌曲没有可公开下载的媒体地址。'); }
  });

  app.post('/api/listening-sessions', async (request, reply) => {
    const user = requireUser(db, request, reply); if (!user) return;
    const body = z.object({
      id: z.string().min(8).max(100), trackId: z.string().min(1).max(700),
      contextType: z.enum(['search', 'favorites', 'playlist', 'daily', 'unknown']).default('unknown'), contextId: z.string().max(200).nullable().optional(),
      actualSource: sourceSchema.nullable().optional(), startedAt: z.string().datetime(), playedMs: z.number().int().min(0).max(31 * 24 * 60 * 60_000),
      durationMs: z.number().int().min(0).max(24 * 60 * 60_000), completed: z.boolean().default(false), skipped: z.boolean().default(false), errorCode: z.string().max(100).nullable().optional()
    }).parse(request.body);
    if (limited(reply, [{ scope: 'listening:user', identifier: user.id, limit: limits.listeningUser, windowMs: MINUTE }], '播放记录提交过于频繁。')) return;
    if (!db.prepare('SELECT 1 FROM tracks WHERE id=?').get(body.trackId)) return reply.code(404).send(apiError('TRACK_NOT_FOUND', '歌曲不存在。'));
    const stamp = new Date().toISOString();
    db.prepare(`INSERT INTO listening_sessions(id,user_id,track_id,context_type,context_id,actual_source,started_at,updated_at,played_ms,duration_ms,completed,skipped,error_code)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
      played_ms=MAX(listening_sessions.played_ms,excluded.played_ms),duration_ms=MAX(listening_sessions.duration_ms,excluded.duration_ms),
      completed=MAX(listening_sessions.completed,excluded.completed),skipped=MAX(listening_sessions.skipped,excluded.skipped),
      actual_source=COALESCE(excluded.actual_source,listening_sessions.actual_source),error_code=COALESCE(excluded.error_code,listening_sessions.error_code),updated_at=excluded.updated_at
      WHERE listening_sessions.user_id=excluded.user_id`)
      .run(body.id, user.id, body.trackId, body.contextType, body.contextId || null, body.actualSource || null, body.startedAt, stamp, body.playedMs, body.durationMs, body.completed ? 1 : 0, body.skipped ? 1 : 0, body.errorCode || null);
    db.prepare(`DELETE FROM listening_sessions WHERE user_id=? AND id NOT IN (
      SELECT id FROM listening_sessions WHERE user_id=? ORDER BY updated_at DESC LIMIT ?
    )`).run(user.id, user.id, MAX_LISTENING_SESSIONS_PER_USER);
    return reply.code(202).send({ ok: true });
  });
  app.get('/api/listening-sessions', async (request, reply) => {
    const user = requireUser(db, request, reply); if (!user) return;
    const { limit } = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) }).parse(request.query);
    return { sessions: db.prepare(`SELECT id,track_id trackId,context_type contextType,context_id contextId,actual_source actualSource,started_at startedAt,updated_at updatedAt,played_ms playedMs,duration_ms durationMs,completed,skipped,error_code errorCode
      FROM listening_sessions WHERE user_id=? ORDER BY updated_at DESC LIMIT ?`).all(user.id, limit) };
  });
  app.post('/api/recommendations/feedback', async (request, reply) => {
    const user = requireUser(db, request, reply); if (!user) return;
    const body = z.object({ canonicalKey: z.string().min(1).max(700), action: z.enum(['not_interested', 'less_artist']), artistKey: z.string().max(300).nullable().optional() }).parse(request.body);
    const stamp = new Date().toISOString();
    db.prepare(`INSERT INTO recommendation_feedback(user_id,canonical_key,action,artist_key,created_at,updated_at) VALUES(?,?,?,?,?,?)
      ON CONFLICT(user_id,canonical_key,action) DO UPDATE SET artist_key=excluded.artist_key,updated_at=excluded.updated_at`)
      .run(user.id, body.canonicalKey, body.action, body.artistKey || null, stamp, stamp);
    return reply.code(201).send({ ok: true });
  });
  app.get('/api/recommendations/daily', async (request, reply) => {
    const user = requireUser(db, request, reply); if (!user) return;
    const { date, regenerate } = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), regenerate: z.coerce.boolean().default(false) }).parse(request.query);
    const existing = getDailyRecommendation(db, user.id, date);
    if (!existing || existing.status === 'failed' || regenerate) {
      if (limited(reply, [{ scope: 'recommendation:user', identifier: user.id, limit: limits.recommendationUser, windowMs: DAY }], '每日推荐重新生成过于频繁。')) return;
      startDailyGeneration(db, user.id, date);
    }
    const daily = getDailyRecommendation(db, user.id, date);
    const fallback = daily?.status === 'completed' ? null : listRecommendationHistory(db, user.id).find(item => item.date !== date) || null;
    return reply.code(daily?.status === 'completed' ? 200 : 202).send({ daily, fallback });
  });
  app.get('/api/recommendations/history', async (request, reply) => {
    const user = requireUser(db, request, reply); if (!user) return;
    return { history: listRecommendationHistory(db, user.id) };
  });

  app.get('/api/favorites', async (request, reply) => { const user = requireUser(db, request, reply); if (!user) return; return { tracks: listFavorites(db, user.id) }; });
  app.post('/api/favorites', async (request, reply) => {
    const user = requireUser(db, request, reply); if (!user) return;
    const item = trackSchema.parse(request.body); const saved = upsertTrack(db, { ...item, id: item.id || `${item.source}:${item.sourceTrackId}`, coverUrl: item.coverUrl || null, sourceUrl: item.sourceUrl || null });
    const alreadyFavorite = db.prepare('SELECT 1 FROM favorites WHERE user_id=? AND track_id=?').get(user.id, saved.id);
    const favoriteCount = Number((db.prepare('SELECT COUNT(*) count FROM favorites WHERE user_id=?').get(user.id) as { count: number }).count);
    if (!alreadyFavorite && favoriteCount >= 5000) return reply.code(409).send(apiError('FAVORITE_LIMIT_REACHED', '每个账户最多收藏 5000 首歌曲。'));
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
    const count = Number((db.prepare('SELECT COUNT(*) count FROM playlists WHERE user_id=?').get(user.id) as { count: number }).count);
    if (count >= MAX_PLAYLISTS_PER_USER) return reply.code(409).send(apiError('PLAYLIST_LIMIT_REACHED', `每个账户最多创建 ${MAX_PLAYLISTS_PER_USER} 个歌单。`));
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
    const existingItem = db.prepare('SELECT 1 FROM playlist_items WHERE playlist_id=? AND track_id=?').get(id, saved.id);
    const itemCount = Number((db.prepare('SELECT COUNT(*) count FROM playlist_items WHERE playlist_id=? AND excluded=0').get(id) as { count: number }).count);
    if (!existingItem && itemCount >= MAX_TRACKS_PER_PLAYLIST) return reply.code(409).send(apiError('PLAYLIST_TRACK_LIMIT_REACHED', `每个歌单最多保存 ${MAX_TRACKS_PER_PLAYLIST} 首歌曲。`));
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
    const playlist = getPlaylist(db, user.id, id); if (!playlist) return reply.code(404).send(apiError('PLAYLIST_NOT_FOUND', '歌单不存在。'));
    const currentIds = playlist.tracks.filter(item => !item.excluded).map(item => item.id);
    if (new Set(trackIds).size !== trackIds.length || trackIds.length !== currentIds.length || trackIds.some(trackId => !currentIds.includes(trackId))) {
      return reply.code(400).send(apiError('INVALID_TRACK_ORDER', '排序必须且只能包含歌单中的全部可见歌曲。'));
    }
    transaction(db, () => trackIds.forEach((trackId, position) => db.prepare('UPDATE playlist_items SET position=? WHERE playlist_id=? AND track_id=? AND excluded=0').run(position, id, trackId)));
    return { playlist: getPlaylist(db, user.id, id) };
  });

  app.get('/api/imports', async (request, reply) => { const user = requireUser(db, request, reply); if (!user) return; return { jobs: listImportJobs(db, user.id) }; });
  app.post('/api/imports', async (request, reply) => {
    const user = requireUser(db, request, reply); if (!user) return; const body = z.object({ input: z.string().trim().min(1).max(1000), source: sourceSchema.optional() }).parse(request.body);
    if (limitImportRequest(user, request, reply)) return;
    const parsed = await resolvePlaylistInput(body.input, body.source);
    const existing = db.prepare('SELECT 1 FROM playlists WHERE user_id=? AND source=? AND source_playlist_id=?').get(user.id, parsed.source, parsed.id);
    const playlistCount = Number((db.prepare('SELECT COUNT(*) count FROM playlists WHERE user_id=?').get(user.id) as { count: number }).count);
    if (!existing && playlistCount >= MAX_PLAYLISTS_PER_USER) return reply.code(409).send(apiError('PLAYLIST_LIMIT_REACHED', `每个账户最多创建 ${MAX_PLAYLISTS_PER_USER} 个歌单。`));
    const job = createImportJob(db, user.id, body.input, body.source, parsed); void runImportJob(db, job.id); return reply.code(202).send({ job });
  });
  app.get('/api/imports/:id', async (request, reply) => { const user = requireUser(db, request, reply); if (!user) return; const { id } = z.object({ id: z.string() }).parse(request.params); const job = getImportJob(db, user.id, id); if (!job) return reply.code(404).send(apiError('IMPORT_NOT_FOUND', '导入任务不存在。')); return { job }; });
  app.post('/api/imports/:id/retry', async (request, reply) => {
    const user = requireUser(db, request, reply); if (!user) return; const { id } = z.object({ id: z.string() }).parse(request.params);
    if (limitImportRequest(user, request, reply)) return;
    const job = retryImportJob(db, user.id, id); if (!job) return reply.code(404).send(apiError('IMPORT_NOT_FOUND', '导入任务不存在。')); void runImportJob(db, job.id); return reply.code(202).send({ job });
  });
  app.post('/api/playlists/:id/sync', async (request, reply) => {
    const user = requireUser(db, request, reply); if (!user) return; const { id } = z.object({ id: z.string() }).parse(request.params);
    if (limitImportRequest(user, request, reply)) return;
    const job = createSyncJob(db, user.id, id); if (!job) return reply.code(400).send(apiError('NOT_LINKED_PLAYLIST', '这不是来源关联歌单。')); void runImportJob(db, job.id); return reply.code(202).send({ job });
  });
  app.get('/api/imports/:id/events', async (request, reply) => {
    const user = requireUser(db, request, reply); if (!user) return; const { id } = z.object({ id: z.string() }).parse(request.params);
    if (!getImportJob(db, user.id, id)) return reply.code(404).send(apiError('IMPORT_NOT_FOUND', '导入任务不存在。'));
    reply.hijack(); reply.raw.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', connection: 'keep-alive' });
    const send = () => { const job = getImportJob(db, user.id, id); if (!job) return; reply.raw.write(`data: ${JSON.stringify(job)}\n\n`); if (['completed', 'partial', 'failed'].includes(job.status)) { clearInterval(timer); reply.raw.end(); } };
    const timer = setInterval(send, 500); send(); request.raw.on('close', () => clearInterval(timer));
  });

  app.get('/api/backup/export', async (request, reply) => {
    const user = requireUser(db, request, reply); if (!user) return;
    if (limited(reply, [{ scope: 'backup:user', identifier: user.id, limit: limits.backupUser, windowMs: HOUR }], '备份操作过于频繁。')) return;
    const playlists = listPlaylists(db, user.id).map(item => getPlaylist(db, user.id, item.id));
    const listeningSessions = (db.prepare(`SELECT ls.*,t.source,t.source_track_id,t.title,t.artist,t.album,t.duration,t.cover_url,t.source_url,t.keyword,t.display_index,t.quality,t.canonical_key
      FROM listening_sessions ls JOIN tracks t ON t.id=ls.track_id WHERE ls.user_id=? ORDER BY ls.started_at`).all(user.id) as Record<string, unknown>[]).map(row => ({
        id: String(row.id), track: rowToTrack({ ...row, id: row.track_id }), contextType: String(row.context_type), contextId: row.context_id ? String(row.context_id) : null,
        actualSource: row.actual_source || null, startedAt: String(row.started_at), updatedAt: String(row.updated_at), playedMs: Number(row.played_ms), durationMs: Number(row.duration_ms),
        completed: Boolean(row.completed), skipped: Boolean(row.skipped), errorCode: row.error_code ? String(row.error_code) : null
      }));
    const feedback = db.prepare('SELECT canonical_key canonicalKey,action,artist_key artistKey,created_at createdAt,updated_at updatedAt FROM recommendation_feedback WHERE user_id=?').all(user.id);
    reply.header('content-disposition', `attachment; filename="pikachu-backup-${new Date().toISOString().slice(0, 10)}.json"`);
    return { backupVersion: 2, exportedAt: new Date().toISOString(), profile: { username: user.username, language: user.language, volume: user.volume, playMode: user.playMode }, favorites: listFavorites(db, user.id), playlists, listeningSessions, feedback, recommendations: listRecommendationHistory(db, user.id) };
  });
  app.post('/api/backup/restore', async (request, reply) => {
    const user = requireUser(db, request, reply); if (!user) return;
    const body = z.object({ mode: z.enum(['preview', 'merge']).default('preview'), data: backupSchema }).parse(request.body);
    if (body.mode === 'preview') return { preview: { favorites: body.data.favorites.length, playlists: body.data.playlists.length, tracks: body.data.playlists.reduce((sum, p) => sum + (Array.isArray(p?.tracks) ? p.tracks.length : 0), 0) } };
    if (limited(reply, [{ scope: 'backup:user', identifier: user.id, limit: limits.backupUser, windowMs: HOUR }], '备份操作过于频繁。')) return;
    const currentPlaylistCount = Number((db.prepare('SELECT COUNT(*) count FROM playlists WHERE user_id=?').get(user.id) as { count: number }).count);
    let newPlaylistCount = 0;
    for (const raw of body.data.playlists) {
      const backupId = raw.id || ''; let exists = backupId ? db.prepare('SELECT 1 FROM playlists WHERE user_id=? AND (id=? OR origin_backup_id=?)').get(user.id, backupId, backupId) : undefined;
      if (!exists && raw.source && raw.sourcePlaylistId) exists = db.prepare('SELECT 1 FROM playlists WHERE user_id=? AND source=? AND source_playlist_id=?').get(user.id, raw.source, raw.sourcePlaylistId);
      if (!exists) newPlaylistCount += 1;
    }
    if (currentPlaylistCount + newPlaylistCount > MAX_PLAYLISTS_PER_USER) return reply.code(409).send(apiError('PLAYLIST_LIMIT_REACHED', `恢复后歌单数量不能超过 ${MAX_PLAYLISTS_PER_USER} 个。`));
    transaction(db, () => {
      if (body.data.profile) db.prepare(`UPDATE users SET language=COALESCE(?,language),volume=COALESCE(?,volume),play_mode=COALESCE(?,play_mode),updated_at=? WHERE id=?`)
        .run(body.data.profile.language ?? null, body.data.profile.volume ?? null, body.data.profile.playMode ?? null, new Date().toISOString(), user.id);
      for (const item of body.data.favorites) { const saved = upsertTrack(db, { ...item, id: item.id || `${item.source}:${item.sourceTrackId}`, coverUrl: item.coverUrl || null, sourceUrl: item.sourceUrl || null }); db.prepare('INSERT OR IGNORE INTO favorites(user_id,track_id,created_at) VALUES(?,?,?)').run(user.id, saved.id, new Date().toISOString()); }
      for (const raw of body.data.playlists) {
        const backupId = String(raw.id || randomUUID());
        let local = db.prepare('SELECT id FROM playlists WHERE id=? AND user_id=?').get(backupId, user.id) as { id: string } | undefined;
        if (!local) local = db.prepare('SELECT id FROM playlists WHERE user_id=? AND origin_backup_id=?').get(user.id, backupId) as { id: string } | undefined;
        if (!local && raw.source && raw.sourcePlaylistId) local = db.prepare('SELECT id FROM playlists WHERE user_id=? AND source=? AND source_playlist_id=?').get(user.id, raw.source, raw.sourcePlaylistId) as { id: string } | undefined;
        const playlistId = local?.id || randomUUID(); const stamp = new Date().toISOString();
        if (!local) db.prepare(`INSERT INTO playlists(id,user_id,name,description,cover_url,source,source_playlist_id,source_url,origin_backup_id,last_synced_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
          .run(playlistId, user.id, String(raw.name || '恢复的歌单'), String(raw.description || ''), raw.coverUrl || null, raw.source || null, raw.sourcePlaylistId || null, raw.sourceUrl || null, backupId, raw.lastSyncedAt || null, stamp, stamp);
        for (const [index, item] of (Array.isArray(raw.tracks) ? raw.tracks : []).entries()) { const parsed = trackSchema.parse(item); const saved = upsertTrack(db, { ...parsed, id: parsed.id || `${parsed.source}:${parsed.sourceTrackId}`, coverUrl: parsed.coverUrl || null, sourceUrl: parsed.sourceUrl || null }); db.prepare(`INSERT OR IGNORE INTO playlist_items(playlist_id,track_id,position,origin,excluded,created_at) VALUES(?,?,?,?,?,?)`).run(playlistId, saved.id, index, item.origin === 'source' ? 'source' : 'local', item.excluded ? 1 : 0, stamp); }
      }
      for (const raw of body.data.listeningSessions) {
        const stamp = new Date().toISOString();
        const parsedTrack = trackSchema.parse(raw.track); const saved = upsertTrack(db, { ...parsedTrack, id: parsedTrack.id || `${parsedTrack.source}:${parsedTrack.sourceTrackId}`, coverUrl: parsedTrack.coverUrl || null, sourceUrl: parsedTrack.sourceUrl || null });
        const backupId = String(raw.id || randomUUID()); const byOrigin = db.prepare('SELECT id FROM listening_sessions WHERE user_id=? AND origin_backup_id=?').get(user.id, backupId) as { id: string } | undefined;
        const sameId = db.prepare('SELECT user_id FROM listening_sessions WHERE id=?').get(backupId) as { user_id: string } | undefined; const sessionId = byOrigin?.id || (!sameId || sameId.user_id === user.id ? backupId : randomUUID());
        db.prepare(`INSERT INTO listening_sessions(id,user_id,track_id,context_type,context_id,actual_source,started_at,updated_at,played_ms,duration_ms,completed,skipped,error_code,origin_backup_id)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET played_ms=MAX(listening_sessions.played_ms,excluded.played_ms),duration_ms=MAX(listening_sessions.duration_ms,excluded.duration_ms),completed=MAX(listening_sessions.completed,excluded.completed),skipped=MAX(listening_sessions.skipped,excluded.skipped),error_code=COALESCE(excluded.error_code,listening_sessions.error_code),origin_backup_id=COALESCE(listening_sessions.origin_backup_id,excluded.origin_backup_id) WHERE listening_sessions.user_id=excluded.user_id`)
          .run(sessionId, user.id, saved.id, raw.contextType, raw.contextId || null, raw.actualSource ?? null, String(raw.startedAt || stamp), String(raw.updatedAt || stamp), Math.max(0, Number(raw.playedMs || 0)), Math.max(0, Number(raw.durationMs || 0)), raw.completed ? 1 : 0, raw.skipped ? 1 : 0, raw.errorCode || null, backupId);
      }
      for (const raw of body.data.feedback) {
        const stamp = new Date().toISOString();
        db.prepare(`INSERT INTO recommendation_feedback(user_id,canonical_key,action,artist_key,created_at,updated_at) VALUES(?,?,?,?,?,?)
          ON CONFLICT(user_id,canonical_key,action) DO UPDATE SET artist_key=excluded.artist_key,updated_at=excluded.updated_at`).run(user.id, String(raw.canonicalKey), raw.action, raw.artistKey || null, raw.createdAt || stamp, raw.updatedAt || stamp);
      }
      for (const raw of body.data.recommendations) {
        let run = db.prepare('SELECT id FROM recommendation_runs WHERE user_id=? AND recommendation_date=?').get(user.id, raw.date) as { id: string } | undefined;
        if (!run) { run = { id: randomUUID() }; const stamp = new Date().toISOString(); db.prepare("INSERT INTO recommendation_runs(id,user_id,recommendation_date,status,message,generated_at,created_at,updated_at) VALUES(?,?,?,'completed',?,?,?,?)").run(run.id, user.id, raw.date, String(raw.message || ''), raw.generatedAt || stamp, stamp, stamp); }
        for (const [index, item] of raw.tracks.entries()) { const parsed = trackSchema.parse(item); const saved = upsertTrack(db, { ...parsed, id: parsed.id || `${parsed.source}:${parsed.sourceTrackId}`, coverUrl: parsed.coverUrl || null, sourceUrl: parsed.sourceUrl || null }); db.prepare('INSERT OR IGNORE INTO recommendation_items(run_id,track_id,rank,score,reason,kind) VALUES(?,?,?,?,?,?)').run(run.id, saved.id, Number(item.rank || index + 1), Number(item.score || 0), String(item.reason || '恢复的推荐'), item.kind === 'explore' ? 'explore' : 'familiar'); }
      }
    });
    return { ok: true, favorites: listFavorites(db, user.id).length, playlists: listPlaylists(db, user.id).length };
  });

  registerAgentRoutes(app, db);

  const staticDir = options.staticDir || resolve('dist/client');
  if (existsSync(staticDir)) {
    await app.register(fastifyStatic, { root: staticDir, wildcard: false });
    app.setNotFoundHandler((request, reply) => request.url.startsWith('/api/') ? reply.code(404).send(apiError('NOT_FOUND', '接口不存在。')) : reply.sendFile('index.html'));
  }
  recoverImportJobs(db);
  app.addHook('onClose', async () => { if (!options.db) db.close(); });
  return app;
}
