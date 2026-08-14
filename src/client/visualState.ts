import type { Track } from '../shared/types';

export type StageMode = 'player' | 'daily';
export type MobileSection = 'daily' | 'search' | 'player' | 'library';

export interface VisualPalette {
  primary: string;
  secondary: string;
  glow: string;
  seed: number;
}

export interface WebglCapability {
  width: number;
  finePointer: boolean;
  reducedMotion: boolean;
}

const palettes = [
  ['#ffd84d', '#ff8a3d', '#ffe8a3'],
  ['#ffd84d', '#ec5f92', '#ffc5d9'],
  ['#ffd84d', '#4cc9b0', '#a3f3df'],
  ['#ffd84d', '#7392ff', '#c0ccff'],
  ['#ffd84d', '#a978ff', '#dcc6ff'],
] as const;

export function visualSeed(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function deriveVisualPalette(track: Track | null | undefined): VisualPalette {
  const seed = visualSeed(track ? `${track.title}|${track.artist}|${track.source}` : 'pikachu-music');
  const selected = palettes[seed % palettes.length];
  return { primary: selected[0], secondary: selected[1], glow: selected[2], seed };
}

export function stageAfterRecommendationPlay(current: StageMode): StageMode {
  return current;
}

export function shouldShowMiniPlayer(section: MobileSection, hasCurrentTrack: boolean): boolean {
  return hasCurrentTrack && section !== 'player';
}

export function shouldUseDesktopWebgl(capability: WebglCapability): boolean {
  return capability.width > 1080 && capability.finePointer && !capability.reducedMotion;
}

export function mobileSectionForStage(stage: StageMode): MobileSection {
  return stage === 'daily' ? 'daily' : 'player';
}
