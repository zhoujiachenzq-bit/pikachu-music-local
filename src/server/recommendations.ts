import { randomUUID } from 'node:crypto';
import { canonicalTrackKey, isDerivativeTrackVersion, normalizeTrackText, trackFamilyKey, trackVersionPreference } from '../shared/trackIdentity.js';
import { SOURCES, SEARCH_SOURCES, type DailyRecommendation, type RecommendedTrack, type Track } from '../shared/types.js';
import { rowToTrack, transaction, upsertTrack, type Db } from './db.js';
import { listSourceHealth } from './sourceHealth.js';
import { resolveTrackWithFallback, searchAll } from './sources.js';
import { positiveEnvInt } from './rateLimit.js';

const activeRuns = new Set<string>();
const now = () => new Date().toISOString();

interface Candidate {
  track: Track;
  canonicalKey: string;
  familyKey: string;
  versionPreference: number;
  artistKey: string;
  score: number;
  reason: string;
  kind: 'familiar' | 'explore';
  affinity?: number;
}

export interface RecommendationDependencies {
  discover: (query: string) => Promise<Track[]>;
  preflight: (track: Track) => Promise<boolean>;
}

export async function mapWithConcurrency<T, R>(values: T[], concurrency: number, worker: (value: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(values.length); let cursor = 0;
  const runners = Array.from({ length: Math.min(values.length, Math.max(1, concurrency)) }, async () => {
    while (cursor < values.length) {
      const index = cursor; cursor += 1; results[index] = await worker(values[index], index);
    }
  });
  await Promise.all(runners); return results;
}

function seededJitter(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) { hash ^= value.charCodeAt(index); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0) % 1000 / 100;
}

function sourceWeights(db: Db) {
  const result = new Map<string, number>();
  const health = listSourceHealth(db);
  for (const source of SOURCES) {
    const rows = health.filter(item => item.source === source);
    if (!rows.length) { result.set(source, 1); continue; }
    const successes = rows.reduce((sum, item) => sum + item.successes, 0); const failures = rows.reduce((sum, item) => sum + item.failures, 0);
    const open = rows.some(item => item.circuitOpenUntil && Date.parse(item.circuitOpenUntil) > Date.now());
    result.set(source, open ? 0.25 : Math.max(0.55, Math.min(1.15, 0.7 + successes / Math.max(1, successes + failures) * 0.45)));
  }
  return result;
}

const dayMs = 86_400_000;
const dateEnd = (date: string) => Date.parse(`${date}T23:59:59.999Z`);
interface ListeningSignal { positive: number; negative: number; }

function listeningSignals(db: Db, userId: string, date: string) {
  const signals = new Map<string, ListeningSignal>();
  const rows = db.prepare(`SELECT t.canonical_key,ls.played_ms,ls.duration_ms,ls.completed,ls.skipped,ls.updated_at
    FROM listening_sessions ls JOIN tracks t ON t.id=ls.track_id
    WHERE ls.user_id=? AND ls.error_code IS NULL AND ls.updated_at<=?
    ORDER BY ls.updated_at DESC LIMIT 5000`).all(userId, new Date(dateEnd(date)).toISOString()) as Record<string, unknown>[];
  for (const row of rows) {
    const age = Math.max(0, (dateEnd(date) - Date.parse(String(row.updated_at))) / dayMs);
    if (!Number.isFinite(age)) continue;
    const duration = Number(row.duration_ms); const ratio = duration > 0 ? Math.min(1, Math.max(0, Number(row.played_ms) / duration)) : 0;
    const key = String(row.canonical_key); const signal = signals.get(key) || { positive: 0, negative: 0 };
    signal.positive += (Number(row.completed) ? 8 : ratio >= .5 ? ratio * 5 : 0) * 2 ** (-age / 30);
    // A network error or a skip near the end is not a dislike.
    if (Number(row.skipped) && !Number(row.completed) && duration > 0 && ratio < .2) signal.negative += 10 * 2 ** (-age / 14);
    signals.set(key, signal);
  }
  return signals;
}

