import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import type { Db } from './db.js';
import { requireUser } from './auth.js';
import { createLocalPlaylist, transaction } from './db.js';
import { createSyncJob, runImportJob } from './imports.js';
import { startDailyGeneration } from './recommendations.js';
import { consumeRateLimits, applyRateLimitHeaders } from './rateLimit.js';
import { AgentRuntime } from './agentRuntime.js';
import { loadAgentKeyring } from './agentCrypto.js';
import {
  closeTemporaryConversation, createAgentInvite, createTemporaryConversation, deleteAgentMemory, ensureAgentSettings, ensureMainConversation,
  getAgentAccess, getConversation, isAgentAdmin, listAgentInvites, listAgentMemories, listAgentMessages, monthlyAgentCost, redeemAgentInvite,
  createAgentMemory, dismissAgentProactivePrompt, nextAgentProactivePrompt, recordAgentUsage, saveAgentMessage, updateAgentMemory, updateAgentSettings, updateToolAction
} from './agentStore.js';
import { activateKnowledgeVersion, listKnowledgeChunksMissingEmbeddings, listKnowledgeVersions, publishKnowledgeVersion, retrieveKnowledge, setKnowledgeChunkEmbedding, verifyKnowledgeSignature } from './agentKnowledge.js';
import { ensureClassicKnowledgeSeed } from './classicKnowledgeSeed.js';
import { BailianEmbeddingProvider, BailianSpeechProvider } from './agentProviders.js';
import { AgentModelProviderRegistry } from './agentModelProviders.js';
import { SOURCES, type AgentClientAction, type AgentStreamEvent } from '../shared/types.js';

const apiError = (code: string, message: string, details?: unknown) => ({ error: { code, message, ...(details === undefined ? {} : { details }) } });
const sourceSchema = z.enum(SOURCES);
const compactTrackSchema = z.object({
  id: z.string().min(1).max(700), source: sourceSchema, sourceTrackId: z.string().min(1).max(500), title: z.string().min(1).max(300),
  artist: z.string().max(300).default(''), album: z.string().max(300).default(''), duration: z.number().nonnegative().max(24 * 60 * 60_000),
  coverUrl: z.string().url().nullable().default(null), sourceUrl: z.string().url().nullable().default(null), keyword: z.string().max(300).optional(),
  displayIndex: z.number().int().positive().optional(), quality: z.string().max(60).nullable().optional(), canonicalKey: z.string().max(700).optional()
});
const contextSchema = z.object({
  currentTrack: compactTrackSchema.nullable(), queue: z.array(compactTrackSchema).max(100), playing: z.boolean(),
  currentTime: z.number().nonnegative().max(24 * 60 * 60), volume: z.number().min(0).max(1), playMode: z.enum(['list', 'loop', 'shuffle']),
  mobileSection: z.enum(['daily', 'search', 'player', 'library', 'agent']).optional(), toneTheme: z.string().max(40).optional()
});
const archiveSchema = z.object({
  format: z.literal('zhenqi-agent-archive-plain'), version: z.literal(1), exportedAt: z.string().datetime().optional(),
  settings: z.object({ assistantName: z.string().min(1).max(24), persona: z.enum(['warm', 'bright', 'poetic']), proactiveEnabled: z.boolean(), memoryEnabled: z.boolean(), autoRead: z.boolean(), voice: z.string().max(80) }),
  messages: z.array(z.object({ archiveId: z.string().min(1).max(200), role: z.enum(['user', 'assistant']), content: z.string().max(20_000), createdAt: z.string().datetime().optional() })).max(20_000),
  memories: z.array(z.object({ archiveId: z.string().min(1).max(200), category: z.enum(['preference', 'person', 'event', 'plan', 'context']), content: z.string().min(1).max(2000), confidence: z.number().min(0).max(1), inferred: z.boolean(), expiresAt: z.string().datetime().nullable().optional() })).max(5000)
});
const knowledgeDocumentSchema = z.object({ externalId: z.string().trim().min(1).max(200), title: z.string().trim().min(1).max(300), artist: z.string().max(300).optional(), sourceUrl: z.string().url().nullable().optional(), content: z.string().trim().min(1).max(4000), metadata: z.record(z.string(), z.unknown()).optional() });

