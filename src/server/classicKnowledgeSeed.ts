import type { Db } from './db.js';
import { publishKnowledgeVersion } from './agentKnowledge.js';
import { CLASSIC_KNOWLEDGE_SOURCE, classicKnowledgeDocuments, validateClassicKnowledgeDocuments } from './classicKnowledgeCatalog.js';

export function ensureClassicKnowledgeSeed(db: Db) {
  if (process.env.AGENT_SEED_CLASSIC === 'false') return;
  const active = db.prepare("SELECT source FROM knowledge_versions WHERE kind='classic' AND status='active'").get() as { source: string } | undefined;
  if (active && (!active.source.startsWith('bundled-golden-') && !active.source.startsWith('bundled-curated-'))) return;
  if (active?.source === CLASSIC_KNOWLEDGE_SOURCE) return;
  const documents = classicKnowledgeDocuments(); validateClassicKnowledgeDocuments(documents);
  publishKnowledgeVersion(db, { kind: 'classic', source: CLASSIC_KNOWLEDGE_SOURCE, collectedAt: new Date().toISOString(), documents });
}
