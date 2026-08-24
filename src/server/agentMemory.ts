import type { AgentMemory } from '../shared/types.js';

export interface AgentMemoryCandidate {
  category: AgentMemory['category'];
  content: string;
  confidence: number;
  inferred: boolean;
  expiresAt: string | null;
}

function cleanCapture(value: string, limit = 100) {
  return value.normalize('NFKC').replace(/^[\s，,：:]+|[\s，,。.!！?？]+$/g, '').replace(/\s+/g, ' ').slice(0, limit).trim();
}

export function normalizeMemoryText(value: string) {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/[\s\-—_()（）【】\[\]'.·,，。!！?？:：]/g, '');
}

function preferenceTarget(content: string) {
  return cleanCapture(content.replace(/^(?:可能)?(?:我)?(?:一直|很|最|比较)?(?:不喜欢|不爱听|不想听|喜欢|爱听|偏爱|常听|希望少听|别给我推荐|不要推荐)/, '')
    .replace(/(?:的)?(?:歌曲|音乐|歌)$/u, ''), 80);
}

export function agentMemoryKey(memory: Pick<AgentMemoryCandidate, 'category' | 'content'>) {
  const normalized = normalizeMemoryText(memory.content);
  if (memory.category === 'preference') return `preference:${normalizeMemoryText(preferenceTarget(memory.content)) || normalized}`;
  if (memory.category === 'person' && /(?:叫我|称呼|名字|我叫)/.test(memory.content)) return 'person:preferred-name';
  if (memory.category === 'context' && /(?:心情|情绪|状态|感觉)/.test(memory.content)) return 'context:recent-mood';
  return `${memory.category}:${normalized}`;
}

function addCandidate(result: AgentMemoryCandidate[], candidate: AgentMemoryCandidate) {
  if (!candidate.content || candidate.content.length < 2) return;
  const key = agentMemoryKey(candidate);
  const existing = result.findIndex(item => agentMemoryKey(item) === key);
  if (existing >= 0) result[existing] = candidate; else result.push(candidate);
}

export function extractExplicitMemoryCandidates(message: string, at = new Date()): AgentMemoryCandidate[] {
  const text = message.normalize('NFKC').trim(); const result: AgentMemoryCandidate[] = [];
  const clauses = text.split(/[。！!？?\n]+/).map(value => value.trim()).filter(Boolean).slice(0, 12);
  for (const clause of clauses) {
    const name = clause.match(/(?:我叫|叫我|你可以叫我)\s*([\p{L}\p{N}_-]{1,24})/u)?.[1];
    if (name) addCandidate(result, { category: 'person', content: `希望被称为${cleanCapture(name, 24)}`, confidence: 1, inferred: false, expiresAt: null });

    const negative = clause.match(/(?:我(?:一直|很|最|比较)?(?:不喜欢|不爱听|不想听)|别给我推荐|不要推荐)\s*([^，,；;]{1,80})/u)?.[1];
    if (negative) addCandidate(result, { category: 'preference', content: `不喜欢${cleanCapture(negative, 80)}`, confidence: 1, inferred: false, expiresAt: null });
    else {
      const positive = clause.match(/我(?:一直|很|最|比较)?(?:喜欢|爱听|偏爱|常听)\s*([^，,；;]{1,80})/u)?.[1];
      if (positive) addCandidate(result, { category: 'preference', content: `喜欢${cleanCapture(positive, 80)}`, confidence: 1, inferred: false, expiresAt: null });
    }

    const plan = clause.match(/我(?:打算|计划|准备)\s*([^，,；;]{2,100})/u)?.[1];
    if (plan) addCandidate(result, { category: 'plan', content: `计划${cleanCapture(plan, 100)}`, confidence: 1, inferred: false, expiresAt: null });

    const mood = clause.match(/((?:今天|今晚|现在|此刻|最近|这几天)[^，,；;]{0,16}(?:心情|情绪|状态|感觉)[^，,；;]{1,60})/u)?.[1];
    if (mood) {
      const recent = /最近|这几天/.test(mood); const ttl = recent ? 14 : 3;
      addCandidate(result, { category: 'context', content: cleanCapture(mood, 100), confidence: 1, inferred: false, expiresAt: new Date(at.getTime() + ttl * 24 * 60 * 60_000).toISOString() });
    }
  }
  return result.slice(0, 6);
}

function semanticTokens(value: string) {
  const normalized = normalizeMemoryText(value); const tokens = new Set<string>();
  for (let index = 0; index < normalized.length - 1; index += 1) tokens.add(normalized.slice(index, index + 2));
  for (const word of value.normalize('NFKC').toLocaleLowerCase().split(/[^a-z\d]+/).filter(word => word.length > 1)) tokens.add(word);
  return tokens;
}

export function memoryRelevanceScore(memory: AgentMemory, query: string, at = new Date()) {
  if (memory.expiresAt && Date.parse(memory.expiresAt) <= at.getTime()) return -Infinity;
  const target = semanticTokens(query); const candidate = semanticTokens(memory.content); let overlap = 0;
  target.forEach(token => { if (candidate.has(token)) overlap += 1; });
  const lexical = target.size && candidate.size ? overlap / Math.sqrt(target.size * candidate.size) : 0;
  const ageDays = Math.max(0, (at.getTime() - Date.parse(memory.updatedAt)) / (24 * 60 * 60_000));
  const recency = Math.exp(-ageDays / (memory.category === 'context' ? 7 : 180));
  const stable = memory.category === 'preference' || memory.category === 'person' ? .18 : memory.category === 'plan' ? .1 : 0;
  return lexical * .68 + recency * .16 + Math.max(0, Math.min(1, memory.confidence)) * .16 + stable;
}
