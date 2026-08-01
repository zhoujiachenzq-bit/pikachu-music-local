import { randomUUID } from 'node:crypto';
import type { Db } from './db.js';
import { transaction, upsertTrack } from './db.js';
import { fetchPublicPlaylist, parsePlaylistInput } from './sources.js';
import type { ImportJob, MusicSource } from '../shared/types.js';

const now = () => new Date().toISOString();

export function rowToImportJob(row: Record<string, unknown>): ImportJob {
  return {
    id: String(row.id), source: row.source as MusicSource, sourcePlaylistId: String(row.source_playlist_id),
    status: row.status as ImportJob['status'], progress: Number(row.progress), processed: Number(row.processed),
    total: Number(row.total), playlistId: row.playlist_id ? String(row.playlist_id) : null,
    message: String(row.message || ''), failures: JSON.parse(String(row.failures_json || '[]')),
    createdAt: String(row.created_at), updatedAt: String(row.updated_at)
  };
}

export function getImportJob(db: Db, userId: string, jobId: string): ImportJob | null {
  const row = db.prepare('SELECT * FROM import_jobs WHERE id=? AND user_id=?').get(jobId, userId) as Record<string, unknown> | undefined;
  return row ? rowToImportJob(row) : null;
}

export function listImportJobs(db: Db, userId: string): ImportJob[] {
  return (db.prepare('SELECT * FROM import_jobs WHERE user_id=? ORDER BY created_at DESC LIMIT 20').all(userId) as Record<string, unknown>[]).map(rowToImportJob);
}

export function createImportJob(db: Db, userId: string, input: string, explicitSource?: MusicSource, resolved?: { source: MusicSource; id: string }): ImportJob {
  const parsed = resolved || parsePlaylistInput(input, explicitSource);
  const id = randomUUID(); const stamp = now();
  db.prepare(`INSERT INTO import_jobs(id,user_id,source,source_playlist_id,input,status,created_at,updated_at)
    VALUES(?,?,?,?,?,'queued',?,?)`).run(id, userId, parsed.source, parsed.id, input.trim(), stamp, stamp);
  return getImportJob(db, userId, id)!;
}

function patchJob(db: Db, id: string, patch: Partial<{ status: string; progress: number; processed: number; total: number; playlistId: string | null; message: string; failures: unknown[] }>) {
  const current = db.prepare('SELECT * FROM import_jobs WHERE id=?').get(id) as Record<string, unknown> | undefined;
  if (!current) return;
  db.prepare(`UPDATE import_jobs SET status=?,progress=?,processed=?,total=?,playlist_id=?,message=?,failures_json=?,updated_at=? WHERE id=?`).run(
    String(patch.status ?? current.status), Number(patch.progress ?? current.progress), Number(patch.processed ?? current.processed), Number(patch.total ?? current.total),
    patch.playlistId === undefined ? (current.playlist_id == null ? null : String(current.playlist_id)) : patch.playlistId, String(patch.message ?? current.message),
    JSON.stringify(patch.failures ?? JSON.parse(String(current.failures_json || '[]'))), now(), id
  );
}

