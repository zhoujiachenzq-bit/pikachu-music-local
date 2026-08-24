import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Db } from './db.js';
import type { AgentAccess, AgentConversation, AgentMemory, AgentMessage, AgentPersona, AgentSettings, AgentToolRisk } from '../shared/types.js';
import { decryptAgentText, encryptAgentText, type AgentKeyring } from './agentCrypto.js';
import { agentMemoryKey, memoryRelevanceScore, normalizeMemoryText, type AgentMemoryCandidate } from './agentMemory.js';

const now = () => new Date().toISOString();
const bool = (value: unknown) => Boolean(Number(value));

export function agentAdmins(env: NodeJS.ProcessEnv = process.env): Set<string> {
  return new Set((env.AGENT_ADMIN_USERNAMES || '').split(',').map(value => value.trim().toLocaleLowerCase()).filter(Boolean));
}

export function isAgentAdmin(username: string, env: NodeJS.ProcessEnv = process.env): boolean {
  return agentAdmins(env).has(username.toLocaleLowerCase());
}

export function isAgentEntitled(db: Db, userId: string, username: string, env: NodeJS.ProcessEnv = process.env): boolean {
  if (isAgentAdmin(username, env)) return true;
  return Boolean(db.prepare('SELECT 1 FROM agent_entitlements WHERE user_id=? AND (expires_at IS NULL OR expires_at>?)').get(userId, now()));
}

export function getAgentAccess(db: Db, user: { id: string; username: string }, keyring: AgentKeyring, env: NodeJS.ProcessEnv = process.env): AgentAccess {
  const enabled = env.AGENT_ENABLED !== 'false';
  const admin = isAgentAdmin(user.username, env);
  const entitled = isAgentEntitled(db, user.id, user.username, env);
  const cryptoConfigured = keyring.keys.has(keyring.primary);
  // The deterministic local assistant remains available without a model provider.
  // "configured" only gates the encryption boundary that protects user conversations.
  const configured = cryptoConfigured;
  return {
    enabled, entitled, admin, configured,
    ...(!enabled ? { reason: '珍奇当前未启用。' } : !entitled ? { reason: '需要邀请码才能唤醒珍奇。' } : !configured ? { reason: '珍奇的服务密钥尚未配置。' } : {})
  };
}

export function ensureAgentSettings(db: Db, userId: string): AgentSettings {
  const stamp = now();
  db.prepare(`INSERT OR IGNORE INTO agent_settings(user_id,created_at,updated_at) VALUES(?,?,?)`).run(userId, stamp, stamp);
  const row = db.prepare('SELECT * FROM agent_settings WHERE user_id=?').get(userId) as Record<string, unknown>;
  return {
    assistantName: String(row.assistant_name), persona: row.persona as AgentPersona,
    proactiveEnabled: bool(row.proactive_enabled), memoryEnabled: bool(row.memory_enabled), autoRead: bool(row.auto_read), voice: String(row.voice)
  };
}

export function updateAgentSettings(db: Db, userId: string, settings: Partial<AgentSettings>): AgentSettings {
  ensureAgentSettings(db, userId);
  const current = ensureAgentSettings(db, userId); const next = { ...current, ...settings };
  db.prepare(`UPDATE agent_settings SET assistant_name=?,persona=?,proactive_enabled=?,memory_enabled=?,auto_read=?,voice=?,updated_at=? WHERE user_id=?`)
    .run(next.assistantName, next.persona, Number(next.proactiveEnabled), Number(next.memoryEnabled), Number(next.autoRead), next.voice, now(), userId);
  return next;
}

export type AgentProactiveKind = 'reunion' | 'skip_pattern' | 'recommendation_shift' | 'source_help';
export interface AgentProactivePrompt { id: string; kind: AgentProactiveKind; message: string; suggestedPrompt: string; }

const proactiveKindCooldownMs: Record<AgentProactiveKind, number> = {
  skip_pattern: 24 * 60 * 60_000,
  recommendation_shift: 3 * 24 * 60 * 60_000,
  source_help: 3 * 24 * 60 * 60_000,
  reunion: 14 * 24 * 60 * 60_000
};