function recentExposure(db: Db, userId: string, date: string) {
  const result = new Map<string, number>();
  const rows = db.prepare(`SELECT t.canonical_key,rr.recommendation_date FROM recommendation_items ri
    JOIN recommendation_runs rr ON rr.id=ri.run_id JOIN tracks t ON t.id=ri.track_id
    WHERE rr.user_id=? AND rr.status='completed' AND rr.recommendation_date<? AND rr.recommendation_date>=?`)
    .all(userId, date, new Date(dateEnd(date) - 7 * dayMs).toISOString().slice(0, 10)) as Array<{ canonical_key: string; recommendation_date: string }>;
  for (const row of rows) {
    const age = (dateEnd(date) - dateEnd(row.recommendation_date)) / dayMs;
    result.set(row.canonical_key, (result.get(row.canonical_key) || 0) + 22 * 2 ** (-(age - 1) / 2));
  }
  return result;
}

function localCandidates(db: Db, userId: string, date: string, signals: Map<string, ListeningSignal>): Candidate[] {
  const rows = db.prepare(`SELECT t.*,
    EXISTS(SELECT 1 FROM favorites f WHERE f.user_id=? AND f.track_id=t.id) favorite,
    (SELECT COUNT(*) FROM playlist_items pi JOIN playlists p ON p.id=pi.playlist_id WHERE p.user_id=? AND pi.track_id=t.id AND pi.excluded=0) playlist_count,
    (SELECT MAX(updated_at) FROM listening_sessions ls WHERE ls.user_id=? AND ls.track_id=t.id AND ls.error_code IS NULL AND ls.updated_at<=?) last_listened
    FROM tracks t WHERE EXISTS(SELECT 1 FROM favorites f WHERE f.user_id=? AND f.track_id=t.id)
      OR EXISTS(SELECT 1 FROM playlist_items pi JOIN playlists p ON p.id=pi.playlist_id WHERE p.user_id=? AND pi.track_id=t.id AND pi.excluded=0)
      OR EXISTS(SELECT 1 FROM listening_sessions ls WHERE ls.user_id=? AND ls.track_id=t.id)
    ORDER BY favorite DESC, last_listened DESC,t.id LIMIT 1500`).all(userId, userId, userId, new Date(dateEnd(date)).toISOString(), userId, userId, userId) as Record<string, unknown>[];
  const weights = sourceWeights(db);
  return rows.map(row => {
    const track = rowToTrack(row); const favorite = Boolean(row.favorite); const playlists = Number(row.playlist_count || 0);
    const signal = signals.get(track.canonicalKey || '') || { positive: 0, negative: 0 };
    let score = (favorite ? 42 : 0) + Math.min(24, playlists * 8) + Math.min(36, signal.positive) - Math.min(40, signal.negative);
    if (favorite && !row.last_listened) score += 16;
    if (row.last_listened) { const ageDays = (dateEnd(date) - Date.parse(String(row.last_listened))) / dayMs; if (ageDays > 30) score += 10; }
    score = score * (weights.get(track.source) || 1) + seededJitter(`${date}|${track.canonicalKey || track.id}`) / 5;
    const reason = favorite && !row.last_listened ? '收藏中还没认真听过' : signal.positive > 0 ? '根据你认真听过的歌曲' : playlists > 0 ? '来自你的歌单' : '根据播放记录';
    return {
      track, canonicalKey: track.canonicalKey || canonicalTrackKey(track.title, track.artist), familyKey: trackFamilyKey(track.title),
      versionPreference: trackVersionPreference(track.title, track.album), artistKey: normalizeTrackText(track.artist), score, reason, kind: 'familiar' as const,
      affinity: Math.max(0, (favorite ? 4 : 0) + Math.min(.3, playlists * .15) + Math.min(10, signal.positive / 4) - signal.negative / 3)
    };
  });
}

function collapseRecommendationVersions(candidates: Candidate[]): Candidate[] {
  const families = new Map<string, Candidate[]>();
  for (const candidate of candidates) {
    if (isDerivativeTrackVersion(candidate.track.title, candidate.track.album)) continue;
    const family = families.get(candidate.familyKey) || [];
    family.push(candidate); families.set(candidate.familyKey, family);
  }
  return [...families.values()].flatMap(family => {
    const plainTitles = family.filter(item => item.versionPreference === 0);
    if (plainTitles.length) return plainTitles;
    return [...family].sort((a, b) => a.versionPreference - b.versionPreference || b.score - a.score).slice(0, 1);
  });
}