export async function runImportJob(db: Db, jobId: string): Promise<void> {
  const row = db.prepare('SELECT * FROM import_jobs WHERE id=?').get(jobId) as Record<string, unknown> | undefined;
  if (!row || row.status === 'running') return;
  patchJob(db, jobId, { status: 'running', progress: 3, message: '正在读取公开歌单…' });
  try {
    const source = row.source as MusicSource; const sourceId = String(row.source_playlist_id); const userId = String(row.user_id);
    const imported = await fetchPublicPlaylist(source, sourceId, (processed, total) => {
      patchJob(db, jobId, { processed, total, progress: Math.min(70, 10 + Math.round(processed / Math.max(total, 1) * 60)), message: `已读取 ${processed}/${total || '?'} 首` });
    });
    patchJob(db, jobId, { total: imported.tracks.length, progress: 74, message: '正在写入本地数据库…' });
    const failures: Array<{ track?: string; reason: string }> = [];
    let playlistId = '';
    transaction(db, () => {
      const existing = db.prepare(`SELECT id FROM playlists WHERE user_id=? AND source=? AND source_playlist_id=?`).get(userId, source, sourceId) as { id: string } | undefined;
      playlistId = existing?.id || randomUUID(); const stamp = now();
      if (existing) {
        db.prepare(`UPDATE playlists SET name=?,description=?,cover_url=?,source_url=?,last_synced_at=?,updated_at=? WHERE id=?`)
          .run(imported.title, imported.description, imported.coverUrl, imported.sourceUrl, stamp, stamp, playlistId);
      } else {
        db.prepare(`INSERT INTO playlists(id,user_id,name,description,cover_url,source,source_playlist_id,source_url,last_synced_at,created_at,updated_at)
          VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(playlistId, userId, imported.title, imported.description, imported.coverUrl, source, sourceId, imported.sourceUrl, stamp, stamp, stamp);
      }

      db.prepare(`DELETE FROM playlist_items WHERE playlist_id=? AND origin='source' AND excluded=0`).run(playlistId);
      const exclusions = new Set((db.prepare(`SELECT track_id FROM playlist_items WHERE playlist_id=? AND origin='source' AND excluded=1`).all(playlistId) as Array<{ track_id: string }>).map(v => v.track_id));
      let sourcePosition = 0;
      for (const item of imported.tracks) {
        try {
          const saved = upsertTrack(db, item);
          if (exclusions.has(saved.id)) continue;
          db.prepare(`INSERT INTO playlist_items(playlist_id,track_id,position,origin,excluded,created_at) VALUES(?,?,?,'source',0,?)
            ON CONFLICT(playlist_id,track_id) DO UPDATE SET position=excluded.position,excluded=0,
            origin=CASE WHEN playlist_items.origin='local' THEN 'local' ELSE 'source' END`)
            .run(playlistId, saved.id, sourcePosition++, stamp);
        } catch (error) { failures.push({ track: `${item.title} - ${item.artist}`, reason: error instanceof Error ? error.message : String(error) }); }
      }
      const localItems = db.prepare(`SELECT track_id FROM playlist_items WHERE playlist_id=? AND origin='local' AND excluded=0 ORDER BY position`).all(playlistId) as Array<{ track_id: string }>;
      localItems.forEach((item, index) => db.prepare('UPDATE playlist_items SET position=? WHERE playlist_id=? AND track_id=?').run(sourcePosition + index, playlistId, item.track_id));
    });
    patchJob(db, jobId, {
      status: failures.length ? 'partial' : 'completed', progress: 100, processed: imported.tracks.length - failures.length,
      total: imported.tracks.length, playlistId, failures,
      message: failures.length ? `已导入，${failures.length} 首写入失败。` : `已导入 ${imported.tracks.length} 首歌曲。`
    });
  } catch (error) {
    patchJob(db, jobId, { status: 'failed', progress: 100, message: error instanceof Error ? error.message : String(error), failures: [{ reason: error instanceof Error ? error.message : String(error) }] });
  }
}

export function retryImportJob(db: Db, userId: string, jobId: string): ImportJob | null {
  const old = db.prepare('SELECT * FROM import_jobs WHERE id=? AND user_id=?').get(jobId, userId) as Record<string, unknown> | undefined;
  if (!old) return null;
  return createImportJob(db, userId, String(old.input), old.source as MusicSource, { source: old.source as MusicSource, id: String(old.source_playlist_id) });
}

export function createSyncJob(db: Db, userId: string, playlistId: string): ImportJob | null {
  const playlist = db.prepare(`SELECT source,source_playlist_id,source_url FROM playlists WHERE id=? AND user_id=? AND source IS NOT NULL`).get(playlistId, userId) as Record<string, unknown> | undefined;
  if (!playlist) return null;
  return createImportJob(db, userId, String(playlist.source_url || playlist.source_playlist_id), playlist.source as MusicSource);
}