export function nextAgentProactivePrompt(db: Db, userId: string, at = new Date()): AgentProactivePrompt | null {
  const settings = ensureAgentSettings(db, userId); if (!settings.proactiveEnabled) return null;
  const sinceDay = new Date(at.getTime() - 24 * 60 * 60_000).toISOString(); const sinceCooldown = new Date(at.getTime() - 6 * 60 * 60_000).toISOString();
  const daily = db.prepare('SELECT COUNT(*) count,MAX(shown_at) latest FROM agent_proactive_events WHERE user_id=? AND shown_at>=?').get(userId, sinceDay) as { count: number; latest: string | null };
  if (Number(daily.count) >= 2 || (daily.latest && daily.latest >= sinceCooldown)) return null;
  const recentSkip = db.prepare(`SELECT COUNT(*) count FROM listening_sessions WHERE user_id=? AND skipped=1 AND updated_at>=?`).get(userId, new Date(at.getTime() - 2 * 60 * 60_000).toISOString()) as { count: number };
  const latestListen = db.prepare('SELECT MAX(updated_at) latest FROM listening_sessions WHERE user_id=?').get(userId) as { latest: string | null };
  const recentSourceFailures = db.prepare('SELECT COUNT(*) count FROM listening_sessions WHERE user_id=? AND error_code IS NOT NULL AND updated_at>=?').get(userId, sinceDay) as { count: number };
  const unhealthy = db.prepare('SELECT COUNT(*) count FROM source_health WHERE circuit_open_until>? OR consecutive_failures>=3').get(at.toISOString()) as { count: number };
  const recentRecommendations = db.prepare(`SELECT rr.id,SUM(CASE WHEN ri.kind='explore' THEN 1 ELSE 0 END) explore,COUNT(ri.track_id) total
    FROM recommendation_runs rr JOIN recommendation_items ri ON ri.run_id=rr.id WHERE rr.user_id=? AND rr.status='completed'
    GROUP BY rr.id,rr.recommendation_date ORDER BY rr.recommendation_date DESC LIMIT 2`).all(userId) as Array<{ id: string; explore: number; total: number }>;
  const recommendationShift = recentRecommendations.length === 2 && recentRecommendations.every(row => Number(row.total) >= 5)
    ? Math.abs(Number(recentRecommendations[0].explore) / Number(recentRecommendations[0].total) - Number(recentRecommendations[1].explore) / Number(recentRecommendations[1].total)) >= .35
    : false;
  let candidate: Omit<AgentProactivePrompt, 'id'> | null = null;
  if (Number(recentSkip.count) >= 3) candidate = { kind: 'skip_pattern', message: '连续几首都没对上感觉。要不要让我换一种方向？', suggestedPrompt: '结合我刚才连续跳过的歌，换一种风格推荐五首' };
  else if (recommendationShift) candidate = { kind: 'recommendation_shift', message: '今天的推荐比上一次更偏探索。要不要让我解释变化，或者调回熟悉一点？', suggestedPrompt: '解释今天推荐为什么变化，并给我熟悉与探索各三首' };
  else if (latestListen.latest && Date.parse(latestListen.latest) < at.getTime() - 7 * 24 * 60 * 60_000) candidate = { kind: 'reunion', message: '好久不见。要不要从一首熟悉但很久没听的歌开始？', suggestedPrompt: '从我很久没听的收藏里挑五首，先不要保存歌单' };
  else if (Number(recentSourceFailures.count) >= 2 && Number(unhealthy.count) > 0) candidate = { kind: 'source_help', message: '你最近遇到过几次播放失败。珍奇可以检查脱敏后的音源状态，不会读取敏感日志。', suggestedPrompt: '检查最近的音源健康并告诉我是否需要处理' };
  if (!candidate) return null;
  const kindSince = new Date(at.getTime() - proactiveKindCooldownMs[candidate.kind]).toISOString();
  const duplicate = db.prepare('SELECT 1 FROM agent_proactive_events WHERE user_id=? AND kind=? AND shown_at>=?').get(userId, candidate.kind, kindSince); if (duplicate) return null;
  const id = randomUUID(); db.prepare('INSERT INTO agent_proactive_events(id,user_id,kind,shown_at) VALUES(?,?,?,?)').run(id, userId, candidate.kind, at.toISOString()); return { id, ...candidate };
}

