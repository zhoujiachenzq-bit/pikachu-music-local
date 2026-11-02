import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDatabase } from './db.js';
import { createImportJob, getImportJob, mergeSourceAndLocalOrder, recoverImportJobs, runImportJob } from './imports.js';

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('partial public playlist import', () => {
  it('fetches missing metadata and preserves existing songs when a later sync is incomplete', async () => {
    vi.stubEnv('GO_MUSIC_API_DIRECT_MEDIA', '');
    let partial = false;
    const song = (id: number) => ({ id, name: `Song ${id}`, artists: [{ name: 'Artist' }], album: { name: 'Album' }, duration: 200000 });
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => Response.json(String(input).includes('/playlist/detail')
      ? { playlist: { id: 12345, name: 'Public list', trackCount: 2, trackIds: [{ id: 1 }, { id: 2 }], tracks: [song(1)] } }
      : { songs: partial ? [] : [song(2)] })));
    const db = createDatabase(':memory:'); const stamp = new Date().toISOString();
    db.prepare("INSERT INTO users(id,username,password_hash,password_salt,created_at,updated_at) VALUES('u','u','h','s',?,?)").run(stamp, stamp);
    try {
      const first = createImportJob(db, 'u', '12345', 'netease'); await runImportJob(db, first.id);
      expect(getImportJob(db, 'u', first.id)).toMatchObject({ status: 'completed', processed: 2, total: 2 });
      partial = true;
      const sync = createImportJob(db, 'u', '12345', 'netease'); await runImportJob(db, sync.id);
      const result = getImportJob(db, 'u', sync.id)!;
      expect(result).toMatchObject({ status: 'partial', processed: 1, total: 2 });
      expect(result.failures[0].reason).toContain('1/2');
      expect(db.prepare('SELECT COUNT(*) n FROM playlist_items WHERE playlist_id=? AND excluded=0').get(result.playlistId)).toEqual({ n: 2 });
    } finally { db.close(); }
  });
});

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
