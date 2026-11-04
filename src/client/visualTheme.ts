export const TONE_THEME_IDS = ['paper', 'cobalt', 'miku', 'night', 'burgundy', 'harbor', 'comet'] as const;

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
  burgundy: {
    // Keep the stored ID compatible with existing account preferences.
    id: 'burgundy',
    name: { zh: '暮光花园', en: 'Twilight Garden' },
    description: { zh: '圆月门、樱花与湖光', en: 'A glowing moon gate, cherry blossom and lake light' },
    canvas: '#fdeef5', surface: '#fff7fb', sceneAccent: '#c0327f', sceneGlow: '#c14dff',
    swatches: ['#fdeef5', '#c14dff', '#c0327f'],
  },
  harbor: {
    id: 'harbor',
    name: { zh: '海与你', en: 'Sea and You' },
    description: { zh: '夜海、对岸灯火与回眸', en: 'Night sea, far-shore lights and a glance back' },
    canvas: '#0b1430', surface: '#14204a', sceneAccent: '#9fd4ff', sceneGlow: '#ffc9dc',
    swatches: ['#0b1430', '#3aa8ff', '#ffe0b8'],
  },
  miku: {
    id: 'miku',
    name: { zh: '星眼歌姬', en: 'Starry Diva' },
    description: { zh: '星星眼、故障色块与电子流行', en: 'Star eyes, glitch blocks and electro pop' },
    canvas: '#0e0820', surface: '#1b1040', sceneAccent: '#39d5c9', sceneGlow: '#ff3fd0',
    swatches: ['#0e0820', '#39d5c9', '#ff3fd0'],
  },
  comet: {
    id: 'comet',
    name: { zh: '彗星雨夜', en: 'Comet Rain' },
    description: { zh: '夜雨、划过天际的彗星与红色组纽', en: 'Night rain, a comet across the sky and a red braided cord' },
    canvas: '#060c15', surface: '#0c1d2b', sceneAccent: '#ffb45c', sceneGlow: '#6fe0ff',
    swatches: ['#060c15', '#6fe0ff', '#e0394f'],
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
    description: { zh: '剪纸拼贴、电蓝画廊与电子歌姬', en: 'Papercut, electric-blue gallery and electro diva' },
    themes: ['paper', 'cobalt', 'miku'],
  },
  {
    id: 'curated',
    name: { zh: '治愈风景', en: 'Restful Landscapes' },
    description: { zh: '海岸、暮光花园、夜海与彗星雨夜', en: 'Coast, twilight garden, night sea and comet rain' },
    themes: ['night', 'burgundy', 'harbor', 'comet'],
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
    const value = JSON.parse(raw) as (Omit<Partial<VisualPreferences>, 'theme'> & { theme?: unknown }) | null;
    if (value?.theme === 'arcade' || value?.theme === 'vinyl') value.theme = DEFAULT_VISUAL_PREFERENCES.theme;
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

export function sceneVariantForTheme(_theme: ToneThemeId): SceneVariant {
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
