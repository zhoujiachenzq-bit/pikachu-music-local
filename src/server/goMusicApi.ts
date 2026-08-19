import { SOURCES, type MusicSource, type ResolvedTrack, type Track } from '../shared/types.js';
import { canonicalTrackKey } from '../shared/trackIdentity.js';
import { isLikelyKuwoRestrictionAudio } from './mediaValidation.js';

type Fetcher = (input: string | URL, init?: RequestInit) => Promise<Response>;
type ScoredCandidate = { candidate: Track; score: number };

interface GoMusicApiOptions {
  baseUrl?: string | null;
  fetcher?: Fetcher;
  timeoutMs?: number;
}

interface SearchOptions extends GoMusicApiOptions {
  sources?: MusicSource[];
  limit?: number;
}

interface ResolveOptions extends GoMusicApiOptions {
  score: (target: Track, candidate: Track) => number;
  ambiguous: (first: ScoredCandidate, second?: ScoredCandidate) => boolean;
  eligible?: (target: Track, candidate: Track) => boolean;
}

interface BackupMediaQuery {
  source: MusicSource;
  id: string;
  name: string;
  artist: string;
  duration?: number;
}

const DEFAULT_TIMEOUT_MS = 7_000;
let consecutiveFailures = 0;
let unavailableUntil = 0;

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function string(value: unknown): string {
  return value == null ? '' : String(value).trim();
}

function durationMs(value: unknown): number {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return numeric > 10_000 ? Math.round(numeric) : Math.round(numeric * 1000);
}

function publicUrl(value: unknown): string | null {
  const raw = string(value);
  if (!raw) return null;
  try {
    const url = new URL(raw.startsWith('//') ? `https:${raw}` : raw);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    if (url.protocol === 'http:') url.protocol = 'https:';
    return url.toString();
  } catch { return null; }
}

export function goMusicApiBaseUrl(value: string | null | undefined = process.env.GO_MUSIC_API_URL): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return null;
    return url.toString().replace(/\/$/, '');
  } catch { return null; }
}

function timeoutMs(value?: number) {
  const configured = value ?? Number(process.env.GO_MUSIC_API_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
  return Number.isFinite(configured) ? Math.min(20_000, Math.max(1_000, configured)) : DEFAULT_TIMEOUT_MS;
}

async function fetchWithConnectTimeout(url: URL, init: RequestInit, fetcher: Fetcher, limit: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), limit);
  try { return await fetcher(url, { ...init, signal: controller.signal }); }
  finally { clearTimeout(timer); }
}

async function fetchJson(url: URL, options: GoMusicApiOptions): Promise<Record<string, unknown> | null> {
  try {
    const response = await fetchWithConnectTimeout(url, { headers: { accept: 'application/json' } }, options.fetcher || fetch, timeoutMs(options.timeoutMs));
    consecutiveFailures = 0; unavailableUntil = 0;
    if (!response.ok) return null;
    return object(await response.json());
  } catch {
    consecutiveFailures += 1;
    if (consecutiveFailures >= 2) unavailableUntil = Date.now() + 60_000;
    return null;
  }
}

function parseSizeBytes(value: unknown): number {
  if (typeof value === 'number') return value > 0 ? value : 0;
  const match = string(value).match(/^([\d.]+)\s*(B|KB|MB|GB)$/i);
  if (!match) return 0;
  const amount = Number(match[1]);
  const powers: Record<string, number> = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3 };
  return Number.isFinite(amount) ? amount * powers[match[2].toUpperCase()] : 0;
}

function toTrack(value: Record<string, unknown>, expectedSource: MusicSource): Track | null {
  const source = string(value.source) as MusicSource;
  const sourceTrackId = string(value.id);
  const title = string(value.name);
  if (source !== expectedSource || !SOURCES.includes(source) || !sourceTrackId || !title) return null;
  const artist = string(value.artist);
  return {
    id: `${source}:${sourceTrackId}`, source, sourceTrackId, title, artist,
    album: string(value.album), duration: durationMs(value.duration), coverUrl: publicUrl(value.cover),
    sourceUrl: publicUrl(value.link), canonicalKey: canonicalTrackKey(title, artist)
  };
}

export async function searchWithGoMusicApi(query: string, options: SearchOptions = {}): Promise<Track[]> {
  const baseUrl = goMusicApiBaseUrl(options.baseUrl);
  const keyword = query.trim();
  if (!baseUrl || !keyword || unavailableUntil > Date.now()) return [];
  const sources = options.sources?.length ? options.sources.filter(source => SOURCES.includes(source)) : [...SOURCES];
  if (!sources.length) return [];
  const url = new URL('/api/v1/music/search', `${baseUrl}/`);
  url.searchParams.set('q', keyword); url.searchParams.set('type', 'song');
  for (const source of sources) url.searchParams.append('sources', source);
  const response = await fetchJson(url, options);
  const data = object(response?.data); const songs = Array.isArray(data.songs) ? data.songs : [];
  const allowed = new Set(sources); const limit = Math.min(100, Math.max(1, options.limit || 30));
  return songs.flatMap(value => {
    const item = object(value); const source = string(item.source) as MusicSource;
    if (!allowed.has(source)) return [];
    const parsed = toTrack(item, source); return parsed ? [parsed] : [];
  }).slice(0, limit);
}

function mediaPath(track: Track) {
  const params = new URLSearchParams({ source: track.source, id: track.sourceTrackId, name: track.title, artist: track.artist });
  if (track.duration > 0) params.set('duration', String(Math.round(track.duration / 1000)));
  return `/api/backup-media?${params}`;
}

