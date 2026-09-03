export const TONE_THEME_IDS = ['paper', 'night', 'vinyl', 'arcade', 'burgundy', 'cobalt'] as const;

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
    name: { zh: '剪纸夜幕', en: 'Paper Night' },
    description: { zh: '靛蓝纸山与暖黄月光', en: 'Indigo paper hills and a warm moon' },
    canvas: '#07111f', surface: '#122039', sceneAccent: '#f0b93f', sceneGlow: '#ffe39a',
    swatches: ['#07111f', '#243b62', '#f0b93f'],
  },
  vinyl: {
    id: 'vinyl',
    name: { zh: '纸上唱片店', en: 'Vinyl Room' },
    description: { zh: '奶油纸、唱片黑与砖红标签', en: 'Cream paper, vinyl black and brick-red labels' },
    canvas: '#d8c39e', surface: '#f5ead3', sceneAccent: '#a84432', sceneGlow: '#e2aa39',
    swatches: ['#efe1c4', '#191613', '#a84432'],
  },
  arcade: {
    id: 'arcade',
    name: { zh: '霓虹游戏厅', en: 'Neon Arcade' },
    description: { zh: '像素星空、青紫霓虹与扫描线', en: 'Pixel stars, cyan-magenta neon and scanlines' },
    canvas: '#05040b', surface: '#111027', sceneAccent: '#2fe6ff', sceneGlow: '#ff4bd8',
    swatches: ['#05040b', '#2fe6ff', '#ff4bd8'],
  },
  burgundy: {
    id: 'burgundy',
    name: { zh: '酒红剧场', en: 'Burgundy Theatre' },
    description: { zh: '深红幕布与粉色聚光', en: 'Crimson curtains and vivid spotlights' },
    canvas: '#160006', surface: '#310815', sceneAccent: '#ff2864', sceneGlow: '#ff9cbd',
    swatches: ['#160006', '#8b123a', '#ff5a88'],
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
    name: { zh: '纸上音乐馆', en: 'Paper Music Rooms' },
    description: { zh: '剪纸画室、月夜与唱片店', en: 'Papercut studio, moonlit hills and a record room' },
    themes: ['paper', 'night', 'vinyl'],
  },
  {
    id: 'curated',
    name: { zh: '沉浸色场', en: 'Immersive Color Fields' },
    description: { zh: '霓虹、剧场与电蓝画廊', en: 'Neon, theatre and electric-blue gallery' },
    themes: ['arcade', 'burgundy', 'cobalt'],
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
