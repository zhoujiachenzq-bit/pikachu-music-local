import { describe, expect, it } from 'vitest';
import { createDatabase } from './db.js';
import { CLASSIC_KNOWLEDGE_SOURCE, classicKnowledgeDocuments, validateClassicKnowledgeDocuments } from './classicKnowledgeCatalog.js';
import { ensureClassicKnowledgeSeed } from './classicKnowledgeSeed.js';

describe('bundled classic knowledge catalog', () => {
  it('contains 300 unique curated tracks with an 80/20 language split', () => {
    const documents = classicKnowledgeDocuments();
    expect(validateClassicKnowledgeDocuments(documents)).toEqual({ total: 300, zh: 240, international: 60 });
    expect(new Set(documents.map(item => `${item.title}::${item.artist}`)).size).toBe(300);
  });

  it('upgrades the old bundled seed but preserves a custom active version', () => {
    const db = createDatabase(':memory:');
    db.prepare("INSERT INTO knowledge_versions(id,kind,status,source,collected_at,item_count,checksum,created_at) VALUES('old','classic','active','bundled-golden-v1',?,1,'old',?)").run(new Date().toISOString(), new Date().toISOString());
    ensureClassicKnowledgeSeed(db);
    expect(db.prepare("SELECT source,item_count FROM knowledge_versions WHERE kind='classic' AND status='active'").get()).toEqual({ source: CLASSIC_KNOWLEDGE_SOURCE, item_count: 300 });
    db.prepare("UPDATE knowledge_versions SET status='archived' WHERE kind='classic'").run();
    db.prepare("INSERT INTO knowledge_versions(id,kind,status,source,collected_at,item_count,checksum,created_at) VALUES('custom','classic','active','owner-curated',?,1,'custom',?)").run(new Date().toISOString(), new Date().toISOString());
    ensureClassicKnowledgeSeed(db);
    expect(db.prepare("SELECT source FROM knowledge_versions WHERE kind='classic' AND status='active'").get()).toEqual({ source: 'owner-curated' });
    db.close();
  });
});