function collapseStoredRecommendationVersions(tracks: RecommendedTrack[]): RecommendedTrack[] {
  const families = new Map<string, RecommendedTrack[]>();
  for (const track of tracks) {
    if (isDerivativeTrackVersion(track.title, track.album)) continue;
    const key = trackFamilyKey(track.title); const family = families.get(key) || [];
    family.push(track); families.set(key, family);
  }
  return [...families.values()]
    .map(family => [...family].sort((a, b) => trackVersionPreference(a.title, a.album) - trackVersionPreference(b.title, b.album) || a.rank - b.rank)[0])
    .sort((a, b) => a.rank - b.rank)
    .map((track, index) => ({ ...track, rank: index + 1 }));
}

function excludedKeys(db: Db, userId: string, date: string) {
  const canonical = new Set<string>(); const feedback = new Set<string>(); const artists = new Set<string>();
  for (const row of db.prepare('SELECT canonical_key,action,artist_key FROM recommendation_feedback WHERE user_id=?').all(userId) as Array<{ canonical_key: string; action: string; artist_key: string | null }>) {
    if (row.action === 'not_interested') { canonical.add(row.canonical_key); feedback.add(row.canonical_key); }
    if (row.action === 'less_artist' && row.artist_key) artists.add(row.artist_key);
  }
  const cutoff = new Date(dateEnd(date) - 7 * dayMs).toISOString();
  for (const row of db.prepare(`SELECT DISTINCT t.canonical_key FROM listening_sessions ls JOIN tracks t ON t.id=ls.track_id
    WHERE ls.user_id=? AND ls.completed=1 AND ls.error_code IS NULL AND ls.updated_at>=? AND ls.updated_at<=?`).all(userId, cutoff, new Date(dateEnd(date)).toISOString()) as Array<{ canonical_key: string }>) canonical.add(row.canonical_key);
  return { canonical, artists, feedback };
}

async function pickPlayable(pool: Candidate[], target: number, selected: Candidate[], deps: RecommendationDependencies, concurrency: number) {
  const artistCounts = new Map<string, number>(); selected.forEach(item => artistCounts.set(item.artistKey, (artistCounts.get(item.artistKey) || 0) + 1));
  const selectedKeys = new Set(selected.map(item => item.canonicalKey));
  const selectedFamilies = new Set(selected.map(item => item.familyKey));
  for (let offset = 0; offset < pool.length && selected.length < target; offset += 5) {
    const batch = pool.slice(offset, offset + 5).filter(item => !selectedKeys.has(item.canonicalKey) && !selectedFamilies.has(item.familyKey) && (!item.artistKey || (artistCounts.get(item.artistKey) || 0) < 2));
    const playable = await mapWithConcurrency(batch, concurrency, async item => ({ item, ok: await deps.preflight(item.track).catch(() => false) }));
    for (const { item, ok } of playable) {
      if (!ok || selected.length >= target || selectedKeys.has(item.canonicalKey) || selectedFamilies.has(item.familyKey) || (item.artistKey && (artistCounts.get(item.artistKey) || 0) >= 2)) continue;
      selected.push(item); selectedKeys.add(item.canonicalKey); selectedFamilies.add(item.familyKey); if (item.artistKey) artistCounts.set(item.artistKey, (artistCounts.get(item.artistKey) || 0) + 1);
    }
  }
}

function tasteProfile(local: Candidate[]) {
  const artists = new Map<string, number>(); const albums = new Map<string, number>();
  const names = new Map<string, string>();
  for (const item of local) {
    const weight = item.affinity || 0;
    if (!item.artistKey || !weight) continue;
    artists.set(item.artistKey, Math.min(120, (artists.get(item.artistKey) || 0) + Math.min(20, weight)));
    names.set(item.artistKey, item.track.artist);
    if (item.track.album) {
      const key = `${item.artistKey}|${normalizeTrackText(item.track.album)}`;
      albums.set(key, Math.min(20, (albums.get(key) || 0) + weight / 4));
    }
  }
  return { artists, albums, names };
}

function interleave(selected: Candidate[]) {
  const remaining = [...selected]; const ordered: Candidate[] = [];
  while (remaining.length) {
    const preferred = [2, 5, 8].includes(ordered.length % 10) ? 'explore' : 'familiar';
    const previous = ordered.at(-1)?.artistKey;
    let index = remaining.findIndex(item => item.kind === preferred && (!previous || item.artistKey !== previous));
    if (index < 0) index = remaining.findIndex(item => !previous || item.artistKey !== previous);
    if (index < 0) index = 0;
    ordered.push(remaining.splice(index, 1)[0]);
  }
  return ordered;
}

