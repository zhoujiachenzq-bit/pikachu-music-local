export const TONE_THEME_IDS = ['paper', 'arcade', 'cobalt', 'night', 'vinyl', 'burgundy'] as const;

export type ToneThemeId = typeof TONE_THEME_IDS[number];

export interface ToneThemeDefinition {
  id: ToneThemeId;
  name: { zh: string; en: string };
  description: { zh: string; en: string };
  canvas: string;
  surface: string;
  sceneAccent: string;
  sceneGlow: string;
  swatches: readonly [string, string, string];
}

export interface ToneThemeGroupDefinition {
  id: 'pikachu' | 'curated';
  name: { zh: string; en: string };
  description: { zh: string; en: string };
  themes: readonly ToneThemeId[];
}

export interface VisualPreferences {
  version: 1;
  theme: ToneThemeId;
  motionEnabled: boolean;
  backgroundArtEnabled: boolean;
}

export type SceneQuality = 'off' | 'tablet' | 'desktop';
export type SceneVariant = 'vinyl' | 'arcade' | 'halo';

export const TONE_THEMES: Record<ToneThemeId, ToneThemeDefinition> = {
  night: {
    id: 'night',
    name: { zh: '夏日海岸', en: 'Summer Coast' },
    description: { zh: '海边明信片、邮票封面与整片海景', en: 'A seaside postcard with stamp covers and open water' },
    canvas: '#f7efe0', surface: '#fffcf5', sceneAccent: '#cb4630', sceneGlow: '#0f7c8a',
    swatches: ['#7fd0de', '#fffcf5', '#cb4630'],
  },
  vinyl: {
    id: 'vinyl',
    name: { zh: '晴空花野', en: 'Sunny Meadow' },
    description: { zh: '高墙远景、坡上大树与晴空花野', en: 'Sunlit meadow, hillside tree and monumental walls' },
    canvas: '#e6ebd4', surface: '#faf8e9', sceneAccent: '#527445', sceneGlow: '#d8dda8',
    swatches: ['#b3d6ed', '#dce6ab', '#527445'],
  },
  arcade: {
    id: 'arcade',
    name: { zh: '霓虹游戏厅', en: 'Neon Arcade' },
    description: { zh: '街机机台、CRT 歌词屏与高分榜', en: 'An arcade cabinet with a CRT and a high-score table' },
    canvas: '#08070f', surface: '#0f0d1c', sceneAccent: '#ff3d8b', sceneGlow: '#22e3ff',
    swatches: ['#08070f', '#ff3d8b', '#ffd23f'],
  },
  burgundy: {
    // Keep the stored ID compatible with existing account preferences.
    id: 'burgundy',
    name: { zh: '暮光花园', en: 'Twilight Garden' },
    description: { zh: '圆月门、樱花与湖光', en: 'A glowing moon gate, cherry blossom and lake light' },
    canvas: '#fdeef5', surface: '#fff7fb', sceneAccent: '#c0327f', sceneGlow: '#c14dff',
    swatches: ['#fdeef5', '#c14dff', '#c0327f'],
  },
  cobalt: {
    id: 'cobalt',
    name: { zh: '钴蓝画廊', en: 'Cobalt Gallery' },
    description: { zh: '电蓝网格与冷光结构', en: 'Electric grids and cyan structures' },
    canvas: '#00113d', surface: '#062a7d', sceneAccent: '#2867ff', sceneGlow: '#72e4ff',
    swatches: ['#00113d', '#075cff', '#72e4ff'],
  },
  paper: {
    id: 'paper',
    name: { zh: '剪纸画室', en: 'Papercut Studio' },
    description: { zh: '暖纸底色与红蓝拼贴', en: 'Warm paper with red-blue collage' },
    canvas: '#f0e4c8', surface: '#fff6df', sceneAccent: '#f24b2a', sceneGlow: '#1768ff',
    swatches: ['#f0e4c8', '#f24b2a', '#1768ff'],
  },
};

export const TONE_THEME_GROUPS: readonly ToneThemeGroupDefinition[] = [
  {
    id: 'pikachu',
    name: { zh: '经典设计', en: 'Signature Designs' },
    description: { zh: '剪纸拼贴、霓虹与电蓝画廊', en: 'Papercut, neon and electric-blue gallery' },
    themes: ['paper', 'arcade', 'cobalt'],
  },
  {
    id: 'curated',
    name: { zh: '治愈风景', en: 'Restful Landscapes' },
    description: { zh: '海岸、花野与暮光花园', en: 'Coast, meadow and twilight garden' },
    themes: ['night', 'vinyl', 'burgundy'],
  },
] as const;

export const DEFAULT_VISUAL_PREFERENCES: VisualPreferences = { version: 1, theme: 'paper', motionEnabled: true, backgroundArtEnabled: true };

export function isToneThemeId(value: unknown): value is ToneThemeId {
  return typeof value === 'string' && (TONE_THEME_IDS as readonly string[]).includes(value);
}

export function visualPreferencesStorageKey(userId: string): string {
  return `pikachu:visual-preferences:v1:${userId}`;
}

export function parseVisualPreferences(raw: string | null | undefined): VisualPreferences {
  if (!raw) return { ...DEFAULT_VISUAL_PREFERENCES };
  try {
    const value = JSON.parse(raw) as Partial<VisualPreferences> | null;
    if (!value || value.version !== 1 || !isToneThemeId(value.theme) || typeof value.motionEnabled !== 'boolean') return { ...DEFAULT_VISUAL_PREFERENCES };
    return { version: 1, theme: value.theme, motionEnabled: value.motionEnabled, backgroundArtEnabled: typeof value.backgroundArtEnabled === 'boolean' ? value.backgroundArtEnabled : true };
  } catch {
    return { ...DEFAULT_VISUAL_PREFERENCES };
  }
}

export function readVisualPreferences(storage: Pick<Storage, 'getItem'>, userId: string): VisualPreferences {
  return parseVisualPreferences(storage.getItem(visualPreferencesStorageKey(userId)));
}

export function writeVisualPreferences(storage: Pick<Storage, 'setItem'>, userId: string, value: VisualPreferences): void {
  storage.setItem(visualPreferencesStorageKey(userId), JSON.stringify(value));
}

export function resolveToneTheme(committed: ToneThemeId, preview: ToneThemeId | null): ToneThemeId {
  return preview || committed;
}

export function sceneVariantForTheme(theme: ToneThemeId): SceneVariant {
  if (theme === 'vinyl') return 'vinyl';
  if (theme === 'arcade') return 'arcade';
  return 'halo';
}

export function selectSceneQuality({ width, reducedMotion, motionEnabled, webglAvailable = true, fullMobile = false }: { width: number; reducedMotion: boolean; motionEnabled: boolean; webglAvailable?: boolean; fullMobile?: boolean }): SceneQuality {
  if (!webglAvailable || !motionEnabled || reducedMotion) return 'off';
  if (width <= 760) return fullMobile ? 'desktop' : 'off';
  return width <= 1080 ? 'tablet' : 'desktop';
}

export function shouldAnimateCssScene({ motionEnabled, reducedMotion }: { motionEnabled: boolean; reducedMotion: boolean }): boolean {
  return motionEnabled && !reducedMotion;
}
