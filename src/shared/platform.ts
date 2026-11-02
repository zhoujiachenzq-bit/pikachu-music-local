import type { MusicSource, Track } from './types.js';

export interface PlatformItem { id: string; source: MusicSource; name: string; cover: string | null; description: string; count: number; kind: 'playlist' | 'album'; }
export interface PlatformResult { tracks: Track[]; items: PlatformItem[]; categories: Array<{ id: string; name: string }>; }
export const QR_SOURCES = ['netease', 'qq', 'qq_wx', 'kugou', 'bilibili'] as const;
export type QrSource = (typeof QR_SOURCES)[number];
// Matches the pinned bundled service's factory.go, not single-song search support.
export const PLATFORM_RECOMMEND_SOURCES: readonly MusicSource[] = ['netease', 'qq', 'kugou', 'kuwo'];
export const PLATFORM_CATEGORY_SOURCES: readonly MusicSource[] = ['netease', 'qq', 'kugou', 'kuwo', 'migu', 'qianqian', 'joox'];
export const PLATFORM_PERSONAL_SOURCES: readonly MusicSource[] = ['netease', 'qq', 'kugou'];
export const PLATFORM_ALBUM_SOURCES: readonly MusicSource[] = ['netease', 'qq', 'kugou', 'kuwo', 'migu', 'jamendo', 'joox', 'qianqian', 'soda'];
export interface PlatformQr { session: string; url: string; imageUrl: string; expiresAt: number; }
