import type { Db } from './db.js';
import { getCached, setCached } from './db.js';
import { SOURCES, type ImportedPlaylist, type MusicSource, type ResolvedTrack, type Track } from '../shared/types.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) PikachuMusicLocal/1.0';
const SOURCE_NAMES: Record<MusicSource, string> = { migu: '咪咕', netease: '网易云', qq: 'QQ', kuwo: '酷我' };
const sourceHosts: Record<MusicSource, string[]> = {
  migu: ['music.migu.cn', 'm.music.migu.cn'],
  netease: ['music.163.com', '163cn.tv'],
  qq: ['y.qq.com', 'i.y.qq.com', 'c.y.qq.com', 'c6.y.qq.com'],
  kuwo: ['kuwo.cn', 'www.kuwo.cn']
};

export class SourceError extends Error {
  constructor(public code: string, message: string, public details?: unknown) { super(message); }
}

function asObject(value: unknown): Record<string, any> {
  return value && typeof value === 'object' ? value as Record<string, any> : {};
}

function text(value: unknown): string { return value == null ? '' : String(value).trim(); }
function first(...values: unknown[]): string { return values.map(text).find(Boolean) || ''; }
function absolute(url: string): string | null {
  if (!url) return null;
  if (url.startsWith('//')) return `https:${url}`;
  if (url.startsWith('http://') || url.startsWith('https://')) return url.replace(/^http:\/\//, 'https://');
  return null;
}
function artists(value: unknown): string {
  if (Array.isArray(value)) return value.map(v => first(asObject(v).name, asObject(v).singerName, v)).filter(Boolean).join(' / ');
  return text(value);
}
function durationMs(value: unknown): number {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return 0;
  return n > 10000 ? Math.round(n) : Math.round(n * 1000);
}
function track(source: MusicSource, sourceTrackId: unknown, data: Partial<Track>): Track {
  const sid = text(sourceTrackId) || `${data.title || 'unknown'}:${data.artist || ''}`;
  return {
    id: `${source}:${sid}`, source, sourceTrackId: sid, title: data.title || '未知歌曲',
    artist: data.artist || '未知歌手', album: data.album || '', duration: data.duration || 0,
    coverUrl: data.coverUrl || null, sourceUrl: data.sourceUrl || sourceTrackUrl(source, sid),
    keyword: data.keyword, displayIndex: data.displayIndex, quality: data.quality || null
  };
}

async function fetchWithTimeout(url: string, init: RequestInit = {}, attempts = 2): Promise<Response> {
  let last: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    try {
      const response = await fetch(url, {
        ...init, signal: controller.signal,
        headers: { 'user-agent': UA, accept: 'application/json,text/plain,*/*', ...init.headers }
      });
      if (response.ok || (init.redirect === 'manual' && response.status >= 300 && response.status < 400)) return response;
      last = new Error(`${response.status} ${response.statusText}`);
      if (![429, 500, 502, 503, 504].includes(response.status)) break;
    } catch (error) { last = error; }
    finally { clearTimeout(timer); }
    if (attempt + 1 < attempts) await new Promise(resolve => setTimeout(resolve, 350 * (attempt + 1)));
  }
  throw new SourceError('SOURCE_UNAVAILABLE', `音乐源请求失败：${last instanceof Error ? last.message : String(last)}`);
}