function requireAgent(db: Db, keyring: ReturnType<typeof loadAgentKeyring>, request: FastifyRequest, reply: FastifyReply) {
  const user = requireUser(db, request, reply); if (!user) return null;
  const access = getAgentAccess(db, user, keyring);
  if (!access.enabled || !access.entitled || !access.configured) {
    reply.code(access.entitled ? 503 : 403).send(apiError(access.entitled ? 'AGENT_NOT_CONFIGURED' : 'AGENT_INVITE_REQUIRED', access.reason || '珍奇暂不可用。'));
    return null;
  }
  return user;
}

function requireAdmin(db: Db, request: FastifyRequest, reply: FastifyReply) {
  const user = requireUser(db, request, reply); if (!user) return null;
  if (!isAgentAdmin(user.username)) { reply.code(403).send(apiError('AGENT_ADMIN_REQUIRED', '只有站长可以访问珍奇管理页。')); return null; }
  return user;
}

function writeSse(reply: FastifyReply, event: AgentStreamEvent) {
  reply.raw.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
}

export function registerAgentRoutes(app: FastifyInstance, db: Db) {
  const keyring = loadAgentKeyring(); const modelProviders = new AgentModelProviderRegistry(); const runtime = new AgentRuntime(db, keyring, modelProviders);
  const speechProvider = new BailianSpeechProvider(); const knowledgeEmbeddingProvider = new BailianEmbeddingProvider();
  ensureClassicKnowledgeSeed(db);

  app.get('/api/agent/access', async (request, reply) => {
    const user = requireUser(db, request, reply); if (!user) return;
    return { access: getAgentAccess(db, user, keyring), settings: ensureAgentSettings(db, user.id) };
  });

  app.patch('/api/agent/settings', async (request, reply) => {
    const user = requireAgent(db, keyring, request, reply); if (!user) return;
    const body = z.object({
      assistantName: z.string().trim().min(1).max(24).optional(), persona: z.enum(['warm', 'bright', 'poetic']).optional(),
      proactiveEnabled: z.boolean().optional(), memoryEnabled: z.boolean().optional(), autoRead: z.boolean().optional(), voice: z.string().min(1).max(80).optional()
    }).parse(request.body);
    return { settings: updateAgentSettings(db, user.id, body) };
  });

  app.get('/api/agent/proactive', async (request, reply) => {
    const user = requireAgent(db, keyring, request, reply); if (!user) return;
    return { prompt: nextAgentProactivePrompt(db, user.id) };
  });

  app.post('/api/agent/proactive/:id/dismiss', async (request, reply) => {
    const user = requireAgent(db, keyring, request, reply); if (!user) return;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params); dismissAgentProactivePrompt(db, user.id, id); return { ok: true };
  });

  app.get('/api/agent/conversations/main', async (request, reply) => {
    const user = requireAgent(db, keyring, request, reply); if (!user) return;
    const conversation = ensureMainConversation(db, user.id);
    return { conversation, messages: listAgentMessages(db, keyring, user.id, conversation.id, 100) };
  });

  app.post('/api/agent/conversations/temporary', async (request, reply) => {
    const user = requireAgent(db, keyring, request, reply); if (!user) return;
    return reply.code(201).send({ conversation: createTemporaryConversation(db, user.id), messages: [] });
  });

  app.get('/api/agent/conversations/:id/messages', async (request, reply) => {
    const user = requireAgent(db, keyring, request, reply); if (!user) return;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params); const conversation = getConversation(db, user.id, id);
    if (!conversation) return reply.code(404).send(apiError('AGENT_CONVERSATION_NOT_FOUND', '这段对话不存在或已经删除。'));
    return { conversation, messages: listAgentMessages(db, keyring, user.id, id, 100) };
  });

  app.delete('/api/agent/conversations/:id', async (request, reply) => {
    const user = requireAgent(db, keyring, request, reply); if (!user) return;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    if (!closeTemporaryConversation(db, user.id, id)) return reply.code(400).send(apiError('AGENT_MAIN_CONVERSATION_PROTECTED', '主对话不能通过临时对话接口删除。'));
    return { ok: true };
  });

  app.post('/api/agent/messages', async (request, reply) => {
    const user = requireAgent(db, keyring, request, reply); if (!user) return;
    const limited = consumeRateLimits(db, [{ scope: 'agent:user', identifier: user.id, limit: 6, windowMs: 60_000 }]); applyRateLimitHeaders(reply, limited);
    if (!limited.allowed) return reply.code(429).send(apiError('AGENT_RATE_LIMITED', '说得有点快，让珍奇先跟上你。', { retryAfterSeconds: limited.retryAfterSeconds }));
    const body = z.object({
      conversationId: z.string().uuid(), message: z.string().trim().min(1).max(4000), generation: z.number().int().positive().max(2_000_000_000),
      webSearch: z.boolean().default(false), context: contextSchema
    }).parse(request.body);
    const conversation = getConversation(db, user.id, body.conversationId);
    if (!conversation || conversation.status !== 'active') return reply.code(404).send(apiError('AGENT_CONVERSATION_NOT_FOUND', '这段对话不存在或已关闭。'));
    if (conversation.expiresAt && Date.parse(conversation.expiresAt) <= Date.now()) return reply.code(410).send(apiError('AGENT_CONVERSATION_EXPIRED', '临时对话已过期并删除。'));
    reply.hijack();
    reply.raw.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' });
    const controller = new AbortController(); request.raw.once('close', () => controller.abort());
    try {
      for await (const event of runtime.run({
        user, conversationId: conversation.id, conversationKind: conversation.kind, message: body.message, generation: body.generation,
        webSearch: body.webSearch, context: body.context, signal: controller.signal
      })) writeSse(reply, event);
    } finally { if (!reply.raw.writableEnded) reply.raw.end(); }
  });

  app.post('/api/agent/actions/:id/result', async (request, reply) => {
    const user = requireAgent(db, keyring, request, reply); if (!user) return;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z.object({ ok: z.boolean(), message: z.string().max(300).optional(), details: z.unknown().optional() }).parse(request.body);
    const action = updateToolAction(db, user.id, id, body.ok ? 'executed' : 'failed', body, ['proposed', 'approved']);
    if (!action) return reply.code(404).send(apiError('AGENT_ACTION_NOT_FOUND', '操作已过期或不属于当前用户。'));
    return { ok: true };
  });

  app.post('/api/agent/actions/:id/confirm', async (request, reply) => {
    const user = requireAgent(db, keyring, request, reply); if (!user) return;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const action = updateToolAction(db, user.id, id, 'approved', undefined, ['proposed']);
    if (!action) return reply.code(404).send(apiError('AGENT_ACTION_NOT_FOUND', '操作已过期或不属于当前用户。'));
    if (action.risk !== 'confirm') return reply.code(409).send(apiError('AGENT_ACTION_NOT_CONFIRMABLE', '这项操作不需要确认或已处理。'));
    const input = action.input as Record<string, unknown>;
    if (action.toolName === 'draft_playlist') {
      const parsed = z.object({ name: z.string().trim().min(1).max(60), description: z.string().max(500).default(''), trackIds: z.array(z.string().min(1)).max(2000) }).parse(input);
      const playlist = transaction(db, () => {
        const created = createLocalPlaylist(db, user.id, parsed.name, parsed.description); const stamp = new Date().toISOString();
        const insert = db.prepare("INSERT OR IGNORE INTO playlist_items(playlist_id,track_id,position,origin,excluded,created_at) SELECT ?,id,?,'local',0,? FROM tracks WHERE id=?");
        parsed.trackIds.forEach((trackId, index) => insert.run(created.id, index, stamp, trackId)); return created;
      });
      updateToolAction(db, user.id, id, 'executed', { playlistId: playlist.id }, ['approved']);
      return { ok: true, message: `已创建歌单“${playlist.name}”`, playlist };
    }
    if (action.toolName === 'maintain_music_house') {
      const parsed = z.object({ operation: z.enum(['clear_client_cache', 'regenerate_daily', 'sync_playlist']), targetId: z.string().max(200).optional() }).passthrough().parse(input);
      if (parsed.operation === 'clear_client_cache') return { ok: true, message: '请在当前设备清理播放缓存。', clientAction: { type: 'clear_client_cache' } satisfies AgentClientAction };
      if (parsed.operation === 'regenerate_daily') {
        const today = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10); startDailyGeneration(db, user.id, today);
        updateToolAction(db, user.id, id, 'executed', { date: today }, ['approved']); return { ok: true, message: '已开始重新生成今日推荐。' };
      }
      if (!parsed.targetId) return reply.code(400).send(apiError('AGENT_TARGET_REQUIRED', '请指定要同步的歌单。'));
      const job = createSyncJob(db, user.id, parsed.targetId); if (!job) return reply.code(404).send(apiError('AGENT_PLAYLIST_NOT_SYNCABLE', '该歌单不存在或不是导入歌单。'));
      void runImportJob(db, job.id); updateToolAction(db, user.id, id, 'executed', { jobId: job.id }, ['approved']); return { ok: true, message: '已开始同步歌单。', job };
    }
    return reply.code(400).send(apiError('AGENT_ACTION_UNSUPPORTED', '这项确认操作尚未开放。'));
  });

  app.post('/api/agent/actions/:id/cancel', async (request, reply) => {
    const user = requireAgent(db, keyring, request, reply); if (!user) return;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    if (!updateToolAction(db, user.id, id, 'cancelled', undefined, ['proposed'])) return reply.code(404).send(apiError('AGENT_ACTION_NOT_FOUND', '操作已过期或不属于当前用户。'));
    return { ok: true };
  });

  app.get('/api/agent/memories', async (request, reply) => {
    const user = requireAgent(db, keyring, request, reply); if (!user) return;
    return { memories: listAgentMemories(db, keyring, user.id) };
  });

  app.patch('/api/agent/memories/:id', async (request, reply) => {
    const user = requireAgent(db, keyring, request, reply); if (!user) return;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params); const { content } = z.object({ content: z.string().trim().min(1).max(1000) }).parse(request.body);
    const memory = updateAgentMemory(db, keyring, user.id, id, content);
    if (!memory) return reply.code(404).send(apiError('AGENT_MEMORY_NOT_FOUND', '这条记忆已经不存在。'));
    return { memory };
  });

  app.delete('/api/agent/memories/:id', async (request, reply) => {
    const user = requireAgent(db, keyring, request, reply); if (!user) return;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params); deleteAgentMemory(db, user.id, id); return { ok: true };
  });
  app.delete('/api/agent/memories', async (request, reply) => { const user = requireAgent(db, keyring, request, reply); if (!user) return; return { ok: true, deleted: deleteAgentMemory(db, user.id) }; });

  app.get('/api/agent/archive/export', async (request, reply) => {
    const user = requireAgent(db, keyring, request, reply); if (!user) return;
    const conversation = ensureMainConversation(db, user.id); const messages = listAgentMessages(db, keyring, user.id, conversation.id, 20_000);
    return {
      format: 'zhenqi-agent-archive-plain', version: 1, exportedAt: new Date().toISOString(), settings: ensureAgentSettings(db, user.id),
      messages: messages.filter(item => item.role === 'user' || item.role === 'assistant').map(item => ({ archiveId: item.id, role: item.role, content: item.content, createdAt: item.createdAt })),
      memories: listAgentMemories(db, keyring, user.id, 500).map(item => ({ archiveId: item.id, category: item.category, content: item.content, confidence: item.confidence, inferred: item.inferred, expiresAt: item.expiresAt }))
    };
  });

  app.post('/api/agent/archive/restore', async (request, reply) => {
    const user = requireAgent(db, keyring, request, reply); if (!user) return; const archive = archiveSchema.parse(request.body); const conversation = ensureMainConversation(db, user.id); let messages = 0; let memories = 0;
    transaction(db, () => {
      updateAgentSettings(db, user.id, archive.settings);
      for (const item of archive.messages) {
        if (db.prepare('SELECT 1 FROM agent_messages WHERE id=? AND user_id=?').get(item.archiveId, user.id)) continue;
        if (db.prepare("SELECT 1 FROM agent_archive_records WHERE user_id=? AND archive_record_id=? AND record_type='message'").get(user.id, item.archiveId)) continue;
        const saved = saveAgentMessage(db, keyring, user.id, conversation.id, item.role, item.content, { restored: true, originalCreatedAt: item.createdAt });
        db.prepare("INSERT INTO agent_archive_records(user_id,archive_record_id,record_type,local_record_id,imported_at) VALUES(?,?,'message',?,?)").run(user.id, item.archiveId, saved.id, new Date().toISOString()); messages += 1;
      }
      for (const item of archive.memories) {
        if (db.prepare('SELECT 1 FROM agent_memories WHERE id=? AND user_id=?').get(item.archiveId, user.id)) continue;
        if (db.prepare("SELECT 1 FROM agent_archive_records WHERE user_id=? AND archive_record_id=? AND record_type='memory'").get(user.id, item.archiveId)) continue;
        const saved = createAgentMemory(db, keyring, user.id, { category: item.category, content: item.content, confidence: item.confidence, inferred: item.inferred, expiresAt: item.expiresAt || null });
        db.prepare("INSERT INTO agent_archive_records(user_id,archive_record_id,record_type,local_record_id,imported_at) VALUES(?,?,'memory',?,?)").run(user.id, item.archiveId, saved.id, new Date().toISOString()); memories += 1;
      }
    });
    return { ok: true, merged: { messages, memories } };
  });

  app.post('/api/agent/voice/transcribe', async (request, reply) => {
    const user = requireAgent(db, keyring, request, reply); if (!user) return;
    const budget = Number(process.env.AGENT_MONTHLY_BUDGET_CNY || 150); if (monthlyAgentCost(db) >= budget) return reply.code(503).send(apiError('AGENT_BUDGET_EXHAUSTED', '本月珍奇语音额度已暂停，文字和音乐功能仍可使用。'));
    if (!speechProvider.configured()) return reply.code(503).send(apiError('AGENT_SPEECH_NOT_CONFIGURED', '语音识别尚未配置。'));
    const body = z.object({ audioBase64: z.string().min(16).max(14_000_000).regex(/^[a-zA-Z0-9+/=]+$/), mimeType: z.enum(['audio/webm', 'audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/ogg']), durationSeconds: z.number().positive().max(60) }).parse(request.body);
    const bytes = Buffer.from(body.audioBase64, 'base64'); if (!bytes.length || bytes.length > 10 * 1024 * 1024) return reply.code(413).send(apiError('AGENT_AUDIO_TOO_LARGE', '单段录音不能超过 10MB。'));
    try { const text = await speechProvider.transcribe({ base64: bytes.toString('base64'), mimeType: body.mimeType }); recordAgentUsage(db, { userId: user.id, provider: 'bailian-asr', model: speechProvider.config.asrModel, asrSeconds: body.durationSeconds }); return { text }; }
    catch { return reply.code(502).send(apiError('AGENT_ASR_FAILED', '这段录音没有识别成功，原始录音已丢弃。')); }
  });

  app.post('/api/agent/voice/synthesize', async (request, reply) => {
    const user = requireAgent(db, keyring, request, reply); if (!user) return;
    const budget = Number(process.env.AGENT_MONTHLY_BUDGET_CNY || 150); if (monthlyAgentCost(db) >= budget) return reply.code(503).send(apiError('AGENT_BUDGET_EXHAUSTED', '本月珍奇语音额度已暂停。'));
    if (!speechProvider.configured()) return reply.code(503).send(apiError('AGENT_SPEECH_NOT_CONFIGURED', '语音合成尚未配置。'));
    const body = z.object({ text: z.string().trim().min(1).max(1500), voice: z.enum(['Cherry', 'Serena', 'Ethan', 'Chelsie']).default('Cherry'), persona: z.enum(['warm', 'bright', 'poetic']).default('warm') }).parse(request.body);
    const instructions = body.persona === 'bright' ? '轻快、有活力、带着真诚笑意，但不要夸张。' : body.persona === 'poetic' ? '语速舒缓、克制、有轻微画面感，不要矫饰。' : '自然、温暖、机灵，像熟悉的朋友一样表达。';
    try { const result = await speechProvider.synthesize({ text: body.text, voice: body.voice, instructions }); recordAgentUsage(db, { userId: user.id, provider: 'bailian-tts', model: speechProvider.config.ttsModel, ttsCharacters: body.text.length }); reply.header('content-type', result.contentType); reply.header('cache-control', 'private, no-store'); return reply.send(result.audio); }
    catch { return reply.code(502).send(apiError('AGENT_TTS_FAILED', '语音回复暂时生成失败，可以继续阅读文字。')); }
  });

  app.post('/api/agent/invites/redeem', async (request, reply) => {
    const user = requireUser(db, request, reply); if (!user) return;
    const { code } = z.object({ code: z.string().trim().min(6).max(128) }).parse(request.body);
    if (!redeemAgentInvite(db, user.id, code)) return reply.code(403).send(apiError('AGENT_INVITE_INVALID', '邀请码无效、已过期或已用完。'));
    return { ok: true, access: getAgentAccess(db, user, keyring) };
  });

  app.get('/api/admin/agent/invites', async (request, reply) => { if (!requireAdmin(db, request, reply)) return; return { invites: listAgentInvites(db) }; });
  app.post('/api/admin/agent/invites', async (request, reply) => {
    const user = requireAdmin(db, request, reply); if (!user) return;
    const body = z.object({ maxUses: z.number().int().min(1).max(100).default(1), expiresInDays: z.number().int().min(1).max(365).default(30), note: z.string().max(200).default('') }).parse(request.body);
    return reply.code(201).send({ invite: createAgentInvite(db, user.id, body) });
  });
  app.patch('/api/admin/agent/invites/:id', async (request, reply) => {
    if (!requireAdmin(db, request, reply)) return;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params); const { disabled } = z.object({ disabled: z.boolean() }).parse(request.body);
    db.prepare('UPDATE agent_invites SET disabled=? WHERE id=?').run(Number(disabled), id); return { ok: true };
  });
  app.get('/api/admin/agent/usage', async (request, reply) => {
    if (!requireAdmin(db, request, reply)) return;
    const rows = db.prepare(`SELECT usage_date,provider,model,SUM(input_tokens) input_tokens,SUM(output_tokens) output_tokens,SUM(search_calls) search_calls,SUM(asr_seconds) asr_seconds,SUM(tts_characters) tts_characters,SUM(estimated_cost_cny) estimated_cost_cny FROM agent_usage_daily GROUP BY usage_date,provider,model ORDER BY usage_date DESC`).all();
    return { monthlyCostCny: monthlyAgentCost(db), budgetCny: Number(process.env.AGENT_MONTHLY_BUDGET_CNY || 150), rows };
  });

  app.get('/api/admin/agent/providers', async (request, reply) => {
    if (!requireAdmin(db, request, reply)) return;
    return runtime.providerStatus();
  });

  app.get('/api/admin/agent/knowledge', async (request, reply) => {
    if (!requireAdmin(db, request, reply)) return;
    const { q } = z.object({ q: z.string().trim().max(160).default('') }).parse(request.query || {});
    return { versions: listKnowledgeVersions(db), sample: retrieveKnowledge(db, q, 8), embeddingConfigured: knowledgeEmbeddingProvider.configured() };
  });
  app.post('/api/admin/agent/knowledge/publish', async (request, reply) => {
    const body = z.object({ kind: z.enum(['classic', 'douyin']), source: z.string().trim().min(1).max(120), collectedAt: z.string().datetime(), documents: z.array(knowledgeDocumentSchema).min(1).max(1000), checksum: z.string().regex(/^[a-f\d]{64}$/i).optional() }).parse(request.body);
    const rawBody = JSON.stringify(body); const timestamp = String(request.headers['x-zhenqi-timestamp'] || ''); const nonce = String(request.headers['x-zhenqi-nonce'] || ''); const signature = String(request.headers['x-zhenqi-signature'] || ''); const secret = process.env.KNOWLEDGE_PUBLISH_HMAC_KEY || '';
    if (!verifyKnowledgeSignature(rawBody, { timestamp, nonce, signature }, secret)) return reply.code(401).send(apiError('KNOWLEDGE_SIGNATURE_INVALID', '知识发布签名无效或已过期。'));
    if (db.prepare('SELECT 1 FROM knowledge_publish_nonces WHERE nonce=?').get(nonce)) return reply.code(409).send(apiError('KNOWLEDGE_REPLAY_REJECTED', '该知识发布请求已经处理过。'));
    const computed = createHash('sha256').update(JSON.stringify(body.documents.map(item => ({ ...item, metadata: item.metadata || {} })))).digest('hex');
    if (body.checksum && body.checksum !== computed) return reply.code(400).send(apiError('KNOWLEDGE_CHECKSUM_MISMATCH', '知识内容校验失败。'));
    db.prepare('INSERT INTO knowledge_publish_nonces(nonce,used_at) VALUES(?,?)').run(nonce, new Date().toISOString());
    try { return reply.code(201).send({ version: publishKnowledgeVersion(db, { ...body, checksum: computed }) }); }
    catch (error) { return reply.code(400).send(apiError('KNOWLEDGE_VALIDATION_FAILED', error instanceof Error ? error.message : '知识版本校验失败。')); }
  });
  app.post('/api/admin/agent/knowledge/:id/activate', async (request, reply) => {
    if (!requireAdmin(db, request, reply)) return; const { id } = z.object({ id: z.string().uuid() }).parse(request.params); const version = activateKnowledgeVersion(db, id); if (!version) return reply.code(404).send(apiError('KNOWLEDGE_VERSION_NOT_FOUND', '知识版本不存在。')); return { version };
  });
  app.post('/api/admin/agent/knowledge/:id/embeddings', async (request, reply) => {
    if (!requireAdmin(db, request, reply)) return;
    if (!knowledgeEmbeddingProvider.configured()) return reply.code(503).send(apiError('AGENT_EMBEDDING_NOT_CONFIGURED', '向量服务尚未配置；全文检索仍可正常使用。'));
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params); const { limit } = z.object({ limit: z.number().int().min(1).max(100).default(20) }).parse(request.body || {});
    if (!db.prepare('SELECT 1 FROM knowledge_versions WHERE id=?').get(id)) return reply.code(404).send(apiError('KNOWLEDGE_VERSION_NOT_FOUND', '知识版本不存在。'));
    const chunks = listKnowledgeChunksMissingEmbeddings(db, id, limit); let completed = 0; const failures: string[] = [];
    for (const chunk of chunks) {
      try { const embedding = await knowledgeEmbeddingProvider.embed(`${chunk.title} ${chunk.artist} ${chunk.content}`); setKnowledgeChunkEmbedding(db, chunk.id, embedding); completed += 1; }
      catch { failures.push(chunk.id); }
    }
    return { completed, failed: failures.length, failures, remaining: listKnowledgeChunksMissingEmbeddings(db, id, 1).length > 0 };
  });
}
