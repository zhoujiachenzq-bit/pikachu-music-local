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

export type AgentPersona = 'warm' | 'bright' | 'poetic';
export type AgentConversationKind = 'main' | 'temporary';
export type AgentToolRisk = 'direct' | 'confirm' | 'forbidden';
export type { AgentVoiceOption, AgentVoiceProfileId, AgentVoiceProviderId } from './agentVoices.js';

export interface AgentAccess {
  enabled: boolean;
  entitled: boolean;
  admin: boolean;
  configured: boolean;
  reason?: string;
}

export interface AgentSettings {
  assistantName: string;
  persona: AgentPersona;
  proactiveEnabled: boolean;
  memoryEnabled: boolean;
  autoRead: boolean;
  voice: string;
}

export interface AgentConversation {
  id: string;
  kind: AgentConversationKind;
  status: 'active' | 'closed';
  createdAt: string;
  updatedAt: string;
  expiresAt: string | null;
}

export interface AgentMessage {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface AgentMemory {
  id: string;
  category: 'preference' | 'person' | 'event' | 'plan' | 'context';
  content: string;
  confidence: number;
  inferred: boolean;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AgentClientContext {
  currentTrack: Track | null;
  queue: Track[];
  playing: boolean;
  currentTime: number;
  volume: number;
  playMode: User['playMode'];
  mobileSection?: 'daily' | 'search' | 'player' | 'library' | 'agent';
  toneTheme?: string;
}

export type AgentClientAction =
  | { type: 'play_track'; track: Track; queue?: Track[]; reason?: string; startAtSeconds?: number; resumePlayback?: boolean }
  | { type: 'pause' | 'resume' | 'next' | 'previous' | 'retry_current' }
  | { type: 'seek'; seconds: number }
  | { type: 'set_volume'; volume: number }
  | { type: 'set_play_mode'; mode: User['playMode'] }
  | { type: 'set_theme'; theme: string }
  | { type: 'clear_client_cache' }
  | { type: 'navigate'; section: 'daily' | 'search' | 'player' | 'library' | 'agent' };

export interface AgentClientActionResult {
  ok: boolean;
  message?: string;
  undoAction?: AgentClientAction;
}

export type AgentStreamEvent =
  | { type: 'text_delta'; delta: string }
  | { type: 'reason_card'; title: string; body: string; tracks?: Track[]; kind?: 'recommendation' | 'safety' | 'diagnostic' }
  | { type: 'citation'; title: string; url?: string; kind?: 'web' | 'knowledge'; detail?: string }
  | { type: 'tool_started'; tool: string }
  | { type: 'action_required'; actionId: string; tool: string; summary: string; input: unknown; expiresAt: string }
  | { type: 'client_action'; actionId: string; action: AgentClientAction }
  | { type: 'action_result'; actionId: string; ok: boolean; message?: string }
  | { type: 'usage'; model: string; inputTokens: number; outputTokens: number; estimatedCostCny: number }
  | { type: 'done'; runId: string; messageId: string }
  | { type: 'error'; code: string; message: string };
