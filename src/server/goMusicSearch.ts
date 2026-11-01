// Protocol adaptation of music-lib qq/song.go and migu/song.go (AGPL-3.0).
// See third_party/go-music-api-NOTICE.md. Android supplies its native HTTP stack
// through fetch, including the platform DNS resolver and certificate store.
import type { Track } from '../shared/types.js';
import { canonicalTrackKey } from '../shared/trackIdentity.js';

const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 9_1 like Mac OS X) AppleWebKit/601.1.46 (KHTML, like Gecko) Version/9.0 Mobile/13B143 Safari/601.1';
type ObjectValue = Record<string, any>;
const obj = (value: unknown): ObjectValue => value && typeof value === 'object' ? value as ObjectValue : {};
const str = (value: unknown) => value == null ? '' : String(value).trim();
const array = (value: unknown): ObjectValue[] => Array.isArray(value) ? value.map(obj) : [];
function cover(value: unknown): string | null {
  const raw = str(value); if (!raw) return null;
  try { const url = new URL(raw.startsWith('//') ? `https:${raw}` : raw, 'https://d.musicapp.migu.cn'); return /^https?:$/.test(url.protocol) ? url.href : null; }
  catch { return null; }
}

export function parseGoMusicSearch(source: 'qq' | 'migu', value: unknown, keyword: string, limit: number): Track[] {
  const data = obj(value);
  if (data.code !== undefined && !['0', '000000', '200'].includes(str(data.code))) throw new Error(`${source} 搜索被拒绝（${str(data.code)}）`);
  const items = source === 'qq' ? array(data.data?.song?.list) : array(data.songResultData?.result);
  return items.flatMap(item => {
    let sourceTrackId: string; let title: string; let artist: string; let album: string; let duration: number; let coverUrl: string | null;
    if (source === 'qq') {
      // Upstream anonymous search excludes VIP-only tracks. No entitlement bypass.
      if (Number(item.pay?.payplay) === 1) return [];
      sourceTrackId = str(item.songmid); title = str(item.songname);
      artist = array(item.singer).map(singer => str(singer.name)).filter(Boolean).join('、');
      album = str(item.albumname); duration = Number(item.interval || 0) * 1000;
      coverUrl = item.albummid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${encodeURIComponent(str(item.albummid))}.jpg` : null;
    } else {
      // Keep the platform's immutable content/resource/format tuple, not its
      // display position or copyright id. Prefer plain MP3 for Android playback.
      const formats = [...array(item.newRateFormats), ...array(item.rateFormats), ...array(item.audioFormats)];
      const format = formats.find(format => str(format.formatType) === 'PQ')
        ?? formats.find(format => ['HQ', 'LQ', 'SQ'].includes(str(format.formatType)));
      if (!format || !item.contentId || !format.resourceType) return [];
      sourceTrackId = `${str(item.contentId)}|${str(format.resourceType)}|${str(format.formatType)}`;
      title = str(item.name || item.songName);
      const names = [...array(item.singers), ...array(item.artists), ...array(item.singerList)].map(singer => str(singer.name)).filter(Boolean);
      artist = [...new Set(names)].join(' / ') || str(item.singer);
      album = str(array(item.albums)[0]?.name || item.album);
      duration = Number(item.duration || 0) * 1000;
      const images = [...array(item.imgItems), ...array(item.albumImgs)];
      coverUrl = cover(images.map(image => image.img || image.imgUrl || image.url).find(Boolean) || item.img1 || item.img2);
    }
    if (!sourceTrackId || !title) return [];
    return [{ id: `${source}:${sourceTrackId}`, source, sourceTrackId, title, artist, album,
      duration: Number.isFinite(duration) && duration > 0 ? duration : 0, coverUrl,
      sourceUrl: source === 'qq' ? `https://y.qq.com/n/ryqq/songDetail/${sourceTrackId}` : `https://music.migu.cn/v3/music/song/${str(item.contentId)}`,
      keyword, canonicalKey: canonicalTrackKey(title, artist) }];
  }).slice(0, Math.min(30, Math.max(1, limit)));
}

export async function searchGoMusicNative(source: 'qq' | 'migu', keyword: string, limit: number, signal?: AbortSignal): Promise<Track[]> {
  const url = source === 'qq' ? new URL('https://c.y.qq.com/soso/fcgi-bin/search_for_qq_cp')
    : new URL('http://pd.musicapp.migu.cn/MIGUM2.0/v1.0/content/search_all.do');
  const params: Record<string, string> = source === 'qq' ? { w: keyword, format: 'json', p: '1', n: String(limit) }
    : { ua: 'Android_migu', version: '5.0.1', text: keyword, pageNo: '1', pageSize: String(limit),
      searchSwitch: JSON.stringify({ song: 1, album: 0, singer: 0, tagSong: 0, mvSong: 0, songlist: 0, bestShow: 1 }) };
  url.search = new URLSearchParams(params).toString();
  const response = await fetch(url.href, { signal, headers: { 'user-agent': UA, referer: source === 'qq' ? 'http://m.y.qq.com' : 'http://music.migu.cn/' } });
  if (!response.ok) throw new Error(`${source} 搜索请求失败（HTTP ${response.status}）`);
  signal?.throwIfAborted();
  return parseGoMusicSearch(source, await response.json(), keyword, limit);
}