export function dismissAgentProactivePrompt(db: Db, userId: string, id: string): boolean {
  return Number(db.prepare('UPDATE agent_proactive_events SET dismissed_at=? WHERE id=? AND user_id=? AND dismissed_at IS NULL').run(now(), id, userId).changes) > 0;
}

function conversationFromRow(row: Record<string, unknown>): AgentConversation {
  return {
    id: String(row.id), kind: row.kind as AgentConversation['kind'], status: row.status as AgentConversation['status'],
    createdAt: String(row.created_at), updatedAt: String(row.updated_at), expiresAt: row.expires_at ? String(row.expires_at) : null
  };
}

export function ensureMainConversation(db: Db, userId: string): AgentConversation {
  const existing = db.prepare("SELECT * FROM agent_conversations WHERE user_id=? AND kind='main' AND status='active'").get(userId) as Record<string, unknown> | undefined;
  if (existing) return conversationFromRow(existing);
  const id = randomUUID(); const stamp = now();
  db.prepare("INSERT INTO agent_conversations(id,user_id,kind,status,created_at,updated_at) VALUES(?,?,'main','active',?,?)").run(id, userId, stamp, stamp);
  return { id, kind: 'main', status: 'active', createdAt: stamp, updatedAt: stamp, expiresAt: null };
}

export function createTemporaryConversation(db: Db, userId: string): AgentConversation {
  const id = randomUUID(); const stamp = now(); const expiresAt = new Date(Date.now() + 24 * 60 * 60_000).toISOString();
  db.prepare("INSERT INTO agent_conversations(id,user_id,kind,status,created_at,updated_at,expires_at) VALUES(?,?,'temporary','active',?,?,?)").run(id, userId, stamp, stamp, expiresAt);
  return { id, kind: 'temporary', status: 'active', createdAt: stamp, updatedAt: stamp, expiresAt };
}

export function getConversation(db: Db, userId: string, conversationId: string): AgentConversation | null {
  const row = db.prepare('SELECT * FROM agent_conversations WHERE id=? AND user_id=?').get(conversationId, userId) as Record<string, unknown> | undefined;
  return row ? conversationFromRow(row) : null;
}

export function closeTemporaryConversation(db: Db, userId: string, conversationId: string): boolean {
  const result = db.prepare("DELETE FROM agent_conversations WHERE id=? AND user_id=? AND kind='temporary'").run(conversationId, userId);
  return Number(result.changes) > 0;
}

export function saveAgentMessage(db: Db, keyring: AgentKeyring, userId: string, conversationId: string, role: AgentMessage['role'], content: string, metadata: Record<string, unknown> = {}): AgentMessage {
  const id = randomUUID(); const stamp = now(); const encrypted = encryptAgentText(keyring, userId, 'message', id, content); const encryptedMetadata = encryptAgentText(keyring, userId, 'message-metadata', id, JSON.stringify(metadata));
  db.prepare(`INSERT INTO agent_messages(id,conversation_id,user_id,role,content_ciphertext,key_version,metadata_json,created_at) VALUES(?,?,?,?,?,?,?,?)`)
    .run(id, conversationId, userId, role, encrypted.ciphertext, encrypted.keyVersion, JSON.stringify({ encrypted: true, ciphertext: encryptedMetadata.ciphertext, keyVersion: encryptedMetadata.keyVersion }), stamp);
  db.prepare('UPDATE agent_conversations SET updated_at=? WHERE id=? AND user_id=?').run(stamp, conversationId, userId);
  return { id, conversationId, role, content, metadata, createdAt: stamp };
}

