export const SOURCES = ['migu', 'netease', 'qq', 'kuwo', 'kugou', 'qianqian', 'soda', 'fivesing', 'jamendo', 'joox', 'bilibili'] as const;
export type MusicSource = (typeof SOURCES)[number];
export const CORE_SOURCES: MusicSource[] = ['migu', 'netease', 'qq', 'kuwo'];
export const SEARCH_SOURCES = SOURCES.filter(source => source !== 'soda');
export const SOURCE_NAMES: Record<MusicSource, string> = { migu: '咪咕', netease: '网易云', qq: 'QQ', kuwo: '酷我', kugou: '酷狗', qianqian: '千千', soda: '汽水', fivesing: '5sing', jamendo: 'Jamendo', joox: 'JOOX', bilibili: '哔哩哔哩' };
export const SOURCE_PAGE_HOSTS: Record<MusicSource, string[]> = {
  migu: ['music.migu.cn', 'm.music.migu.cn'], netease: ['music.163.com', '163cn.tv'], qq: ['y.qq.com', 'i.y.qq.com', 'c.y.qq.com', 'c6.y.qq.com'], kuwo: ['kuwo.cn'],
  kugou: ['kugou.com'], qianqian: ['taihe.com', 'music.91q.com', 'music.baidu.com'], soda: ['qishui.douyin.com', 'music.douyin.com'],
  fivesing: ['5sing.kugou.com', '5sing.com'], jamendo: ['jamendo.com'], joox: ['joox.com'], bilibili: ['bilibili.com', 'b23.tv']
};

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
  canonicalKey?: string;
}

export interface ResolvedTrack extends Track {
  audioUrl: string;
  proxyUrl?: string | null;
  lyric: string | null;
  actualSource: MusicSource;
  fallback: boolean;
  backupProvider?: 'go-music-api';
  relayed?: boolean;
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
  totalTracks?: number;
  warnings?: string[];
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
  failures: Array<{ trackId?: string; track?: string; reason: string }>;
  createdAt: string;
  updatedAt: string;
}

export interface ApiErrorShape {
  error: { code: string; message: string; details?: unknown };
}

export interface RecommendedTrack extends Track {
  rank: number;
  score: number;
  reason: string;
  kind: 'familiar' | 'explore';
}

export interface DailyRecommendation {
  id: string;
  date: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  generatedAt: string | null;
  message: string;
  tracks: RecommendedTrack[];
}
