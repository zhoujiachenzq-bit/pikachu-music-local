import { z } from 'zod';
import { goMusicApiBaseUrl } from './goMusicApi.js';
import { SOURCE_PAGE_HOSTS, SOURCES, type MusicSource, type Track } from '../shared/types.js';
import type { PlatformItem, PlatformResult } from '../shared/platform.js';
import { fetchJsonWithDeadline } from '../shared/fetchDeadline.js';
import { queryNeteaseDiscovery } from './platformNetease.js';

const object = (value: unknown): Record<string, any> => value && typeof value === 'object' ? value as Record<string, any> : {};
const list = (value: unknown): any[] => Array.isArray(value) ? value : [];
const text = (value: unknown) => value == null ? '' : String(value).slice(0, 1000);
export function safePlatformImage(value: unknown): string | null {
  const raw = text(value); if (!raw) return null;
  try { const url = new URL(raw.startsWith('//') ? `https:${raw}` : raw); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null; } catch { return null; }
}

export async function platformRequest(path: string, params: Record<string, string> = {}, init: RequestInit = {}) {
  const base = goMusicApiBaseUrl(); if (!base) throw new Error('此功能需要内置或已配置的音源服务。');
  const url = new URL(`/api/v1/${path}`, `${base}/`); url.search = new URLSearchParams(params).toString();
  const { response, body: raw } = await fetchJsonWithDeadline(url.href, { ...init, headers: { accept: 'application/json', ...init.headers } }, 15000);
  const body = object(raw);
  if (!response.ok || typeof body.code === 'number' && body.code !== 200) throw new Error(text(body.msg || body.error) || `平台接口暂不可用（${response.status}）`);
  return body;
}

export const platformQuerySchema = z.object({
  mode: z.enum(['search', 'link', 'recommend', 'categories', 'category', 'personal', 'detail']),
  source: z.enum(SOURCES).default('netease'), q: z.string().trim().max(2000).default(''),
  type: z.enum(['song', 'playlist', 'album']).default('playlist'), id: z.string().max(500).default(''), page: z.coerce.number().int().min(1).max(100).default(1)
});
export type PlatformQuery = z.infer<typeof platformQuerySchema>;

export function normalizePlatformResult(raw: unknown, source: MusicSource, kind: 'playlist' | 'album'): PlatformResult {
  const data = object(raw); const result: PlatformResult = { tracks: [], items: [], categories: [] };
  const songs = Array.isArray(raw) && raw.some(item => object(item).artist !== undefined) ? raw : list(data.songs);
  for (const value of songs.slice(0, 500)) {
    const song = object(value); const actualSource = SOURCES.includes(song.source) ? song.source as MusicSource : source;
    if (!song.id || !song.name) continue;
    const duration = Number(song.duration || 0);
    const page = safePlatformImage(song.link);
    const sourceUrl = page && SOURCE_PAGE_HOSTS[actualSource].some(host => new URL(page).hostname === host || new URL(page).hostname.endsWith(`.${host}`)) ? page : null;
    result.tracks.push({ id: `${actualSource}:${song.id}`, source: actualSource, sourceTrackId: text(song.id), title: text(song.name), artist: text(song.artist), album: text(song.album),
      duration: Number.isFinite(duration) && duration > 0 ? Math.round(duration * 1000) : 0, coverUrl: safePlatformImage(song.cover), sourceUrl });
  }
  const collections = Array.isArray(raw) && !songs.length ? raw : [...list(data.playlists), ...list(data.albums)];
  for (const value of collections.slice(0, 100)) {
    const item = object(value); if (!item.id || !item.name) continue;
    result.items.push({ id: text(item.id), source: SOURCES.includes(item.source) ? item.source : source, name: text(item.name), cover: safePlatformImage(item.cover),
      description: text(item.description), count: Number(item.track_count || 0), kind: list(data.albums).includes(value) ? 'album' : kind });
  }
  const categories = Array.isArray(raw) ? raw : list(data.categories);
  result.categories = categories.filter(value => value.id && value.name && !value.source && !value.cover).slice(0, 100).map(value => ({ id: text(value.id), name: text(value.name) }));
  return result;
}

export async function queryPlatform(query: PlatformQuery): Promise<PlatformResult> {
  const direct = query.source === 'netease' && ['recommend', 'search', 'detail'].includes(query.mode);
  let directError: unknown;
  if (direct) {
    try { return await queryNeteaseDiscovery(query); }
    catch (error) { directError = error; /* The bundled provider remains a second independent path. */ }
  }
  const params = { source: query.source, page: String(query.page), limit: '30' };
  let path: string; let extra: Record<string, string> = {};
  switch (query.mode) {
    case 'search': path = 'music/search'; extra = { q: query.q, type: query.type, sources: query.source }; break;
    case 'link': {
      const url = new URL(query.q);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !Object.values(SOURCE_PAGE_HOSTS).flat().some(host => url.hostname === host || url.hostname.endsWith(`.${host}`))) throw new Error('请输入支持平台的公开分享链接。');
      path = 'music/search'; extra = { q: url.href }; break;
    }
    case 'recommend': path = 'playlist/recommend'; extra = { sources: query.source }; break;
    case 'categories': path = 'playlist/categories'; extra = { sources: query.source }; break;
    case 'category': path = 'playlist/category'; extra = { category_id: query.id }; break;
    case 'personal': path = 'playlist/user'; break;
    case 'detail': path = query.type === 'album' ? 'album/detail' : 'playlist/detail'; extra = { id: query.id }; break;
  }
  let response: Record<string, any>;
  try { response = await platformRequest(path, { ...params, ...extra }); }
  catch (error) { throw directError || error; }
  const result = normalizePlatformResult(response.data, query.source, query.type === 'album' ? 'album' : 'playlist');
  if (query.mode === 'categories') {
    const raw = response.data;
    const groups = Array.isArray(raw) ? raw : [raw];
    const categoryItems = groups.flatMap(value => Array.isArray(object(value).categories) ? value.categories : [value]);
    result.categories = categoryItems.flatMap(value => {
      const item = object(value); return item.id && item.name ? [{ id: text(item.id), name: text(item.name) }] : [];
    }).slice(0, 100);
    result.items = [];
  }
  return result;
}
