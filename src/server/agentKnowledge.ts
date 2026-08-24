import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Db } from './db.js';

export interface KnowledgeDocumentInput {
  externalId: string; title: string; artist?: string; sourceUrl?: string | null; content: string; metadata?: Record<string, unknown>;
}

const allowedKnowledgeHosts = ['open.douyin.com', 'douyin.com', 'www.douyin.com', 'qishui.com', 'www.qishui.com'];
const now = () => new Date().toISOString();

function sourceUrlAllowed(value: string | null | undefined) {
  if (!value) return true;
  try { const url = new URL(value); return url.protocol === 'https:' && allowedKnowledgeHosts.some(host => url.hostname === host || url.hostname.endsWith(`.${host}`)); } catch { return false; }
}

export function verifyKnowledgeSignature(rawBody: string, headers: { timestamp?: string; nonce?: string; signature?: string }, secret: string, clock = Date.now): boolean {
  if (!secret || !headers.timestamp || !headers.nonce || !headers.signature || !/^\d{10,13}$/.test(headers.timestamp) || !/^[a-zA-Z0-9_-]{12,100}$/.test(headers.nonce)) return false;
  const stamp = Number(headers.timestamp.length === 10 ? `${headers.timestamp}000` : headers.timestamp); if (!Number.isFinite(stamp) || Math.abs(clock() - stamp) > 5 * 60_000) return false;
  const bodyHash = createHash('sha256').update(rawBody).digest('hex'); const expected = createHmac('sha256', secret).update(`${headers.timestamp}.${headers.nonce}.${bodyHash}`).digest('hex');
  try { return timingSafeEqual(Buffer.from(expected), Buffer.from(headers.signature.toLowerCase())); } catch { return false; }
}

export function publishKnowledgeVersion(db: Db, input: { kind: 'classic' | 'douyin'; source: string; collectedAt: string; documents: KnowledgeDocumentInput[]; checksum?: string }) {
  if (!input.documents.length || input.documents.length > 1000) throw new Error('知识版本需要包含 1–1000 条记录。');
  const externalIds = new Set<string>();
  for (const item of input.documents) {
    if (!item.externalId.trim() || !item.title.trim() || !item.content.trim() || item.content.length > 4000) throw new Error('知识记录缺少必要字段或内容过长。');
    if (externalIds.has(item.externalId)) throw new Error('同一知识版本中 externalId 必须唯一。'); externalIds.add(item.externalId);
    if (!sourceUrlAllowed(item.sourceUrl)) throw new Error('知识来源链接不在允许的官方域名内。');
  }
  const canonical = JSON.stringify(input.documents.map(item => ({ ...item, metadata: item.metadata || {} }))); const checksum = input.checksum || createHash('sha256').update(canonical).digest('hex'); const id = randomUUID(); const stamp = now();
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare("INSERT INTO knowledge_versions(id,kind,status,source,collected_at,item_count,checksum,created_at) VALUES(?,?,'staging',?,?,?,?,?)").run(id, input.kind, input.source, input.collectedAt, input.documents.length, checksum, stamp);
    const insertDoc = db.prepare('INSERT INTO knowledge_documents(id,version_id,external_id,title,artist,source_url,metadata_json,created_at) VALUES(?,?,?,?,?,?,?,?)');
    const insertChunk = db.prepare('INSERT INTO knowledge_chunks(id,document_id,version_id,content,created_at) VALUES(?,?,?,?,?)'); const insertFts = db.prepare('INSERT INTO knowledge_chunks_fts(chunk_id,content) VALUES(?,?)');
    for (const item of input.documents) {
      const documentId = randomUUID(); const chunkId = randomUUID(); insertDoc.run(documentId, id, item.externalId, item.title.trim(), item.artist?.trim() || '', item.sourceUrl || null, JSON.stringify(item.metadata || {}), stamp); insertChunk.run(chunkId, documentId, id, item.content.trim(), stamp); insertFts.run(chunkId, `${item.title} ${item.artist || ''} ${item.content}`);
    }
    db.prepare("UPDATE knowledge_versions SET status='archived' WHERE kind=? AND status='active'").run(input.kind);
    db.prepare("UPDATE knowledge_versions SET status='active',activated_at=? WHERE id=?").run(stamp, id); db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  pruneKnowledgeVersions(db, input.kind, 8); return getKnowledgeVersion(db, id)!;
}

function pruneKnowledgeVersions(db: Db, kind: 'classic' | 'douyin', keep: number) {
  const stale = db.prepare("SELECT id FROM knowledge_versions WHERE kind=? AND status!='active' ORDER BY created_at DESC LIMIT -1 OFFSET ?").all(kind, keep - 1) as Array<{ id: string }>;
  for (const row of stale) {
    const chunks = db.prepare('SELECT id FROM knowledge_chunks WHERE version_id=?').all(row.id) as Array<{ id: string }>; chunks.forEach(chunk => db.prepare('DELETE FROM knowledge_chunks_fts WHERE chunk_id=?').run(chunk.id)); db.prepare('DELETE FROM knowledge_versions WHERE id=?').run(row.id);
  }
}

