import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import type { Db } from './db.js';
import type { KnowledgeDocumentInput } from './agentKnowledge.js';

export type TrendProvider = 'douyin' | 'qishui' | 'fixture';
export interface TrendSourceItem {
  id: string;
  rank: number;
  title: string;
  artist: string;
  sourceUrl: string;
  durationMs?: number | null;
  coverUrl?: string | null;
}
export interface TrendSnapshotInput { provider: TrendProvider; collectedAt: string; items: TrendSourceItem[]; }
export interface TrendSourceAdapter {
  readonly id: Exclude<TrendProvider, 'fixture'>;
  configured(): boolean;
  fetchLatest(signal?: AbortSignal): Promise<TrendSnapshotInput>;
}
export interface KnowledgePublishPayload {
  kind: 'douyin';
  source: string;
  collectedAt: string;
  documents: KnowledgeDocumentInput[];
  checksum: string;
}

const derivativePattern = /(?:\b(?:live|dj|remix|cover|instrumental|sped\s*up|slowed)\b|翻唱|现场(?:版)?|铃声(?:版)?|伴奏(?:版)?|加速(?:版)?|纯音乐)/iu;
const officialHosts = new Set(['open.douyin.com', 'www.douyin.com', 'douyin.com', 'www.qishui.com', 'qishui.com']);
const now = () => new Date().toISOString();

function normalizedIdentity(value: string) { return value.normalize('NFKC').toLocaleLowerCase().replace(/[\s·•._\-—–()[\]【】《》“”'"：:，,]+/gu, ''); }
function baseTitle(value: string) {
  return value.replace(/[（(【[][^）)】\]]*(?:live|dj|remix|cover|翻唱|现场|铃声|伴奏|加速|纯音乐)[^）)】\]]*[）)】\]]/giu, '').replace(derivativePattern, '').trim() || value.trim();
}
function officialSourceUrl(value: string) {
  try { const url = new URL(value); return url.protocol === 'https:' && officialHosts.has(url.hostname.toLocaleLowerCase()); } catch { return false; }
}

export function normalizeTrendSnapshot(input: TrendSnapshotInput): { documents: KnowledgeDocumentInput[]; derivativeCount: number; duplicateCount: number } {
  if (!Number.isFinite(Date.parse(input.collectedAt))) throw new Error('趋势采集时间无效。');
  if (!input.items.length || input.items.length > 500) throw new Error('趋势快照需要包含 1–500 条记录。');
  const ranks = new Set<number>(); const ids = new Set<string>(); const selected = new Map<string, { item: TrendSourceItem; derivative: boolean }>(); let duplicateCount = 0;
  for (const item of input.items) {
    if (!item.id.trim() || !item.title.trim() || !item.artist.trim()) throw new Error('趋势记录缺少歌曲、歌手或来源 ID。');
    if (!Number.isInteger(item.rank) || item.rank < 1 || item.rank > 500 || ranks.has(item.rank)) throw new Error('趋势排名必须在 1–500 内且不能重复。');
    if (ids.has(item.id)) throw new Error('趋势来源 ID 不能重复。');
    if (!officialSourceUrl(item.sourceUrl)) throw new Error('趋势记录必须指向抖音或汽水音乐官方 HTTPS 页面。');
    if (item.durationMs != null && (!Number.isFinite(item.durationMs) || item.durationMs < 20_000 || item.durationMs > 60 * 60_000)) throw new Error('趋势歌曲时长不合理。');
    ranks.add(item.rank); ids.add(item.id);
    const derivative = derivativePattern.test(`${item.title} ${item.artist}`); const key = `${normalizedIdentity(baseTitle(item.title))}|${normalizedIdentity(item.artist)}`; const current = selected.get(key);
    if (current) {
      duplicateCount += 1;
      if (current.derivative && !derivative || current.derivative === derivative && item.rank < current.item.rank) selected.set(key, { item, derivative });
    } else selected.set(key, { item, derivative });
  }
  const rows = [...selected.values()].sort((first, second) => first.item.rank - second.item.rank); const derivativeCount = rows.filter(row => row.derivative).length;
  const documents = rows.map(({ item, derivative }) => ({
    externalId: `${input.provider}:${item.id}`,
    title: baseTitle(item.title), artist: item.artist.trim(), sourceUrl: item.sourceUrl,
    content: `${input.provider === 'qishui' ? '汽水音乐公开歌单' : input.provider === 'douyin' ? '抖音官方音乐榜单' : '本地固定演练夹具'}第 ${item.rank} 位：${baseTitle(item.title)}，原始标注歌手 ${item.artist.trim()}。${derivative ? '该条目标记为衍生版本，不能自动作为原唱推荐。' : '推荐前仍需映射本站歌曲并校验原唱、版本与时长。'}`,
    metadata: { provider: input.provider, rank: item.rank, durationMs: item.durationMs ?? null, coverUrl: item.coverUrl ?? null, derivative, originalTitle: item.title.trim(), collectedAt: input.collectedAt }
  }));
  return { documents, derivativeCount, duplicateCount };
}

export function buildTrendPublishPayload(input: TrendSnapshotInput): KnowledgePublishPayload {
  const result = normalizeTrendSnapshot(input); const source = input.provider === 'douyin' ? 'douyin-official-music-chart' : input.provider === 'qishui' ? 'qishui-official-public-playlist' : 'local-trend-pipeline-fixture';
  const canonical = JSON.stringify(result.documents.map(item => ({ ...item, metadata: item.metadata || {} })));
  return { kind: 'douyin', source, collectedAt: input.collectedAt, documents: result.documents, checksum: createHash('sha256').update(canonical).digest('hex') };
}

