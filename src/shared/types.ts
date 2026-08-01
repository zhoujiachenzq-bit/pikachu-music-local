export const SOURCES = ['migu', 'netease', 'qq', 'kuwo'] as const;
export type MusicSource = (typeof SOURCES)[number];

export interface Track {
  id: string;
  source: MusicSource;
  sourceTrackId: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  coverUrl: string | null;
  sourceUrl: string | null;
  keyword?: string;
  displayIndex?: number;
  quality?: string | null;
}

export interface ResolvedTrack extends Track {
  audioUrl: string;
  lyric: string | null;
  actualSource: MusicSource;
  fallback: boolean;
  sourceUrl: string | null;
}

export interface PlaylistSummary {
  id: string;
  name: string;
  description: string;
  coverUrl: string | null;
  source: MusicSource | null;
  sourcePlaylistId: string | null;
  sourceUrl: string | null;
  lastSyncedAt: string | null;
  trackCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface PlaylistDetail extends PlaylistSummary {
  tracks: Array<Track & { position: number; origin: 'source' | 'local'; excluded: boolean }>;
}

export interface ImportedPlaylist {
  source: MusicSource;
  sourcePlaylistId: string;
  title: string;
  description: string;
  coverUrl: string | null;
  sourceUrl: string;
  tracks: Track[];
}

export interface User {
  id: string;
  username: string;
  language: 'zh' | 'en';
  volume: number;
  playMode: 'list' | 'loop' | 'shuffle';
  createdAt: string;
}

export interface ImportJob {
  id: string;
  source: MusicSource;
  sourcePlaylistId: string;
  status: 'queued' | 'running' | 'completed' | 'partial' | 'failed';
  progress: number;
  processed: number;
  total: number;
  playlistId: string | null;
  message: string;
  failures: Array<{ track?: string; reason: string }>;
  createdAt: string;
  updatedAt: string;
}

export interface ApiErrorShape {
  error: { code: string; message: string; details?: unknown };
}
