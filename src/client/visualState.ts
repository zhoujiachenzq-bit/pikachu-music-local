import type { Track } from '../shared/types';
import { TONE_THEMES, type ToneThemeId } from './visualTheme';

export type StageMode = 'player' | 'daily';
export type MobileSection = 'daily' | 'search' | 'player' | 'library' | 'agent';

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

export const TRACK_COLOR_INFLUENCE = .55;

function hexChannels(value: string): [number, number, number] {
  const hex = value.replace('#', '');
  return [Number.parseInt(hex.slice(0, 2), 16), Number.parseInt(hex.slice(2, 4), 16), Number.parseInt(hex.slice(4, 6), 16)];
}

export function mixHex(base: string, overlay: string, overlayWeight: number): string {
  const a = hexChannels(base); const b = hexChannels(overlay); const weight = Math.max(0, Math.min(1, overlayWeight));
  return `#${a.map((channel, index) => Math.round(channel * (1 - weight) + b[index] * weight).toString(16).padStart(2, '0')).join('')}`;
}

export function visualSeed(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function deriveVisualPalette(track: Track | null | undefined, theme: ToneThemeId = 'night', artworkAccent?: string | null): VisualPalette {
  const seed = visualSeed(track ? `${track.title}|${track.artist}|${track.source}` : 'pikachu-music');
  const selected = palettes[seed % palettes.length];
  const definition = TONE_THEMES[theme];
  if (!track && !artworkAccent) {
    return { primary: '#ffd84d', secondary: definition.sceneAccent, glow: definition.sceneGlow, seed };
  }
  const songAccent = artworkAccent ? mixHex(selected[1], artworkAccent, .72) : selected[1];
  const songGlow = artworkAccent ? mixHex(artworkAccent, '#ffffff', .38) : selected[2];
  return {
    primary: selected[0],
    secondary: mixHex(definition.sceneAccent, songAccent, TRACK_COLOR_INFLUENCE),
    glow: mixHex(definition.sceneGlow, songGlow, TRACK_COLOR_INFLUENCE),
    seed,
  };
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