export function signKnowledgePublishPayload(payload: KnowledgePublishPayload, secret: string, timestamp = String(Date.now()), nonce = randomBytes(18).toString('base64url')) {
  if (!secret) throw new Error('KNOWLEDGE_PUBLISH_HMAC_KEY 未配置。');
  const body = JSON.stringify(payload); const bodyHash = createHash('sha256').update(body).digest('hex'); const signature = createHmac('sha256', secret).update(`${timestamp}.${nonce}.${bodyHash}`).digest('hex');
  return { body, headers: { 'content-type': 'application/json', 'x-zhenqi-timestamp': timestamp, 'x-zhenqi-nonce': nonce, 'x-zhenqi-signature': signature } };
}

export async function publishTrendSnapshot(url: string, secret: string, input: TrendSnapshotInput, fetcher: typeof fetch = fetch) {
  const target = new URL(url); if (target.protocol !== 'https:' && !['127.0.0.1', 'localhost'].includes(target.hostname)) throw new Error('知识发布地址必须使用 HTTPS。');
  const payload = buildTrendPublishPayload(input); const signed = signKnowledgePublishPayload(payload, secret); const response = await fetcher(target, { method: 'POST', headers: signed.headers, body: signed.body, signal: AbortSignal.timeout(30_000) });
  const result = await response.json().catch(() => null); if (!response.ok) throw new Error(`知识发布失败（HTTP ${response.status}）。`); return result;
}

export function startTrendUpdateRun(db: Db, source: string, mode: 'fixture' | 'live', scheduledFor: string | null = null) {
  const id = randomUUID(); const stamp = now(); db.prepare(`INSERT INTO knowledge_update_runs(id,source,mode,status,scheduled_for,started_at,created_at,updated_at) VALUES(?,?,?,'running',?,?,?,?)`).run(id, source, mode, scheduledFor, stamp, stamp, stamp); return id;
}

export function finishTrendUpdateRun(db: Db, id: string, input: { status: 'completed' | 'failed'; itemCount?: number; versionId?: string | null; message: string }) {
  const stamp = now(); db.prepare('UPDATE knowledge_update_runs SET status=?,item_count=?,version_id=?,message=?,completed_at=?,updated_at=? WHERE id=?').run(input.status, input.itemCount || 0, input.versionId || null, input.message.slice(0, 500), stamp, stamp, id);
  db.prepare('DELETE FROM knowledge_update_runs WHERE id NOT IN (SELECT id FROM knowledge_update_runs ORDER BY created_at DESC LIMIT 100)').run();
}

export function listTrendUpdateRuns(db: Db, limit = 20) {
  return (db.prepare('SELECT * FROM knowledge_update_runs ORDER BY created_at DESC LIMIT ?').all(Math.max(1, Math.min(100, limit))) as Record<string, unknown>[]).map(row => ({
    id: String(row.id), source: String(row.source), mode: String(row.mode), status: String(row.status), scheduledFor: row.scheduled_for ? String(row.scheduled_for) : null,
    startedAt: String(row.started_at), completedAt: row.completed_at ? String(row.completed_at) : null, itemCount: Number(row.item_count || 0), versionId: row.version_id ? String(row.version_id) : null, message: String(row.message || '')
  }));
}

export const TREND_REHEARSAL_FIXTURE: TrendSnapshotInput = {
  provider: 'fixture', collectedAt: '2026-08-24T00:00:00.000Z', items: [
    { id: 'fixture-01', rank: 1, title: '晴天', artist: '周杰伦', sourceUrl: 'https://open.douyin.com/' },
    { id: 'fixture-02', rank: 2, title: '后来', artist: '刘若英', sourceUrl: 'https://www.douyin.com/' },
    { id: 'fixture-03', rank: 3, title: '夜空中最亮的星（Live）', artist: '逃跑计划', sourceUrl: 'https://www.qishui.com/' },
    { id: 'fixture-04', rank: 4, title: '夜空中最亮的星', artist: '逃跑计划', sourceUrl: 'https://qishui.com/' },
    { id: 'fixture-05', rank: 5, title: '如愿', artist: '王菲', sourceUrl: 'https://open.douyin.com/' },
    { id: 'fixture-06', rank: 6, title: '海阔天空', artist: 'Beyond', sourceUrl: 'https://www.douyin.com/' }
  ]
};

export function runTrendRehearsal(db: Db) {
  const runId = startTrendUpdateRun(db, 'local-trend-pipeline-fixture', 'fixture');
  try {
    const normalized = normalizeTrendSnapshot(TREND_REHEARSAL_FIXTURE); const payload = buildTrendPublishPayload(TREND_REHEARSAL_FIXTURE); const signed = signKnowledgePublishPayload(payload, 'fixture-only-secret', '1787529600000', 'fixture_nonce_beta3');
    finishTrendUpdateRun(db, runId, { status: 'completed', itemCount: normalized.documents.length, message: `演练完成：${normalized.documents.length} 条，合并 ${normalized.duplicateCount} 条，衍生版本 ${normalized.derivativeCount} 条；未写入正式知识库。` });
    return { runId, itemCount: normalized.documents.length, duplicateCount: normalized.duplicateCount, derivativeCount: normalized.derivativeCount, checksum: payload.checksum, signaturePrefix: signed.headers['x-zhenqi-signature'].slice(0, 8) };
  } catch (error) { finishTrendUpdateRun(db, runId, { status: 'failed', message: error instanceof Error ? error.message : '趋势流水线演练失败。' }); throw error; }
}