export async function generateDailyRecommendation(db: Db, userId: string, date: string, dependencies?: RecommendationDependencies): Promise<DailyRecommendation> {
  let run = db.prepare('SELECT id FROM recommendation_runs WHERE user_id=? AND recommendation_date=?').get(userId, date) as { id: string } | undefined;
  if (!run) { const id = randomUUID(); const stamp = now(); db.prepare("INSERT INTO recommendation_runs(id,user_id,recommendation_date,status,created_at,updated_at) VALUES(?,?,?,'queued',?,?)").run(id, userId, date, stamp, stamp); run = { id }; }
  db.prepare("UPDATE recommendation_runs SET status='running',message='正在分析本地收听偏好…',updated_at=? WHERE id=?").run(now(), run.id);
  try {
    const localByKey = new Map<string, Candidate>();
    for (const candidate of localCandidates(db, userId, date, listeningSignals(db, userId, date))) {
      const previous = localByKey.get(candidate.canonicalKey);
      if (!previous || candidate.score > previous.score) localByKey.set(candidate.canonicalKey, candidate);
    }
    const local = [...localByKey.values()];
    const exclusions = excludedKeys(db, userId, date);
    const profile = tasteProfile(local.filter(item => !exclusions.artists.has(item.artistKey) && !exclusions.feedback.has(item.canonicalKey)));
    const topArtists = [...profile.artists].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 2).map(([key]) => profile.names.get(key)!);
    const broad = ['华语热歌', '流行音乐', '经典歌曲', '新歌推荐', '轻音乐', '摇滚', '民谣']; const daySeed = [...date].reduce((sum, char) => sum + char.charCodeAt(0), 0);
    const queries = [...new Set([...topArtists, ...Array.from({ length: topArtists.length ? 1 : 3 }, (_, index) => broad[(daySeed + index * 2) % broad.length])])];
    const providers = dependencies || {
      discover: async (query: string) => (await searchAll(db, query, [...SEARCH_SOURCES], 12)).tracks,
      // The phone skips this check: resolving 30 songs one by one kept the list empty for minutes.
      preflight: async (track: Track) => { if (process.env.RECOMMENDATION_SKIP_PREFLIGHT) return true; await resolveTrackWithFallback(track, db); return true; }
    };
    const probes = new Map<string, Promise<boolean>>();
    const deps: RecommendationDependencies = { discover: providers.discover, preflight: track => {
      let pending = probes.get(track.id);
      if (!pending) { pending = Promise.resolve().then(() => providers.preflight(track)).catch(() => false); probes.set(track.id, pending); }
      return pending;
    } };
    const discoverConcurrency = positiveEnvInt('RECOMMENDATION_DISCOVERY_CONCURRENCY', 2, 1, 4);
    const preflightConcurrency = positiveEnvInt('RECOMMENDATION_PREFLIGHT_CONCURRENCY', 2, 1, 3);
    const discoveryResults = await mapWithConcurrency(queries, discoverConcurrency, async query => deps.discover(query).catch(() => []));
    const discoveries = discoveryResults.flat();
    const weights = sourceWeights(db); const exposure = recentExposure(db, userId, date); const byCanonical = new Map<string, Candidate>();
    for (const item of local) byCanonical.set(item.canonicalKey, item);
    for (const discovered of discoveries) {
      if (isDerivativeTrackVersion(discovered.title, discovered.album)) continue;
      const saved = upsertTrack(db, discovered); const key = saved.canonicalKey || canonicalTrackKey(saved.title, saved.artist); if (byCanonical.has(key)) continue;
      byCanonical.set(key, {
        track: saved, canonicalKey: key, familyKey: trackFamilyKey(saved.title), versionPreference: trackVersionPreference(saved.title, saved.album),
        artistKey: normalizeTrackText(saved.artist), kind: 'explore', reason: profile.artists.has(normalizeTrackText(saved.artist)) ? '根据你的歌手偏好' : '今日新鲜探索',
        score: 30 * (weights.get(saved.source) || 1) + seededJitter(`${date}|${key}`) / 5
          + Math.min(20, (profile.artists.get(normalizeTrackText(saved.artist)) || 0) * 3)
          + (profile.albums.get(`${normalizeTrackText(saved.artist)}|${normalizeTrackText(saved.album)}`) || 0)
      });
    }
    const pool = collapseRecommendationVersions([...byCanonical.values()]).filter(item => !exclusions.canonical.has(item.canonicalKey) && !exclusions.artists.has(item.artistKey))
      .map(item => ({ ...item, score: item.score - Math.min(45, exposure.get(item.canonicalKey) || 0) }));
    const familiar = pool.filter(item => item.kind === 'familiar').sort((a, b) => b.score - a.score); const explore = pool.filter(item => item.kind === 'explore').sort((a, b) => b.score - a.score);
    const selected: Candidate[] = [];
    await pickPlayable(familiar, 21, selected, deps, preflightConcurrency);
    await pickPlayable(explore, Math.min(30, selected.length + 9), selected, deps, preflightConcurrency);
    await pickPlayable([...familiar, ...explore].sort((a, b) => b.score - a.score), 30, selected, deps, preflightConcurrency);
    const stamp = now();
    transaction(db, () => {
      db.prepare('DELETE FROM recommendation_items WHERE run_id=?').run(run!.id);
      interleave(selected).forEach((item, index) => db.prepare('INSERT INTO recommendation_items(run_id,track_id,rank,score,reason,kind) VALUES(?,?,?,?,?,?)').run(run!.id, item.track.id, index + 1, item.score, item.reason, item.kind));
      db.prepare("UPDATE recommendation_runs SET status='completed',message=?,generated_at=?,updated_at=? WHERE id=?").run(selected.length >= 30 ? '今日 30 首已生成' : `已生成 ${selected.length} 首推荐候选`, stamp, stamp, run!.id);
      db.prepare(`DELETE FROM recommendation_runs WHERE user_id=? AND id NOT IN (
        SELECT id FROM recommendation_runs WHERE user_id=? ORDER BY recommendation_date DESC LIMIT 7
      )`).run(userId, userId);
    });
  } catch (error) {
    db.prepare("UPDATE recommendation_runs SET status='failed',message=?,updated_at=? WHERE id=?").run(error instanceof Error ? error.message : String(error), now(), run.id);
  }
  return getDailyRecommendation(db, userId, date)!;
}

