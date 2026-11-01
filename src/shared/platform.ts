import type { MusicSource, Track } from './types.js';

export interface PlatformItem { id: string; source: MusicSource; name: string; cover: string | null; description: string; count: number; kind: 'playlist' | 'album'; }
export interface PlatformResult { tracks: Track[]; items: PlatformItem[]; categories: Array<{ id: string; name: string }>; }
export const QR_SOURCES = ['netease', 'qq', 'qq_wx', 'kugou', 'bilibili'] as const;
export type QrSource = (typeof QR_SOURCES)[number];
export interface PlatformQr { session: string; url: string; imageUrl: string; expiresAt: number; }
