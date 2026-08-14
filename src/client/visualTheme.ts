export const TONE_THEME_IDS = ['night', 'vinyl', 'arcade', 'burgundy', 'cobalt', 'paper'] as const;

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
    name: { zh: '皮卡丘夜幕', en: 'Pikachu Night' },
    description: { zh: '克制黑黄与清晰层级', en: 'Practical black-yellow clarity' },
    canvas: '#05070d', surface: '#10131b', sceneAccent: '#857536', sceneGlow: '#e4dcb6',
    swatches: ['#05070d', '#202531', '#ffd84d'],
  },
  vinyl: {
    id: 'vinyl',
    name: { zh: '午夜唱片店', en: 'Midnight Records' },
    description: { zh: '唱片黑、暖奶油与印刷棕', en: 'Vinyl black, warm cream and print brown' },
    canvas: '#090806', surface: '#17130f', sceneAccent: '#a87842', sceneGlow: '#f0dfbb',
    swatches: ['#090806', '#8f6035', '#f0dfbb'],
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
    name: { zh: '暖纸工作室', en: 'Warm Paper Studio' },
    description: { zh: '暖纸底色与红蓝编辑块', en: 'Warm paper with red-blue editorial blocks' },
    canvas: '#f0e4c8', surface: '#fff6df', sceneAccent: '#f24b2a', sceneGlow: '#1768ff',
    swatches: ['#f0e4c8', '#f24b2a', '#1768ff'],
  },
};

export const TONE_THEME_GROUPS: readonly ToneThemeGroupDefinition[] = [
  {
    id: 'pikachu',
    name: { zh: '皮卡丘系列', en: 'Pikachu Series' },
    description: { zh: '三种黑夜能量叙事', en: 'Three electric night stories' },
    themes: ['night', 'vinyl', 'arcade'],
  },
  {
    id: 'curated',
    name: { zh: '策展色调', en: 'Curated Tones' },
    description: { zh: '剧场、画廊与编辑工作室', en: 'Theatre, gallery and editorial studio' },
    themes: ['burgundy', 'cobalt', 'paper'],
  },
] as const;

export const DEFAULT_VISUAL_PREFERENCES: VisualPreferences = { version: 1, theme: 'night', motionEnabled: true };

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