export function listAgentMessages(db: Db, keyring: AgentKeyring, userId: string, conversationId: string, limit = 80): AgentMessage[] {
  const rows = db.prepare(`SELECT * FROM (SELECT * FROM agent_messages WHERE user_id=? AND conversation_id=? ORDER BY created_at DESC LIMIT ?) ORDER BY created_at`)
    .all(userId, conversationId, Math.max(1, Math.min(20_000, limit))) as Record<string, unknown>[];
  return rows.map(row => {
    const id = String(row.id); const storedMetadata = JSON.parse(String(row.metadata_json || '{}')) as Record<string, unknown>; let metadata = storedMetadata;
    if (storedMetadata.encrypted === true && typeof storedMetadata.ciphertext === 'string' && typeof storedMetadata.keyVersion === 'string') {
      try { metadata = JSON.parse(decryptAgentText(keyring, userId, 'message-metadata', id, storedMetadata.ciphertext, storedMetadata.keyVersion)) as Record<string, unknown>; }
      catch { metadata = {}; }
    }
    return {
      id, conversationId: String(row.conversation_id), role: row.role as AgentMessage['role'],
      content: decryptAgentText(keyring, userId, 'message', id, String(row.content_ciphertext), String(row.key_version)), metadata, createdAt: String(row.created_at)
    };
  });
}

function memoryFromRow(row: Record<string, unknown>, keyring: AgentKeyring, userId: string): AgentMemory {
  return {
    id: String(row.id), category: row.category as AgentMemory['category'],
    content: decryptAgentText(keyring, userId, 'memory', String(row.id), String(row.content_ciphertext), String(row.key_version)),
    confidence: Number(row.confidence), inferred: bool(row.inferred), expiresAt: row.expires_at ? String(row.expires_at) : null,
    createdAt: String(row.created_at), updatedAt: String(row.updated_at)
  };
}

export function listAgentMemories(db: Db, keyring: AgentKeyring, userId: string, limit = 200): AgentMemory[] {
  const rows = db.prepare('SELECT * FROM agent_memories WHERE user_id=? AND (expires_at IS NULL OR expires_at>?) ORDER BY updated_at DESC LIMIT ?')
    .all(userId, now(), Math.max(1, Math.min(500, limit))) as Record<string, unknown>[];
  return rows.map(row => memoryFromRow(row, keyring, userId));
}

