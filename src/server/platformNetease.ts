import { fetchJsonWithDeadline } from '../shared/fetchDeadline.js';
import type { PlatformResult } from '../shared/platform.js';
import type { Track } from '../shared/types.js';
import type { PlatformQuery } from './platformGateway.js';
import { fetchNeteasePlaylist } from './sources.js';

const list = (v: unknown): any[] => Array.isArray(v) ? v : [];
const image = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  try { const url = new URL(v); if (!['http:','https:'].includes(url.protocol) || url.username || url.password) return null; url.protocol = 'https:'; return url.href; }
  catch { return null; }
};
const names = (v: unknown) => list(v).map(x => String(x.name || '')).filter(Boolean).join(' / ');
function song(item: any): Track | null {
  if (!item.id || !item.name) return null;
  return { id:`netease:${item.id}`, source:'netease', sourceTrackId:String(item.id), title:String(item.name), artist:names(item.ar || item.artists), album:String(item.al?.name || item.album?.name || ''),
    duration:Math.max(0, Number(item.dt || item.duration) || 0), coverUrl:image(item.al?.picUrl || item.album?.picUrl), sourceUrl:`https://music.163.com/song?id=${encodeURIComponent(item.id)}` };
}

// Public catalogue metadata only. Playback entitlement is handled separately.
export async function queryNeteaseDiscovery(query: PlatformQuery): Promise<PlatformResult> {
  const result: PlatformResult = { tracks:[], items:[], categories:[] };
  if (query.mode === 'detail' && query.type === 'playlist') {
    result.tracks = (await fetchNeteasePlaylist(query.id)).tracks; return result;
  }
  let path: string;
  if (query.mode === 'recommend') path = '/api/personalized/playlist?limit=30';
  else if (query.mode === 'detail') path = `/api/album/${encodeURIComponent(query.id)}`;
  else {
    const params = new URLSearchParams({ s:query.q, type:query.type === 'album' ? '10' : query.type === 'playlist' ? '1000' : '1', limit:'30', offset:String((query.page - 1) * 30) });
    path = `/api/search/get/web?${params}`;
  }
  const { response, body: raw } = await fetchJsonWithDeadline(`https://music.163.com${path}`, { headers:{ referer:'https://music.163.com/', accept:'application/json' } }, 8000);
  const body = raw as Record<string, any>;
  if (!response.ok || body?.code !== 200) throw new Error('暂时无法读取网易云公开目录');
  if (query.mode === 'detail' || query.type === 'song' && query.mode === 'search') {
    result.tracks = list(body.songs || body.album?.songs || body.result?.songs).flatMap(value => { const track = song(value); return track ? [track] : []; });
  } else {
    const kind = query.mode === 'recommend' ? 'playlist' : query.type === 'album' ? 'album' : 'playlist';
    const rows = query.mode === 'recommend' ? body.result : kind === 'album' ? body.result?.albums : body.result?.playlists;
    if (query.mode === 'recommend' && !list(rows).length) throw new Error('网易云暂未返回推荐歌单');
    result.items = list(rows).slice(0,30).filter(item => item.id && item.name).map(item => ({ id:String(item.id), source:'netease', name:String(item.name), cover:image(item.picUrl || item.coverImgUrl), description:String(item.description || ''), count:Math.max(0,Number(item.trackCount || item.size) || 0), kind }));
  }
  return result;
}