export function getDailyRecommendation(db: Db, userId: string, date: string): DailyRecommendation | null {
  const row = db.prepare('SELECT * FROM recommendation_runs WHERE user_id=? AND recommendation_date=?').get(userId, date) as Record<string, unknown> | undefined;
  if (!row) return null;
  const storedTracks = (db.prepare(`SELECT t.*,ri.rank,ri.score,ri.reason,ri.kind FROM recommendation_items ri JOIN tracks t ON t.id=ri.track_id
    WHERE ri.run_id=? AND NOT EXISTS (
      SELECT 1 FROM recommendation_feedback rf WHERE rf.user_id=? AND rf.action='not_interested' AND rf.canonical_key=t.canonical_key
    ) ORDER BY ri.rank`).all(String(row.id), userId) as Record<string, unknown>[]).map(item => ({ ...rowToTrack(item), rank: Number(item.rank), score: Number(item.score), reason: String(item.reason), kind: item.kind as RecommendedTrack['kind'] }));
  const hiddenArtists = new Set((db.prepare("SELECT artist_key FROM recommendation_feedback WHERE user_id=? AND action='less_artist'").all(userId) as Array<{ artist_key: string }>).map(item => item.artist_key));
  const tracks = collapseStoredRecommendationVersions(storedTracks.filter(track => !hiddenArtists.has(normalizeTrackText(track.artist))));
  return { id: String(row.id), date: String(row.recommendation_date), status: row.status as DailyRecommendation['status'], generatedAt: row.generated_at ? String(row.generated_at) : null, message: String(row.message || ''), tracks };
}

export function listRecommendationHistory(db: Db, userId: string): DailyRecommendation[] {
  const dates = db.prepare("SELECT recommendation_date FROM recommendation_runs WHERE user_id=? AND status='completed' ORDER BY recommendation_date DESC LIMIT 7").all(userId) as Array<{ recommendation_date: string }>;
  return dates.map(row => getDailyRecommendation(db, userId, row.recommendation_date)).filter((value): value is DailyRecommendation => Boolean(value));
}

export function startDailyGeneration(db: Db, userId: string, date: string) {
  const key = `${userId}:${date}`; if (activeRuns.has(key)) return;
  activeRuns.add(key); void generateDailyRecommendation(db, userId, date).finally(() => activeRuns.delete(key));
}