export function getKnowledgeVersion(db: Db, id: string) {
  const row = db.prepare('SELECT * FROM knowledge_versions WHERE id=?').get(id) as Record<string, unknown> | undefined;
  return row ? { id: String(row.id), kind: String(row.kind), status: String(row.status), source: String(row.source), collectedAt: String(row.collected_at), itemCount: Number(row.item_count), checksum: String(row.checksum), message: String(row.message || ''), createdAt: String(row.created_at), activatedAt: row.activated_at ? String(row.activated_at) : null } : null;
}

export function listKnowledgeVersions(db: Db) { return (db.prepare('SELECT id FROM knowledge_versions ORDER BY kind,created_at DESC').all() as Array<{ id: string }>).map(row => getKnowledgeVersion(db, row.id)); }

export function activateKnowledgeVersion(db: Db, id: string) {
  const target = db.prepare('SELECT kind FROM knowledge_versions WHERE id=?').get(id) as { kind: 'classic' | 'douyin' } | undefined; if (!target) return null;
  db.exec('BEGIN IMMEDIATE'); try { db.prepare("UPDATE knowledge_versions SET status='archived' WHERE kind=? AND status='active'").run(target.kind); db.prepare("UPDATE knowledge_versions SET status='active',activated_at=? WHERE id=?").run(now(), id); db.exec('COMMIT'); } catch (error) { db.exec('ROLLBACK'); throw error; }
  return getKnowledgeVersion(db, id);
}

function ftsQuery(query: string) { return query.normalize('NFKC').split(/[^\p{L}\p{N}]+/u).map(value => value.trim()).filter(value => value.length > 1).slice(0, 8).map(value => `"${value.replace(/"/g, '""')}"`).join(' OR '); }

export function retrieveKnowledge(db: Db, query: string, limit = 8) {
  const expression = ftsQuery(query); if (!expression) return [];
  const lexical = db.prepare(`SELECT kc.id,kc.content,kd.title,kd.artist,kd.source_url,kd.metadata_json,bm25(knowledge_chunks_fts) score
    FROM knowledge_chunks_fts JOIN knowledge_chunks kc ON kc.id=knowledge_chunks_fts.chunk_id JOIN knowledge_documents kd ON kd.id=kc.document_id JOIN knowledge_versions kv ON kv.id=kc.version_id
    WHERE knowledge_chunks_fts MATCH ? AND kv.status='active' ORDER BY score LIMIT 20`).all(expression) as Record<string, unknown>[];
  const pool = db.prepare(`SELECT kc.id,kc.content,kd.title,kd.artist,kd.source_url,kd.metadata_json FROM knowledge_chunks kc JOIN knowledge_documents kd ON kd.id=kc.document_id JOIN knowledge_versions kv ON kv.id=kc.version_id WHERE kv.status='active' LIMIT 1500`).all() as Record<string, unknown>[];
  const target = semanticTokens(query); const semantic = pool.map(row => ({ row, score: overlapScore(target, semanticTokens(`${row.title} ${row.artist} ${row.content}`)) })).filter(item => item.score > 0).sort((a, b) => b.score - a.score).slice(0, 20).map(item => item.row);
  const ranks = new Map<string, { row: Record<string, unknown>; score: number }>();
  for (const [index, row] of lexical.entries()) ranks.set(String(row.id), { row, score: 1 / (60 + index + 1) });
  for (const [index, row] of semantic.entries()) { const current = ranks.get(String(row.id)); ranks.set(String(row.id), { row, score: (current?.score || 0) + 1 / (60 + index + 1) }); }
  return [...ranks.values()].sort((a, b) => b.score - a.score).slice(0, Math.max(1, Math.min(20, limit))).map(({ row }) => ({ id: String(row.id), title: String(row.title), artist: String(row.artist), content: String(row.content), sourceUrl: row.source_url ? String(row.source_url) : null, metadata: JSON.parse(String(row.metadata_json || '{}')) as Record<string, unknown> }));
}

function semanticTokens(value: string) {
  const normalized = value.normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ''); const result = new Set<string>();
  for (const word of value.normalize('NFKC').toLocaleLowerCase().split(/[^a-z\d]+/).filter(word => word.length > 1)) result.add(word);
  for (let index = 0; index < normalized.length - 1; index += 1) result.add(normalized.slice(index, index + 2));
  return result;
}

function overlapScore(first: Set<string>, second: Set<string>) { if (!first.size || !second.size) return 0; let overlap = 0; first.forEach(token => { if (second.has(token)) overlap += 1; }); return overlap / Math.sqrt(first.size * second.size); }