export function createAgentMemory(db: Db, keyring: AgentKeyring, userId: string, input: Pick<AgentMemory, 'category' | 'content' | 'confidence' | 'inferred'> & { sourceMessageId?: string; expiresAt?: string | null }): AgentMemory {
  const id = randomUUID(); const stamp = now(); const encrypted = encryptAgentText(keyring, userId, 'memory', id, input.content.trim());
  db.prepare(`INSERT INTO agent_memories(id,user_id,category,content_ciphertext,key_version,confidence,inferred,source_message_id,expires_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, userId, input.category, encrypted.ciphertext, encrypted.keyVersion, input.confidence, Number(input.inferred), input.sourceMessageId || null, input.expiresAt || null, stamp, stamp);
  return { id, category: input.category, content: input.content.trim(), confidence: input.confidence, inferred: input.inferred, expiresAt: input.expiresAt || null, createdAt: stamp, updatedAt: stamp };
}

export function rememberAgentMemory(db: Db, keyring: AgentKeyring, userId: string, input: AgentMemoryCandidate & { sourceMessageId?: string }): { memory: AgentMemory; change: 'created' | 'updated' | 'refreshed' | 'ignored' } {
  const current = listAgentMemories(db, keyring, userId, 500); const key = agentMemoryKey(input);
  const matched = current.find(memory => agentMemoryKey(memory) === key);
  if (!matched) return { memory: createAgentMemory(db, keyring, userId, { ...input, sourceMessageId: input.sourceMessageId }), change: 'created' };
  const same = normalizeMemoryText(matched.content) === normalizeMemoryText(input.content);
  if (!same && input.inferred && !matched.inferred) return { memory: matched, change: 'ignored' };
  if (same && input.inferred && matched.inferred && input.confidence <= matched.confidence) return { memory: matched, change: 'ignored' };
  const stamp = now(); const confidence = Math.max(matched.confidence, input.confidence);
  if (same) db.prepare('UPDATE agent_memories SET confidence=?,inferred=?,source_message_id=?,expires_at=?,updated_at=? WHERE id=? AND user_id=?')
    .run(confidence, Number(input.inferred), input.sourceMessageId || null, input.expiresAt || null, stamp, matched.id, userId);
  else {
    const encrypted = encryptAgentText(keyring, userId, 'memory', matched.id, input.content.trim());
    db.prepare(`UPDATE agent_memories SET category=?,content_ciphertext=?,embedding_ciphertext=NULL,embedding_key_version=NULL,key_version=?,confidence=?,inferred=?,source_message_id=?,expires_at=?,updated_at=? WHERE id=? AND user_id=?`)
      .run(input.category, encrypted.ciphertext, encrypted.keyVersion, confidence, Number(input.inferred), input.sourceMessageId || null, input.expiresAt || null, stamp, matched.id, userId);
  }
  return {
    memory: { ...matched, category: input.category, content: input.content.trim(), confidence, inferred: input.inferred, expiresAt: input.expiresAt || null, updatedAt: stamp },
    change: same ? 'refreshed' : 'updated'
  };
}

export function updateAgentMemory(db: Db, keyring: AgentKeyring, userId: string, id: string, content: string): AgentMemory | null {
  const row = db.prepare('SELECT * FROM agent_memories WHERE id=? AND user_id=?').get(id, userId) as Record<string, unknown> | undefined;
  if (!row) return null;
  const encrypted = encryptAgentText(keyring, userId, 'memory', id, content.trim()); const stamp = now();
  db.prepare('UPDATE agent_memories SET content_ciphertext=?,embedding_ciphertext=NULL,embedding_key_version=NULL,key_version=?,inferred=0,confidence=1,updated_at=? WHERE id=? AND user_id=?')
    .run(encrypted.ciphertext, encrypted.keyVersion, stamp, id, userId);
  return memoryFromRow({ ...row, content_ciphertext: encrypted.ciphertext, key_version: encrypted.keyVersion, inferred: 0, confidence: 1, updated_at: stamp }, keyring, userId);
}

export function setAgentMemoryEmbedding(db: Db, keyring: AgentKeyring, userId: string, id: string, embedding: number[]): boolean {
  if (!embedding.length || embedding.length > 4096 || embedding.some(value => !Number.isFinite(value))) throw new Error('记忆向量无效。');
  const exists = db.prepare('SELECT 1 FROM agent_memories WHERE id=? AND user_id=?').get(id, userId); if (!exists) return false;
  const encrypted = encryptAgentText(keyring, userId, 'memory-embedding', id, JSON.stringify(embedding));
  return Number(db.prepare('UPDATE agent_memories SET embedding_ciphertext=?,embedding_key_version=? WHERE id=? AND user_id=?').run(encrypted.ciphertext, encrypted.keyVersion, id, userId).changes) > 0;
}

function cosine(first: number[], second: number[]) {
  if (!first.length || first.length !== second.length) return 0; let dot = 0; let a = 0; let b = 0;
  for (let index = 0; index < first.length; index += 1) { dot += first[index] * second[index]; a += first[index] ** 2; b += second[index] ** 2; }
  return a && b ? dot / Math.sqrt(a * b) : 0;
}

export function retrieveAgentMemories(db: Db, keyring: AgentKeyring, userId: string, query: string, limit = 12, queryEmbedding?: number[]): AgentMemory[] {
  const stamp = now(); const rows = db.prepare('SELECT * FROM agent_memories WHERE user_id=? AND (expires_at IS NULL OR expires_at>?) ORDER BY updated_at DESC LIMIT 500').all(userId, stamp) as Record<string, unknown>[];
  return rows.map(row => {
    const memory = memoryFromRow(row, keyring, userId); let vector = 0;
    if (queryEmbedding?.length && row.embedding_ciphertext && row.embedding_key_version) {
      try {
        const embedding = JSON.parse(decryptAgentText(keyring, userId, 'memory-embedding', memory.id, String(row.embedding_ciphertext), String(row.embedding_key_version))) as number[];
        vector = Math.max(0, cosine(queryEmbedding, embedding));
      } catch { vector = 0; }
    }
    return { memory, score: memoryRelevanceScore(memory, query) + vector * .42 };
  }).sort((first, second) => second.score - first.score || second.memory.updatedAt.localeCompare(first.memory.updatedAt))
    .slice(0, Math.max(1, Math.min(50, limit))).map(item => item.memory);
}

export function inferListeningPreferenceMemories(db: Db, keyring: AgentKeyring, userId: string, at = new Date()) {
  const since = new Date(at.getTime() - 30 * 24 * 60 * 60_000).toISOString();
  const rows = db.prepare(`SELECT t.artist,COUNT(*) plays,SUM(CASE WHEN ls.completed=1 THEN 1 ELSE 0 END) completed_count,SUM(CASE WHEN ls.skipped=1 THEN 1 ELSE 0 END) skipped_count
    FROM listening_sessions ls JOIN tracks t ON t.id=ls.track_id WHERE ls.user_id=? AND ls.updated_at>=? AND TRIM(t.artist)!=''
    GROUP BY LOWER(TRIM(t.artist)) HAVING completed_count>=4 ORDER BY completed_count DESC,plays DESC LIMIT 5`).all(userId, since) as Array<{ artist: string; plays: number; completed_count: number; skipped_count: number }>;
  const expiresAt = new Date(at.getTime() + 180 * 24 * 60 * 60_000).toISOString(); const results: ReturnType<typeof rememberAgentMemory>[] = [];
  for (const row of rows) {
    if (Number(row.skipped_count) / Math.max(1, Number(row.plays)) > .25) continue;
    results.push(rememberAgentMemory(db, keyring, userId, {
      category: 'preference', content: `喜欢${String(row.artist).trim()}的歌曲`, confidence: Math.min(.88, .58 + Number(row.completed_count) * .04), inferred: true, expiresAt
    }));
  }
  return results;
}

export function deleteAgentMemory(db: Db, userId: string, id?: string): number {
  const result = id ? db.prepare('DELETE FROM agent_memories WHERE id=? AND user_id=?').run(id, userId) : db.prepare('DELETE FROM agent_memories WHERE user_id=?').run(userId);
  return Number(result.changes);
}

export function createAgentRun(db: Db, userId: string, conversationId: string, generation: number, modelTier: 'flash' | 'plus' | 'local', webSearch: boolean) {
  const id = randomUUID(); const stamp = now();
  db.prepare(`INSERT INTO agent_runs(id,user_id,conversation_id,generation,status,model_tier,web_search,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)`)
    .run(id, userId, conversationId, generation, 'received', modelTier, Number(webSearch), stamp, stamp);
  return id;
}

export function updateAgentRun(db: Db, runId: string, userId: string, status: string, errorCode?: string) {
  db.prepare('UPDATE agent_runs SET status=?,error_code=?,updated_at=? WHERE id=? AND user_id=?').run(status, errorCode || null, now(), runId, userId);
}

export function createToolAction(db: Db, runId: string, userId: string, toolName: string, risk: AgentToolRisk, input: unknown) {
  const id = randomUUID(); const stamp = now(); const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
  db.prepare(`INSERT INTO agent_tool_actions(id,run_id,user_id,tool_name,risk,status,input_json,expires_at,created_at,updated_at) VALUES(?,?,?,?,?,'proposed',?,?,?,?)`)
    .run(id, runId, userId, toolName, risk, JSON.stringify(input), expiresAt, stamp, stamp);
  return { id, expiresAt };
}

export function updateToolAction(db: Db, userId: string, actionId: string, nextStatus: string, result?: unknown, expectedStatuses: string[] = ['proposed', 'approved']) {
  const row = db.prepare('SELECT * FROM agent_tool_actions WHERE id=? AND user_id=?').get(actionId, userId) as Record<string, unknown> | undefined;
  if (!row) return null;
  if (Date.parse(String(row.expires_at)) <= Date.now()) {
    db.prepare("UPDATE agent_tool_actions SET status='expired',updated_at=? WHERE id=? AND user_id=? AND status IN ('proposed','approved')").run(now(), actionId, userId);
    return null;
  }
  if (!expectedStatuses.includes(String(row.status))) return null;
  db.prepare('UPDATE agent_tool_actions SET status=?,result_json=?,updated_at=? WHERE id=? AND user_id=?').run(nextStatus, result === undefined ? null : JSON.stringify(result), now(), actionId, userId);
  return { id: String(row.id), toolName: String(row.tool_name), risk: String(row.risk) as AgentToolRisk, status: nextStatus, input: JSON.parse(String(row.input_json)), result };
}

export function hashInviteCode(code: string): string {
  return createHash('sha256').update(code.trim()).digest('hex');
}

export function createAgentInvite(db: Db, createdBy: string, input: { maxUses: number; expiresInDays: number; note: string }) {
  const code = `ZQ-${randomBytes(6).toString('hex').toUpperCase()}`; const id = randomUUID(); const stamp = now();
  const expiresAt = new Date(Date.now() + input.expiresInDays * 24 * 60 * 60_000).toISOString();
  db.prepare(`INSERT INTO agent_invites(id,code_hash,max_uses,expires_at,note,created_by,created_at) VALUES(?,?,?,?,?,?,?)`)
    .run(id, hashInviteCode(code), input.maxUses, expiresAt, input.note, createdBy, stamp);
  return { id, code, maxUses: input.maxUses, useCount: 0, expiresAt, disabled: false, note: input.note, createdAt: stamp };
}

export function listAgentInvites(db: Db) {
  return (db.prepare('SELECT id,max_uses,use_count,expires_at,disabled,note,created_at FROM agent_invites ORDER BY created_at DESC').all() as Record<string, unknown>[]).map(row => ({
    id: String(row.id), maxUses: Number(row.max_uses), useCount: Number(row.use_count), expiresAt: String(row.expires_at), disabled: bool(row.disabled), note: String(row.note), createdAt: String(row.created_at)
  }));
}

export function redeemAgentInvite(db: Db, userId: string, code: string): boolean {
  const stamp = now(); const hash = hashInviteCode(code);
  db.exec('BEGIN IMMEDIATE');
  try {
    const row = db.prepare('SELECT * FROM agent_invites WHERE code_hash=? AND disabled=0 AND expires_at>? AND use_count<max_uses').get(hash, stamp) as Record<string, unknown> | undefined;
    if (!row) { db.exec('ROLLBACK'); return false; }
    db.prepare("INSERT INTO agent_entitlements(user_id,source,granted_at) VALUES(?,'invite',?) ON CONFLICT(user_id) DO UPDATE SET source='invite',granted_at=excluded.granted_at,expires_at=NULL").run(userId, stamp);
    db.prepare('UPDATE agent_invites SET use_count=use_count+1 WHERE id=?').run(String(row.id)); db.exec('COMMIT'); return true;
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

export function monthlyAgentCost(db: Db, date = new Date()): number {
  const month = date.toISOString().slice(0, 7);
  const row = db.prepare("SELECT COALESCE(SUM(estimated_cost_cny),0) cost FROM agent_usage_daily WHERE usage_date LIKE ?").get(`${month}-%`) as { cost: number };
  return Number(row.cost || 0);
}

export function recordAgentUsage(db: Db, input: { userId: string; provider: string; model: string; inputTokens?: number; outputTokens?: number; searchCalls?: number; asrSeconds?: number; ttsCharacters?: number; estimatedCostCny?: number }) {
  const date = now().slice(0, 10);
  db.prepare(`INSERT INTO agent_usage_daily(usage_date,user_id,provider,model,input_tokens,output_tokens,search_calls,asr_seconds,tts_characters,estimated_cost_cny)
    VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(usage_date,user_id,provider,model) DO UPDATE SET input_tokens=input_tokens+excluded.input_tokens,output_tokens=output_tokens+excluded.output_tokens,search_calls=search_calls+excluded.search_calls,asr_seconds=asr_seconds+excluded.asr_seconds,tts_characters=tts_characters+excluded.tts_characters,estimated_cost_cny=estimated_cost_cny+excluded.estimated_cost_cny`)
    .run(date, input.userId, input.provider, input.model, input.inputTokens || 0, input.outputTokens || 0, input.searchCalls || 0, input.asrSeconds || 0, input.ttsCharacters || 0, input.estimatedCostCny || 0);
}
