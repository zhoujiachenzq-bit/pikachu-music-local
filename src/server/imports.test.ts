import { describe, expect, it } from 'vitest';
import { createDatabase } from './db.js';
import { mergeSourceAndLocalOrder, recoverImportJobs } from './imports.js';

describe('playlist source synchronization order', () => {
  it('keeps local additions beside surviving source anchors', () => {
    const previous = [
      { id: 'source-a', origin: 'source' as const },
      { id: 'local-1', origin: 'local' as const },
      { id: 'source-b', origin: 'source' as const },
      { id: 'local-2', origin: 'local' as const }
    ];
    expect(mergeSourceAndLocalOrder(previous, ['source-b', 'source-c', 'source-a']))
      .toEqual(['source-b', 'local-2', 'source-c', 'source-a', 'local-1']);
  });

  it('does not duplicate a locally-added track that later appears upstream', () => {
    expect(mergeSourceAndLocalOrder([{ id: 'same', origin: 'local' }], ['same'])).toEqual(['same']);
  });
});

describe('import recovery', () => {
  it('returns interrupted running jobs to the queue', () => {
    const db = createDatabase(':memory:'); const stamp = new Date().toISOString();
    db.prepare("INSERT INTO users(id,username,password_hash,password_salt,created_at,updated_at) VALUES('u','u','h','s',?,?)").run(stamp, stamp);
    db.prepare("INSERT INTO import_jobs(id,user_id,source,source_playlist_id,input,status,created_at,updated_at) VALUES('j','u','qq','1','1','running',?,?)").run(stamp, stamp);
    expect(recoverImportJobs(db, false)).toBe(1);
    expect((db.prepare("SELECT status FROM import_jobs WHERE id='j'").get() as { status: string }).status).toBe('queued');
    db.close();
  });
});
