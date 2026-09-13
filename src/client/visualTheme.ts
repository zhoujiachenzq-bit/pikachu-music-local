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
}

export type SceneQuality = 'off' | 'tablet' | 'desktop';
export type SceneVariant = 'vinyl' | 'arcade' | 'halo';

export const TONE_THEMES: Record<ToneThemeId, ToneThemeDefinition> = {
  night: {
    id: 'night',
    name: { zh: '夏日海岸', en: 'Summer Coast' },
    description: { zh: '浅碧海水、奶白沙滩与棕榈树影', en: 'Turquoise waves, soft sand and palm shadows' },
    canvas: '#dceff2', surface: '#f2faf8', sceneAccent: '#287b89', sceneGlow: '#a7dce5',
    swatches: ['#91d3e5', '#fcf0d8', '#287b89'],
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
    description: { zh: '像素星空、青紫霓虹与扫描线', en: 'Pixel stars, cyan-magenta neon and scanlines' },
    canvas: '#05040b', surface: '#111027', sceneAccent: '#2fe6ff', sceneGlow: '#ff4bd8',
    swatches: ['#05040b', '#2fe6ff', '#ff4bd8'],
  },
  burgundy: {
    // Keep the stored ID compatible with existing account preferences.
    id: 'burgundy',
    name: { zh: '暮光花园', en: 'Twilight Garden' },
    description: { zh: '蓝紫暮色、暖灯小屋与粉色花海', en: 'Periwinkle dusk, a glowing cottage and pink meadows' },
    canvas: '#252747', surface: '#343659', sceneAccent: '#efc3d7', sceneGlow: '#a9b2ef',
    swatches: ['#414f96', '#aa7caf', '#ffd7aa'],
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

export const DEFAULT_VISUAL_PREFERENCES: VisualPreferences = { version: 1, theme: 'paper', motionEnabled: true };

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
    return { version: 1, theme: value.theme, motionEnabled: value.motionEnabled };
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