async function switchCandidate(input: Track, target: MusicSource, options: ResolveOptions): Promise<Track | null> {
  const baseUrl = goMusicApiBaseUrl(options.baseUrl);
  if (!baseUrl) return null;
  const url = new URL('/api/v1/music/switch', `${baseUrl}/`);
  url.searchParams.set('name', input.title); url.searchParams.set('artist', input.artist);
  url.searchParams.set('source', input.source); url.searchParams.set('target', target);
  if (input.duration > 0) url.searchParams.set('duration', String(Math.round(input.duration / 1000)));
  const response = await fetchJson(url, options);
  const nested = object(response?.data);
  const candidate = toTrack(Object.keys(nested).length ? nested : object(response), target);
  if (!candidate || options.score(input, candidate) < .85 || options.eligible && !options.eligible(input, candidate)) return null;

  const inspect = new URL('/api/v1/music/inspect', `${baseUrl}/`);
  inspect.searchParams.set('source', candidate.source); inspect.searchParams.set('id', candidate.sourceTrackId);
  inspect.searchParams.set('name', candidate.title); inspect.searchParams.set('artist', candidate.artist);
  if (candidate.duration > 0) inspect.searchParams.set('duration', String(Math.round(candidate.duration / 1000)));
  const probe = await fetchJson(inspect, options);
  if (!probe || probe.valid !== true) return null;
  const contentLength = parseSizeBytes(probe.size);
  if (candidate.source === 'kuwo' && isLikelyKuwoRestrictionAudio(contentLength, candidate.duration || input.duration)) return null;
  return candidate;
}

async function lyricFor(track: Track, options: GoMusicApiOptions): Promise<string | null> {
  const baseUrl = goMusicApiBaseUrl(options.baseUrl);
  if (!baseUrl) return null;
  const url = new URL('/api/v1/music/lyric', `${baseUrl}/`);
  url.searchParams.set('source', track.source); url.searchParams.set('id', track.sourceTrackId);
  const response = await fetchJson(url, options);
  const lyric = string(object(response?.data).lyric)
    .replace(/\[(\d{1,2}:\d{2}(?:\.\d{1,3})?)\]\s*\n\[\1\]/g, '\n[$1]');
  return lyric || null;
}

export async function resolveExactWithGoMusicApi(input: Track, options: GoMusicApiOptions = {}): Promise<ResolvedTrack | null> {
  const baseUrl = goMusicApiBaseUrl(options.baseUrl);
  if (!baseUrl || unavailableUntil > Date.now()) return null;
  const inspect = new URL('/api/v1/music/inspect', `${baseUrl}/`);
  inspect.searchParams.set('source', input.source); inspect.searchParams.set('id', input.sourceTrackId);
  inspect.searchParams.set('name', input.title); inspect.searchParams.set('artist', input.artist);
  if (input.duration > 0) inspect.searchParams.set('duration', String(Math.round(input.duration / 1000)));
  const probe = await fetchJson(inspect, options);
  if (!probe || probe.valid !== true) return null;
  const contentLength = parseSizeBytes(probe.size);
  if (input.source === 'kuwo' && isLikelyKuwoRestrictionAudio(contentLength, input.duration)) return null;
  const lyric = await lyricFor(input, { ...options, baseUrl });
  return {
    ...input, audioUrl: mediaPath(input), lyric, actualSource: input.source,
    fallback: true, backupProvider: 'go-music-api'
  };
}

export async function resolveWithGoMusicApi(input: Track, options: ResolveOptions): Promise<ResolvedTrack | null> {
  const baseUrl = goMusicApiBaseUrl(options.baseUrl);
  if (!baseUrl || unavailableUntil > Date.now()) return null;
  const targets = SOURCES.filter(source => source !== input.source);
  const settled = await Promise.allSettled(targets.map(source => switchCandidate(input, source, { ...options, baseUrl })));
  const ranked = settled.flatMap(result => result.status === 'fulfilled' && result.value ? [result.value] : [])
    .filter(candidate => !options.eligible || options.eligible(input, candidate))
    .map(candidate => ({ candidate, score: options.score(input, candidate) })).sort((a, b) => b.score - a.score);
  if (!ranked[0] || ranked[0].score < .85 || options.ambiguous(ranked[0], ranked[1])) return null;
  const lyric = await lyricFor(ranked[0].candidate, { ...options, baseUrl });
  return {
    ...ranked[0].candidate, id: input.id, audioUrl: mediaPath(ranked[0].candidate), lyric,
    actualSource: ranked[0].candidate.source, fallback: true, backupProvider: 'go-music-api'
  };
}

export function goMusicApiStreamUrl(query: BackupMediaQuery, baseUrl = goMusicApiBaseUrl()): URL | null {
  if (!baseUrl) return null;
  const url = new URL('/api/v1/music/stream', `${baseUrl}/`);
  url.searchParams.set('source', query.source); url.searchParams.set('id', query.id);
  url.searchParams.set('name', query.name); url.searchParams.set('artist', query.artist);
  if (query.duration && query.duration > 0) url.searchParams.set('duration', String(Math.round(query.duration)));
  return url;
}

export async function openGoMusicApiStream(query: BackupMediaQuery, range?: string, options: GoMusicApiOptions = {}) {
  const url = goMusicApiStreamUrl(query, goMusicApiBaseUrl(options.baseUrl));
  if (!url) return null;
  const fetcher = options.fetcher || fetch; const limit = timeoutMs(options.timeoutMs);
  let last: Response | null = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetchWithConnectTimeout(url, { headers: range ? { range } : {} }, fetcher, limit);
      if ([200, 206].includes(response.status) || ![404, 429].includes(response.status) && response.status < 500) return response;
      await response.body?.cancel().catch(() => undefined); last = response;
    } catch (error) {
      if (attempt === 1) throw error;
    }
  }
  return last;
}
