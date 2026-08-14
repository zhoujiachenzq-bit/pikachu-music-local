import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import type { MusicSource, PlaylistDetail, PlaylistSummary, Track, User } from '../shared/types.js';
import { canonicalTrackKey } from '../shared/trackIdentity.js';

export type Db = DatabaseSync;

const now = () => new Date().toISOString();

export function createDatabase(filePath = process.env.PIKACHU_DB_PATH || resolve('data/pikachu-music.sqlite')): Db {
  if (filePath !== ':memory:') mkdirSync(dirname(filePath), { recursive: true });
  const db = new DatabaseSync(filePath);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL COLLATE NOCASE UNIQUE,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      language TEXT NOT NULL DEFAULT 'zh' CHECK(language IN ('zh','en')),
      volume REAL NOT NULL DEFAULT 0.8,
      play_mode TEXT NOT NULL DEFAULT 'list' CHECK(play_mode IN ('list','loop','shuffle')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_hash ON sessions(token_hash);
    CREATE TABLE IF NOT EXISTS tracks (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL CHECK(source IN ('migu','netease','qq','kuwo')),
      source_track_id TEXT NOT NULL,
      title TEXT NOT NULL,
      artist TEXT NOT NULL DEFAULT '',
      album TEXT NOT NULL DEFAULT '',
      duration INTEGER NOT NULL DEFAULT 0,
      cover_url TEXT,
      source_url TEXT,
      keyword TEXT,
      display_index INTEGER,
      quality TEXT,
      canonical_key TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(source, source_track_id)
    );
    CREATE TABLE IF NOT EXISTS favorites (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      PRIMARY KEY(user_id, track_id)
    );
    CREATE TABLE IF NOT EXISTS playlists (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      cover_url TEXT,
      source TEXT CHECK(source IS NULL OR source IN ('migu','netease','qq','kuwo')),
      source_playlist_id TEXT,
      source_url TEXT,
      origin_backup_id TEXT,
      last_synced_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(user_id, source, source_playlist_id),
      UNIQUE(user_id, origin_backup_id)
    );
    CREATE TABLE IF NOT EXISTS playlist_items (
      playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
      track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      origin TEXT NOT NULL DEFAULT 'local' CHECK(origin IN ('source','local')),
      excluded INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      PRIMARY KEY(playlist_id, track_id)
    );
    CREATE INDEX IF NOT EXISTS idx_playlist_items_order ON playlist_items(playlist_id, excluded, position);
    CREATE TABLE IF NOT EXISTS import_jobs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      source TEXT NOT NULL,
      source_playlist_id TEXT NOT NULL,
      input TEXT NOT NULL,
      status TEXT NOT NULL,
      progress INTEGER NOT NULL DEFAULT 0,
      processed INTEGER NOT NULL DEFAULT 0,
      total INTEGER NOT NULL DEFAULT 0,
      playlist_id TEXT REFERENCES playlists(id) ON DELETE SET NULL,
      message TEXT NOT NULL DEFAULT '',
      failures_json TEXT NOT NULL DEFAULT '[]',
      retry_of_job_id TEXT,
      retry_track_ids_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS login_attempts (
      attempt_key TEXT PRIMARY KEY,
      count INTEGER NOT NULL,
      reset_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS rate_limits (
      bucket_key TEXT PRIMARY KEY,
      count INTEGER NOT NULL,
      reset_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS listening_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
      context_type TEXT NOT NULL CHECK(context_type IN ('search','favorites','playlist','daily','unknown')),
      context_id TEXT,
      actual_source TEXT CHECK(actual_source IS NULL OR actual_source IN ('migu','netease','qq','kuwo')),
      started_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      played_ms INTEGER NOT NULL DEFAULT 0,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      completed INTEGER NOT NULL DEFAULT 0,
      skipped INTEGER NOT NULL DEFAULT 0,
      error_code TEXT
      ,origin_backup_id TEXT
      ,UNIQUE(user_id,origin_backup_id)
    );
    CREATE INDEX IF NOT EXISTS idx_listening_user_time ON listening_sessions(user_id,updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_listening_user_track ON listening_sessions(user_id,track_id);
    CREATE TABLE IF NOT EXISTS recommendation_feedback (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      canonical_key TEXT NOT NULL,
      action TEXT NOT NULL CHECK(action IN ('not_interested','less_artist')),
      artist_key TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(user_id,canonical_key,action)
    );
    CREATE TABLE IF NOT EXISTS recommendation_runs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      recommendation_date TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('queued','running','completed','failed')),
      message TEXT NOT NULL DEFAULT '',
      generated_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(user_id,recommendation_date)
    );
    CREATE TABLE IF NOT EXISTS recommendation_items (
      run_id TEXT NOT NULL REFERENCES recommendation_runs(id) ON DELETE CASCADE,
      track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
      rank INTEGER NOT NULL,
      score REAL NOT NULL,
      reason TEXT NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('familiar','explore')),
      PRIMARY KEY(run_id,track_id),
      UNIQUE(run_id,rank)
    );
    CREATE INDEX IF NOT EXISTS idx_recommendation_user_date ON recommendation_runs(user_id,recommendation_date DESC);
    CREATE TABLE IF NOT EXISTS source_cache (
      cache_key TEXT PRIMARY KEY,
      payload_json TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS source_health (
      source TEXT NOT NULL CHECK(source IN ('migu','netease','qq','kuwo')),
      operation TEXT NOT NULL CHECK(operation IN ('search','resolve','playlist')),
      successes INTEGER NOT NULL DEFAULT 0,
      failures INTEGER NOT NULL DEFAULT 0,
      consecutive_failures INTEGER NOT NULL DEFAULT 0,
      average_latency_ms INTEGER NOT NULL DEFAULT 0,
      circuit_open_until TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(source,operation)
    );
  `);
  const trackColumns = new Set((db.prepare('PRAGMA table_info(tracks)').all() as Array<{ name: string }>).map(column => column.name));
  if (!trackColumns.has('keyword')) db.exec('ALTER TABLE tracks ADD COLUMN keyword TEXT');
  if (!trackColumns.has('display_index')) db.exec('ALTER TABLE tracks ADD COLUMN display_index INTEGER');
  if (!trackColumns.has('quality')) db.exec('ALTER TABLE tracks ADD COLUMN quality TEXT');
  if (!trackColumns.has('canonical_key')) db.exec("ALTER TABLE tracks ADD COLUMN canonical_key TEXT NOT NULL DEFAULT ''");
  const importColumns = new Set((db.prepare('PRAGMA table_info(import_jobs)').all() as Array<{ name: string }>).map(column => column.name));
  if (!importColumns.has('retry_of_job_id')) db.exec('ALTER TABLE import_jobs ADD COLUMN retry_of_job_id TEXT');
  if (!importColumns.has('retry_track_ids_json')) db.exec("ALTER TABLE import_jobs ADD COLUMN retry_track_ids_json TEXT NOT NULL DEFAULT '[]'");
  const listeningColumns = new Set((db.prepare('PRAGMA table_info(listening_sessions)').all() as Array<{ name: string }>).map(column => column.name));
  if (!listeningColumns.has('origin_backup_id')) db.exec('ALTER TABLE listening_sessions ADD COLUMN origin_backup_id TEXT');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_listening_backup_origin ON listening_sessions(user_id,origin_backup_id) WHERE origin_backup_id IS NOT NULL');
  const tracksWithoutCanonicalKey = db.prepare("SELECT id,title,artist FROM tracks WHERE canonical_key='' OR canonical_key IS NULL").all() as Array<{ id: string; title: string; artist: string }>;
  const updateCanonicalKey = db.prepare('UPDATE tracks SET canonical_key=? WHERE id=?');
  for (const item of tracksWithoutCanonicalKey) updateCanonicalKey.run(canonicalTrackKey(item.title, item.artist), item.id);
  db.exec('CREATE INDEX IF NOT EXISTS idx_tracks_canonical_key ON tracks(canonical_key)');
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now());
  db.prepare('DELETE FROM source_cache WHERE expires_at <= ?').run(now());
  db.prepare('DELETE FROM login_attempts WHERE reset_at <= ?').run(now());
  db.prepare('DELETE FROM rate_limits WHERE reset_at <= ?').run(now());
  db.prepare("UPDATE recommendation_runs SET status='failed',message='服务重启，可重新生成',updated_at=? WHERE status IN ('queued','running')").run(now());
  return db;
}

export function transaction<T>(db: Db, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const value = fn();
    db.exec('COMMIT');
    return value;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function rowToUser(row: Record<string, unknown>): User {
  return {
    id: String(row.id), username: String(row.username), language: row.language as 'zh' | 'en',
    volume: Number(row.volume), playMode: row.play_mode as User['playMode'], createdAt: String(row.created_at)
  };
}

export function upsertTrack(db: Db, track: Track): Track {
  const stamp = now();
  const id = `${track.source}:${track.sourceTrackId}`;
  const canonicalKey = track.canonicalKey || canonicalTrackKey(track.title, track.artist);
  db.prepare(`INSERT INTO tracks(id,source,source_track_id,title,artist,album,duration,cover_url,source_url,keyword,display_index,quality,canonical_key,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(source,source_track_id) DO UPDATE SET
    title=excluded.title,artist=excluded.artist,album=excluded.album,duration=excluded.duration,
    cover_url=COALESCE(excluded.cover_url,tracks.cover_url),source_url=COALESCE(excluded.source_url,tracks.source_url),
    keyword=COALESCE(excluded.keyword,tracks.keyword),display_index=COALESCE(excluded.display_index,tracks.display_index),quality=COALESCE(excluded.quality,tracks.quality),canonical_key=excluded.canonical_key,updated_at=excluded.updated_at`)
    .run(id, track.source, track.sourceTrackId, track.title, track.artist, track.album, track.duration || 0,
      track.coverUrl || null, track.sourceUrl || null, track.keyword || null, track.displayIndex || null, track.quality || null, canonicalKey, stamp, stamp);
  return { ...track, id, canonicalKey };
}

export function rowToTrack(row: Record<string, unknown>): Track {
  const source = row.source as MusicSource; const sourceTrackId = String(row.source_track_id); let keyword = row.keyword ? String(row.keyword) : undefined; let displayIndex = row.display_index ? Number(row.display_index) : undefined;
  if (source === 'migu' && !keyword) { const match = sourceTrackId.match(/^search-(\d+)-(.+)$/); if (match) { displayIndex ||= Number(match[1]); try { keyword = decodeURIComponent(match[2]); } catch { keyword = match[2]; } } }
  return {
    id: String(row.id), source, sourceTrackId,
    title: String(row.title), artist: String(row.artist || ''), album: String(row.album || ''),
    duration: Number(row.duration || 0), coverUrl: row.cover_url ? String(row.cover_url) : null,
    sourceUrl: row.source_url ? String(row.source_url) : null, keyword, displayIndex,
    quality: row.quality ? String(row.quality) : null,
    canonicalKey: row.canonical_key ? String(row.canonical_key) : canonicalTrackKey(String(row.title), String(row.artist || ''))
  };
}

export function listFavorites(db: Db, userId: string): Track[] {
  return (db.prepare(`SELECT t.* FROM favorites f JOIN tracks t ON t.id=f.track_id
    WHERE f.user_id=? ORDER BY f.created_at DESC`).all(userId) as Record<string, unknown>[]).map(rowToTrack);
}

export function listPlaylists(db: Db, userId: string): PlaylistSummary[] {
  const rows = db.prepare(`SELECT p.*, COUNT(CASE WHEN pi.excluded=0 THEN 1 END) track_count
    FROM playlists p LEFT JOIN playlist_items pi ON pi.playlist_id=p.id
    WHERE p.user_id=? GROUP BY p.id ORDER BY p.updated_at DESC`).all(userId) as Record<string, unknown>[];
  return rows.map(rowToPlaylistSummary);
}

export function rowToPlaylistSummary(row: Record<string, unknown>): PlaylistSummary {
  return {
    id: String(row.id), name: String(row.name), description: String(row.description || ''),
    coverUrl: row.cover_url ? String(row.cover_url) : null, source: (row.source as MusicSource | null) || null,
    sourcePlaylistId: row.source_playlist_id ? String(row.source_playlist_id) : null,
    sourceUrl: row.source_url ? String(row.source_url) : null,
    lastSyncedAt: row.last_synced_at ? String(row.last_synced_at) : null,
    trackCount: Number(row.track_count || 0), createdAt: String(row.created_at), updatedAt: String(row.updated_at)
  };
}

export function getPlaylist(db: Db, userId: string, playlistId: string): PlaylistDetail | null {
  const row = db.prepare(`SELECT p.*, COUNT(CASE WHEN pi.excluded=0 THEN 1 END) track_count
    FROM playlists p LEFT JOIN playlist_items pi ON pi.playlist_id=p.id
    WHERE p.id=? AND p.user_id=? GROUP BY p.id`).get(playlistId, userId) as Record<string, unknown> | undefined;
  if (!row) return null;
  const tracks = (db.prepare(`SELECT t.*,pi.position,pi.origin,pi.excluded FROM playlist_items pi
    JOIN tracks t ON t.id=pi.track_id WHERE pi.playlist_id=? ORDER BY pi.excluded,pi.position`).all(playlistId) as Record<string, unknown>[])
    .map(item => ({ ...rowToTrack(item), position: Number(item.position), origin: item.origin as 'source' | 'local', excluded: Boolean(item.excluded) }));
  return { ...rowToPlaylistSummary(row), tracks };
}

export function createLocalPlaylist(db: Db, userId: string, name: string, description = ''): PlaylistSummary {
  const id = randomUUID(); const stamp = now();
  db.prepare(`INSERT INTO playlists(id,user_id,name,description,created_at,updated_at) VALUES(?,?,?,?,?,?)`)
    .run(id, userId, name.trim(), description.trim(), stamp, stamp);
  return getPlaylist(db, userId, id)!;
}

export function getCached<T>(db: Db, key: string): T | null {
  const row = db.prepare('SELECT payload_json FROM source_cache WHERE cache_key=? AND expires_at>?').get(key, now()) as { payload_json: string } | undefined;
  if (!row) return null;
  try { return JSON.parse(row.payload_json) as T; } catch { return null; }
}

export function setCached(db: Db, key: string, value: unknown, ttlMs: number): void {
  const expires = new Date(Date.now() + ttlMs).toISOString();
  db.prepare(`INSERT INTO source_cache(cache_key,payload_json,expires_at) VALUES(?,?,?)
    ON CONFLICT(cache_key) DO UPDATE SET payload_json=excluded.payload_json,expires_at=excluded.expires_at`)
    .run(key, JSON.stringify(value), expires);
  db.prepare('DELETE FROM source_cache WHERE expires_at<=?').run(now());
  const count = Number((db.prepare('SELECT COUNT(*) count FROM source_cache').get() as { count: number }).count);
  if (count > 2500) db.prepare('DELETE FROM source_cache WHERE cache_key IN (SELECT cache_key FROM source_cache ORDER BY expires_at LIMIT ?)').run(count - 2500);
}