async function fetchJson(url: string, init: RequestInit = {}): Promise<any> {
  const response = await fetchWithTimeout(url, init);
  const raw = await response.text();
  const cleaned = raw.replace(/^callback\(|^MusicJsonCallback\(/, '').replace(/\);?\s*$/, '');
  try { return JSON.parse(cleaned); }
  catch { throw new SourceError('INVALID_SOURCE_RESPONSE', '音乐源返回了无法识别的数据。'); }
}

export function sourceTrackUrl(source: MusicSource, id: string) {
  if (source === 'netease') return `https://music.163.com/song?id=${encodeURIComponent(id)}`;
  if (source === 'qq') return `https://y.qq.com/n/ryqq/songDetail/${encodeURIComponent(id)}`;
  if (source === 'kuwo') return `https://www.kuwo.cn/play_detail/${encodeURIComponent(id)}`;
  return `https://music.migu.cn/v3/music/song/${encodeURIComponent(id)}`;
}

export function parsePlaylistInput(input: string, explicitSource?: MusicSource): { source: MusicSource; id: string } {
  const raw = input.trim();
  if (/^\d+$/.test(raw)) {
    if (!explicitSource) throw new SourceError('SOURCE_REQUIRED', '输入纯歌单 ID 时请选择音乐源。');
    return { source: explicitSource, id: raw };
  }
  let url: URL;
  try { url = new URL(raw); } catch { throw new SourceError('INVALID_PLAYLIST_INPUT', '请输入公开歌单链接或数字 ID。'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new SourceError('UNSAFE_URL', '只允许 HTTP/HTTPS 公开歌单链接。');
  const host = url.hostname.toLowerCase();
  const detected = SOURCES.find(source => sourceHosts[source].some(item => host === item || host.endsWith(`.${item}`)));
  const source = explicitSource || detected;
  if (!source || !sourceHosts[source].some(item => host === item || host.endsWith(`.${item}`))) {
    throw new SourceError('UNSAFE_URL', '链接不属于咪咕、网易云、QQ 或酷我允许域名。');
  }
  const candidates = [
    url.searchParams.get('id'), url.searchParams.get('pid'), url.searchParams.get('playlistId'), url.searchParams.get('musicListId'),
    ...url.pathname.split('/').filter(Boolean).reverse(), url.hash
  ];
  const found = candidates.map(value => text(value).match(/\d{4,}/)?.[0]).find(Boolean);
  if (!found) throw new SourceError('PLAYLIST_ID_NOT_FOUND', '没有从链接中识别到歌单 ID。请改为直接输入数字 ID。');
  return { source, id: found };
}

export async function resolvePlaylistInput(input: string, explicitSource?: MusicSource): Promise<{ source: MusicSource; id: string }> {
  try { return parsePlaylistInput(input, explicitSource); }
  catch (error) {
    if (!(error instanceof SourceError) || error.code !== 'PLAYLIST_ID_NOT_FOUND') throw error;
    let current: URL;
    try { current = new URL(input.trim()); } catch { throw error; }
    for (let hop = 0; hop < 4; hop++) {
      const host = current.hostname.toLowerCase();
      const allowedSource = SOURCES.find(source => sourceHosts[source].some(item => host === item || host.endsWith(`.${item}`)));
      if (!allowedSource || (explicitSource && allowedSource !== explicitSource)) throw new SourceError('UNSAFE_URL', '短链接跳转到了未允许的域名。');
      const response = await fetchWithTimeout(current.toString(), { redirect: 'manual' }, 1);
      const location = response.headers.get('location');
      if (!location) break;
      current = new URL(location, current);
      try { return parsePlaylistInput(current.toString(), explicitSource || allowedSource); } catch (nextError) {
        if (!(nextError instanceof SourceError) || nextError.code !== 'PLAYLIST_ID_NOT_FOUND') throw nextError;
      }
    }
    throw new SourceError('PLAYLIST_ID_NOT_FOUND', '短链接中没有找到公开歌单 ID。');
  }
}

export async function searchSource(source: MusicSource, query: string, limit = 10): Promise<Track[]> {
  const q = query.trim(); if (!q) return [];
  const size = Math.min(Math.max(limit, 1), 30);
  if (source === 'migu') {
    const j = await fetchJson(`https://api.xcvts.cn/api/music/migu?gm=${encodeURIComponent(q)}&n=&num=${size}&type=json`);
    const list = Array.isArray(j.data) ? j.data : [];
    return list.slice(0, size).map((item: any, index: number) => track('migu', `search-${index + 1}-${encodeURIComponent(q)}`, {
      title: first(item.title, item.songName), artist: first(item.singer, item.artist), keyword: q, displayIndex: Number(item.n || index + 1),
      sourceUrl: item.link || null
    }));
  }
  if (source === 'netease') {
    const j = await fetchJson(`https://api.vkeys.cn/v2/music/netease?word=${encodeURIComponent(q)}&page=1&num=${size}`);
    return (Array.isArray(j.data) ? j.data : []).map((item: any) => track('netease', item.id, {
      title: first(item.song, item.name), artist: first(item.singer, artists(item.artists)), album: first(item.album), coverUrl: absolute(first(item.cover)), keyword: q
    }));
  }
  if (source === 'qq') {
    const j = await fetchJson(`https://tang.api.s01s.cn/music_open_api.php?msg=${encodeURIComponent(q)}&type=json`);
    const list = Array.isArray(j) ? j : Array.isArray(j.data) ? j.data : [];
    return list.slice(0, size).map((item: any) => track('qq', first(item.song_mid, item.mid), {
      title: first(item.song_title, item.title, item.name), artist: first(item.singer_name, item.singer), keyword: q
    })).filter((item: Track) => item.sourceTrackId);
  }
  const j = await fetchJson(`https://kw-api.cenguigui.cn/?name=${encodeURIComponent(q)}&page=1&limit=${size}`);
  return (Array.isArray(j.data) ? j.data : []).map((item: any) => track('kuwo', first(item.rid, item.id), {
    title: first(item.name, item.songName), artist: first(item.artist), album: first(item.album), coverUrl: absolute(first(item.pic)), keyword: q
  }));
}

export async function searchAll(db: Db, query: string, sources: MusicSource[], limit: number) {
  const key = `search:${sources.sort().join(',')}:${limit}:${query.toLowerCase()}`;
  const cached = getCached<{ tracks: Track[]; errors: Record<string, string> }>(db, key);
  if (cached) return cached;
  const settled = await Promise.allSettled(sources.map(source => searchSource(source, query, limit)));
  const tracks: Track[] = []; const errors: Record<string, string> = {};
  settled.forEach((result, index) => {
    const source = sources[index];
    if (result.status === 'fulfilled') tracks.push(...result.value.map((item, i) => ({ ...item, displayIndex: item.displayIndex || i + 1 })));
    else errors[source] = result.reason instanceof Error ? result.reason.message : String(result.reason);
  });
  tracks.sort((a, b) => (a.displayIndex || 0) - (b.displayIndex || 0) || sources.indexOf(a.source) - sources.indexOf(b.source));
  const value = { tracks, errors }; setCached(db, key, value, 5 * 60_000); return value;
}

function findAudio(value: unknown): string {
  const seen = new Set<unknown>();
  const visit = (item: unknown, depth: number): string => {
    if (depth > 5 || item == null || seen.has(item)) return '';
    if (typeof item === 'string') return /^https?:\/\/.*\.(mp3|flac|m4a|aac|ogg)(\?|$)/i.test(item) ? item : '';
    if (typeof item !== 'object') return '';
    seen.add(item);
    const object = item as Record<string, unknown>;
    for (const key of ['lossless', 'flac', 'music_url', 'play_url', 'song_url', 'audioUrl', 'url', 'src', '128', '320']) {
      const found = visit(object[key], depth + 1); if (found) return found;
    }
    for (const child of Object.values(object)) { const found = visit(child, depth + 1); if (found) return found; }
    return '';
  };
  return visit(value, 0);
}

function findLyric(value: unknown): string | null {
  const seen = new Set<unknown>();
  const visit = (item: unknown, depth: number): string => {
    if (depth > 6 || item == null || seen.has(item)) return '';
    if (typeof item === 'string') { const candidate = item.trim(); return candidate && candidate !== '[object Object]' ? candidate : ''; }
    if (typeof item !== 'object') return '';
    seen.add(item); const object = asObject(item);
    for (const key of ['lrc', 'lyric', 'lyrics', 'lyricText', 'content', 'text']) { const found = visit(object[key], depth + 1); if (found) return found; }
    for (const key of ['data', 'result']) { const found = visit(object[key], depth + 1); if (found) return found; }
    return '';
  };
  return visit(value, 0) || null;
}

async function resolveOriginal(input: Track): Promise<ResolvedTrack> {
  if (input.source === 'netease') {
    const [meta, lyricData] = await Promise.all([
      fetchJson(`https://api.qijieya.cn/meting/?type=song&id=${encodeURIComponent(input.sourceTrackId)}`),
      fetchJson(`https://api.vkeys.cn/v2/music/netease/lyric?id=${encodeURIComponent(input.sourceTrackId)}`).catch(() => null)
    ]);
    const item = Array.isArray(meta) ? meta[0] : asObject(meta).data;
    const audioUrl = findAudio(item); if (!audioUrl) throw new SourceError('UNPLAYABLE', '网易云未返回公开播放地址。');
    return { ...input, title: first(item?.name, input.title), artist: first(item?.artist, input.artist), coverUrl: absolute(first(item?.pic, input.coverUrl)),
      audioUrl, lyric: findLyric(lyricData), actualSource: 'netease', fallback: false };
  }
  if (input.source === 'kuwo') {
    const j = await fetchJson(`https://kw-api.cenguigui.cn/?id=${encodeURIComponent(input.sourceTrackId)}&type=song&level=zp&format=json`);
    const item = asObject(j.data); const audioUrl = findAudio(item);
    if (!audioUrl) throw new SourceError('UNPLAYABLE', '酷我未返回公开播放地址。');
    return { ...input, title: first(item.name, input.title), artist: first(item.artist, input.artist), album: first(item.album, input.album),
      coverUrl: absolute(first(item.pic, input.coverUrl)), audioUrl, lyric: findLyric(item), actualSource: 'kuwo', fallback: false };
  }
  const query = input.source === 'migu' ? (input.keyword || input.title).trim() : `${input.title} ${input.artist}`.trim();
  if (input.source === 'migu') {
    const result = await fetchJson(`https://api.xcvts.cn/api/music/migu?gm=${encodeURIComponent(query)}&n=${encodeURIComponent(String(input.displayIndex || 1))}&num=10&type=json`);
    const audioUrl = findAudio(result); if (!audioUrl) throw new SourceError('UNPLAYABLE', '咪咕未返回公开播放地址。');
    let lyric: string | null = findLyric(result);
    const lyricUrl = absolute(first(result.lrc_url));
    if (!lyric && lyricUrl) lyric = await (await fetchWithTimeout(lyricUrl, {}, 1)).text().catch(() => null);
    return { ...input, title: first(result.title, input.title), artist: first(result.singer, input.artist), coverUrl: absolute(first(result.cover, input.coverUrl)),
      sourceUrl: first(result.link, input.sourceUrl) || null, audioUrl, lyric, actualSource: 'migu', fallback: false };
  }
  const j = await fetchJson(`https://tang.api.s01s.cn/music_open_api.php?msg=${encodeURIComponent(query)}&type=json&mid=${encodeURIComponent(input.sourceTrackId)}`);
  const item = Array.isArray(j) ? j.find(v => first(v.song_mid, v.mid) === input.sourceTrackId) || j[0] : asObject(j).data || j;
  const audioUrl = findAudio(item); if (!audioUrl) throw new SourceError('UNPLAYABLE', 'QQ 未返回公开播放地址。');
  return { ...input, title: first(item?.song_title, item?.title, input.title), artist: first(item?.singer_name, item?.singer, input.artist),
    coverUrl: absolute(first(item?.cover, item?.pic, input.coverUrl)), audioUrl, lyric: findLyric(item), actualSource: 'qq', fallback: false };
}

function normalizeMatch(value: string) { return value.toLowerCase().replace(/[\s\-—_()（）【】\[\]'.·,，]/g, ''); }
export function matchScore(target: Track, candidate: Track): number {
  const a = normalizeMatch(target.title); const b = normalizeMatch(candidate.title);
  const titleScore = a === b ? 0.55 : a.includes(b) || b.includes(a) ? 0.4 : 0;
  const aa = normalizeMatch(target.artist); const ba = normalizeMatch(candidate.artist);
  const artistScore = aa && ba && (aa === ba || aa.includes(ba) || ba.includes(aa)) ? 0.25 : 0;
  const durationScore = target.duration && candidate.duration && Math.abs(target.duration - candidate.duration) <= 8000 ? 0.2 : (!target.duration || !candidate.duration ? 0.1 : 0);
  return titleScore + artistScore + durationScore;
}

export async function resolveTrackWithFallback(input: Track, db?: Db): Promise<ResolvedTrack> {
  const cacheKey = `resolve:${input.source}:${input.sourceTrackId}`;
  const cached = db ? getCached<ResolvedTrack>(db, cacheKey) : null;
  if (cached?.audioUrl) return { ...cached, id: input.id };
  let resolved: ResolvedTrack;
  try { resolved = await resolveOriginal(input); }
  catch (originalError) {
    const others = SOURCES.filter(source => source !== input.source);
    const settled = await Promise.allSettled(others.map(source => searchSource(source, `${input.title} ${input.artist}`, 5)));
    const ranked = settled.flatMap(result => result.status === 'fulfilled' ? result.value : [])
      .map(candidate => ({ candidate, score: matchScore(input, candidate) })).sort((a, b) => b.score - a.score);
    if (!ranked[0] || ranked[0].score < 0.8 || (ranked[1] && ranked[0].score - ranked[1].score < 0.05)) {
      throw new SourceError('FALLBACK_CONFIRM_REQUIRED', '原音源不可播放，未找到足够可信的自动替代版本。', {
        original: originalError instanceof Error ? originalError.message : String(originalError), candidates: ranked.slice(0, 5)
      });
    }
    const fallback = await resolveOriginal(ranked[0].candidate);
    resolved = { ...fallback, id: input.id, fallback: true };
  }
  if (db) setCached(db, cacheKey, resolved, 5 * 60_000);
  return resolved;
}

async function fetchNeteasePlaylist(id: string): Promise<ImportedPlaylist> {
  const j = await fetchJson(`https://music.163.com/api/v6/playlist/detail?id=${encodeURIComponent(id)}&n=1000`, { headers: { referer: 'https://music.163.com/' } });
  const p = asObject(j.playlist); if (!p.id) throw new SourceError('PLAYLIST_NOT_FOUND', '网易云公开歌单不存在或不可访问。');
  const list = Array.isArray(p.tracks) ? p.tracks : [];
  return { source: 'netease', sourcePlaylistId: id, title: first(p.name, `网易云歌单 ${id}`), description: first(p.description), coverUrl: absolute(first(p.coverImgUrl)),
    sourceUrl: `https://music.163.com/playlist?id=${id}`, tracks: list.slice(0, 1000).map((item: any) => track('netease', item.id, {
      title: first(item.name), artist: artists(item.ar), album: first(item.al?.name), duration: durationMs(item.dt), coverUrl: absolute(first(item.al?.picUrl))
    })) };
}

async function fetchQqPlaylist(id: string): Promise<ImportedPlaylist> {
  const url = `https://c.y.qq.com/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg?type=1&json=1&utf8=1&onlysong=0&disstid=${encodeURIComponent(id)}&format=json`;
  const j = await fetchJson(url, { headers: { referer: 'https://y.qq.com/' } });
  const p = Array.isArray(j.cdlist) ? j.cdlist[0] : null; if (!p) throw new SourceError('PLAYLIST_NOT_FOUND', 'QQ 公开歌单不存在或不可访问。');
  const list = Array.isArray(p.songlist) ? p.songlist : [];
  return { source: 'qq', sourcePlaylistId: id, title: first(p.dissname, `QQ 歌单 ${id}`), description: first(p.desc), coverUrl: absolute(first(p.logo)),
    sourceUrl: `https://y.qq.com/n/ryqq/playlist/${id}`, tracks: list.slice(0, 1000).map((item: any) => {
      const albumMid = first(item.album?.mid, item.albummid); return track('qq', first(item.mid, item.songmid), {
        title: first(item.name, item.songname), artist: artists(item.singer), album: first(item.album?.name, item.albumname), duration: durationMs(item.interval),
        coverUrl: albumMid ? `https://y.qq.com/music/photo_new/T002R300x300M000${albumMid}.jpg` : null
      });
    }).filter((item: Track) => item.sourceTrackId) };
}

async function fetchKuwoPlaylist(id: string): Promise<ImportedPlaylist> {
  const params = new URLSearchParams({ op: 'getlistinfo', pid: id, pn: '0', rn: '1000', encode: 'utf8', keyset: 'pl2012', identity: 'kuwo', pcmp4: '1', vipver: '1', newver: '1' });
  const j = await fetchJson(`http://nplserver.kuwo.cn/pl.svc?${params}`);
  const list = Array.isArray(j.musiclist) ? j.musiclist : []; if (!list.length) throw new SourceError('PLAYLIST_NOT_FOUND', '酷我公开歌单不存在或为空。');
  const title = first(j.title, j.name, `酷我歌单 ${id}`);
  return { source: 'kuwo', sourcePlaylistId: id, title, description: first(j.info), coverUrl: absolute(first(j.pic, j.img)),
    sourceUrl: `https://www.kuwo.cn/playlist_detail/${id}`, tracks: list.slice(0, 1000).map((item: any) => track('kuwo', first(item.id, item.rid, item.MUSICRID).replace(/^MUSIC_/, ''), {
      title: first(item.name, item.song_name, item.SONGNAME), artist: first(item.artist, item.artist_name, item.ARTIST), album: first(item.album, item.ALBUM),
      duration: durationMs(item.duration || item.DURATION), coverUrl: absolute(first(item.albumpic, item.web_albumpic_short))
    })) };
}

function miguImage(item: any): string | null {
  const images = [...(Array.isArray(item.imgItems) ? item.imgItems : []), ...(Array.isArray(item.albumImgs) ? item.albumImgs : [])];
  return absolute(first(item.img1, item.img2, images[0]?.img, images[0]?.imgOri, images[0]?.webpImg));
}
async function fetchMiguPlaylist(id: string, onProgress?: (processed: number, total: number) => void): Promise<ImportedPlaylist> {
  const headers = { referer: 'https://music.migu.cn/', channel: '0146951' };
  const infoParams = new URLSearchParams({ needSimple: '00', resourceType: '2021', resourceId: id });
  const infoJson = await fetchJson(`https://app.c.nf.migu.cn/MIGUM2.0/v1.0/content/resourceinfo.do?${infoParams}`, { headers });
  const info = Array.isArray(infoJson.resource) ? infoJson.resource[0] : {};
  const results: Track[] = []; const seen = new Set<string>(); let total = Number(info?.musicNum || 0);
  for (let page = 1; page <= 20; page++) {
    const params = new URLSearchParams({ pageNo: String(page), pageSize: '50', playlistId: id });
    const j = await fetchJson(`https://app.c.nf.migu.cn/MIGUM3.0/resource/playlist/song/v2.0?${params}`, { headers });
    if (j.code && j.code !== '000000') throw new SourceError('SOURCE_ERROR', first(j.info, '咪咕歌单接口错误。'));
    const list = Array.isArray(j.data?.songList) ? j.data.songList : []; total ||= Number(j.data?.totalCount || 0);
    for (const item of list) {
      const sid = first(item.contentId, item.copyrightId, item.id, item.songId); if (!sid || seen.has(sid)) continue; seen.add(sid);
      results.push(track('migu', sid, { title: first(item.name, item.songName), artist: first(artists(item.singers), artists(item.artists), item.singer),
        album: first(item.album, item.albums?.[0]?.name), duration: durationMs(item.duration), coverUrl: miguImage(item) }));
    }
    onProgress?.(results.length, total || results.length);
    if (!list.length || list.length < 50 || (total && results.length >= total)) break;
  }
  if (!results.length) throw new SourceError('PLAYLIST_NOT_FOUND', '咪咕公开歌单不存在或为空。');
  const image = info?.imgItem || {};
  return { source: 'migu', sourcePlaylistId: id, title: first(info?.title, `咪咕歌单 ${id}`), description: first(info?.summary),
    coverUrl: absolute(first(info?.originalImgUrl, image.img, image.webpImg, image.imgOri, results[0]?.coverUrl)),
    sourceUrl: `https://music.migu.cn/v3/music/playlist/${id}`, tracks: results };
}

export async function fetchPublicPlaylist(source: MusicSource, id: string, onProgress?: (processed: number, total: number) => void) {
  if (source === 'netease') return fetchNeteasePlaylist(id);
  if (source === 'qq') return fetchQqPlaylist(id);
  if (source === 'kuwo') return fetchKuwoPlaylist(id);
  return fetchMiguPlaylist(id, onProgress);
}

export { SOURCE_NAMES };
