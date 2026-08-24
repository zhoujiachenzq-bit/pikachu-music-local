import type { ResolvedTrack } from '../shared/types';

const STORAGE_KEY = 'pikachu-music.playback-cache.v2';
const LEGACY_STORAGE_KEY = 'pikachu-music.playback-cache.v1';
export const RESOLVED_TTL_MS = 15 * 60_000;
export const LYRIC_TTL_MS = 7 * 24 * 60 * 60_000;
const MAX_RESOLVED = 24;
const MAX_LYRICS = 120;

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  usedAt: number;
}

interface StoredPlaybackCache {
  resolved: Array<[string, CacheEntry<ResolvedTrack>]>;
  lyrics: Array<[string, CacheEntry<string>]>;
}

function validEntry<T>(value: unknown, validValue: (candidate: unknown) => candidate is T): value is CacheEntry<T> {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<CacheEntry<unknown>>;
  return typeof entry.expiresAt === 'number' && typeof entry.usedAt === 'number' && validValue(entry.value);
}

function validResolved(value: unknown): value is ResolvedTrack {
  if (!value || typeof value !== 'object') return false;
  const track = value as Partial<ResolvedTrack>;
  return typeof track.id === 'string' && typeof track.audioUrl === 'string'
    && (/^https?:\/\//i.test(track.audioUrl) || track.audioUrl.startsWith('/api/backup-media?'));
}

function restoreMap<T>(value: unknown, validValue: (candidate: unknown) => candidate is T) {
  const result = new Map<string, CacheEntry<T>>();
  if (!Array.isArray(value)) return result;
  for (const item of value) {
    if (!Array.isArray(item) || typeof item[0] !== 'string' || !validEntry(item[1], validValue)) continue;
    result.set(item[0], item[1]);
  }
  return result;
}

function trim<T>(values: Map<string, CacheEntry<T>>, limit: number) {
  if (values.size <= limit) return;
  const oldest = [...values.entries()].sort((a, b) => a[1].usedAt - b[1].usedAt).slice(0, values.size - limit);
  oldest.forEach(([key]) => values.delete(key));
}

export class PlaybackCache {
  private resolved = new Map<string, CacheEntry<ResolvedTrack>>();
  private lyrics = new Map<string, CacheEntry<string>>();

  constructor(private storage?: StorageLike, private clock: () => number = Date.now) {
    if (!storage) return;
    try {
      const parsed = JSON.parse(storage.getItem(STORAGE_KEY) || 'null') as Partial<StoredPlaybackCache> | null;
      this.resolved = restoreMap(parsed?.resolved, validResolved);
      if (parsed) this.lyrics = restoreMap(parsed.lyrics, (value): value is string => typeof value === 'string' && Boolean(value.trim()));
      else {
        const legacy = JSON.parse(storage.getItem(LEGACY_STORAGE_KEY) || 'null') as Partial<StoredPlaybackCache> | null;
        this.lyrics = restoreMap(legacy?.lyrics, (value): value is string => typeof value === 'string' && Boolean(value.trim()));
      }
      this.removeExpired(false);
    } catch {
      this.resolved.clear(); this.lyrics.clear();
    }
  }

  getResolved(trackId: string): ResolvedTrack | null {
    const entry = this.resolved.get(trackId);
    if (!entry || entry.expiresAt <= this.clock()) {
      if (entry) { this.resolved.delete(trackId); this.persist(); }
      return null;
    }
    entry.usedAt = this.clock();
    const lyric = entry.value.lyric || this.getLyric(trackId);
    return lyric === entry.value.lyric ? entry.value : { ...entry.value, lyric };
  }

  rememberResolved(track: ResolvedTrack) {
    const stamp = this.clock();
    this.resolved.set(track.id, { value: track, expiresAt: stamp + RESOLVED_TTL_MS, usedAt: stamp });
    if (track.lyric?.trim()) this.lyrics.set(track.id, { value: track.lyric, expiresAt: stamp + LYRIC_TTL_MS, usedAt: stamp });
    trim(this.resolved, MAX_RESOLVED); trim(this.lyrics, MAX_LYRICS); this.persist();
  }

  forgetResolved(trackId: string) {
    if (this.resolved.delete(trackId)) this.persist();
  }

  clear() {
    this.resolved.clear(); this.lyrics.clear(); this.persist();
  }

  getLyric(trackId: string): string | null {
    const entry = this.lyrics.get(trackId);
    if (!entry || entry.expiresAt <= this.clock()) {
      if (entry) { this.lyrics.delete(trackId); this.persist(); }
      return null;
    }
    entry.usedAt = this.clock(); return entry.value;
  }

  withRememberedLyric(track: ResolvedTrack): ResolvedTrack {
    if (track.lyric) return track;
    const lyric = this.getLyric(track.id);
    return lyric ? { ...track, lyric } : track;
  }

  private removeExpired(save = true) {
    const stamp = this.clock();
    for (const [key, entry] of this.resolved) if (entry.expiresAt <= stamp) this.resolved.delete(key);
    for (const [key, entry] of this.lyrics) if (entry.expiresAt <= stamp) this.lyrics.delete(key);
    trim(this.resolved, MAX_RESOLVED); trim(this.lyrics, MAX_LYRICS); if (save) this.persist();
  }

  private persist() {
    if (!this.storage) return;
    try { this.storage.setItem(STORAGE_KEY, JSON.stringify({ resolved: [...this.resolved], lyrics: [...this.lyrics] } satisfies StoredPlaybackCache)); }
    catch { /* Storage can be unavailable or full; memory caching still works. */ }
  }
}
