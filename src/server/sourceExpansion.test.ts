import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { createDatabase, expandMusicSourceConstraints, upsertTrack } from './db.js';
import { SOURCES } from '../shared/types.js';
import { searchWithGoMusicApi, resolveExactWithGoMusicApi } from './goMusicApi.js';
import initSqlJs from 'sql.js';
import { PhoneDatabase, type SqlJsDatabase } from '../phone/sqliteAdapter.js';

describe('extended source integration', () => {
  it('retains upgraded phone data after sql.js export and reopen', async () => {
    const SQL = await initSqlJs();
    const phone = new PhoneDatabase(new SQL.Database() as unknown as SqlJsDatabase);
    phone.exec("PRAGMA foreign_keys=ON; CREATE TABLE tracks(id TEXT PRIMARY KEY,source TEXT CHECK(source IN ('migu','netease','qq','kuwo'))); CREATE TABLE favorites(track_id TEXT REFERENCES tracks(id) ON DELETE CASCADE); INSERT INTO tracks VALUES('old','qq'); INSERT INTO favorites VALUES('old');");
    expandMusicSourceConstraints(phone as unknown as DatabaseSync);
    phone.exec("INSERT INTO tracks VALUES('new','bilibili')");
    const reopened = new PhoneDatabase(new SQL.Database(phone.snapshot()) as unknown as SqlJsDatabase);
    reopened.exec('PRAGMA foreign_keys=ON');
    expect(reopened.prepare('SELECT * FROM favorites').all()).toEqual([{ track_id: 'old' }]);
    expect(reopened.prepare('SELECT count(*) AS total FROM tracks').get()).toEqual({ total: 2 });
    expect(() => reopened.exec("INSERT INTO favorites VALUES('missing')")).toThrow();
  });
  it('stores all upstream source ids without changing existing constraints on other fields', () => {
    const db = createDatabase(':memory:');
    try {
      for (const source of SOURCES) upsertTrack(db, { id: `${source}:id`, source, sourceTrackId: 'id', title: '测试', artist: '歌手', album: '', duration: 180000, coverUrl: null, sourceUrl: null });
      expect(db.prepare('SELECT count(*) AS total FROM tracks').get()).toMatchObject({ total: SOURCES.length });
      expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    } finally { db.close(); }
  });
  it('upgrades an old table with dependent rows and indices, retaining its foreign keys', () => {
    const db = new DatabaseSync(':memory:');
    try {
      db.exec("PRAGMA foreign_keys=ON; CREATE TABLE tracks(id TEXT PRIMARY KEY,source TEXT CHECK(source IN ('migu','netease','qq','kuwo'))); CREATE INDEX track_source ON tracks(source); CREATE TABLE favorites(track_id TEXT REFERENCES tracks(id) ON DELETE CASCADE); INSERT INTO tracks VALUES('old','qq'); INSERT INTO favorites VALUES('old');");
      expandMusicSourceConstraints(db);
      db.exec("INSERT INTO tracks VALUES('new','kugou')");
      expect(db.prepare('SELECT * FROM favorites').all()).toMatchObject([{ track_id: 'old' }]);
      expect(db.prepare("SELECT name FROM sqlite_master WHERE name='track_source'").get()).toBeTruthy();
      expect(() => db.exec("INSERT INTO favorites VALUES('missing')")).toThrow();
      expandMusicSourceConstraints(db);
      expect(db.prepare('SELECT count(*) AS total FROM tracks').get()).toMatchObject({ total: 2 });
    } finally { db.close(); }
  });
  it.each(SOURCES.filter(source => !['migu', 'netease', 'qq', 'kuwo', 'soda'].includes(source)))('passes %s ids unchanged through search and resolve', async source => {
    const fetcher = async (request: string | URL) => {
      const url = new URL(request);
      if (url.pathname.endsWith('/search')) return new Response(JSON.stringify({ code: 200, data: { songs: [{ source, id: 'original-id', name: '歌曲', artist: '歌手', duration: 180 }] } }));
      if (url.pathname.endsWith('/inspect')) return new Response(JSON.stringify({ valid: true, size: '5 MB' }));
      if (url.pathname.endsWith('/stream')) { const bytes = new Uint8Array(64); bytes.set([73, 68, 51]); return new Response(bytes, { status: 206, headers: { 'content-type': 'audio/mpeg', 'content-range': 'bytes 0-63/5000000' } }); }
      return new Response(JSON.stringify({ data: { lyric: '[00:01]歌词' } }));
    };
    const tracks = await searchWithGoMusicApi('歌曲', { baseUrl: 'http://127.0.0.1:8080', sources: [source], fetcher });
    expect(tracks).toHaveLength(1);
    expect(await resolveExactWithGoMusicApi(tracks[0], { baseUrl: 'http://127.0.0.1:8080', fetcher })).toMatchObject({ sourceTrackId: 'original-id', actualSource: source });
  });
});
