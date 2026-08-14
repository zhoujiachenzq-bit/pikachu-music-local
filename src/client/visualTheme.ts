export const TONE_THEME_IDS = ['night', 'burgundy', 'cobalt', 'paper'] as const;

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

export interface VisualPreferences {
  version: 1;
  theme: ToneThemeId;
  motionEnabled: boolean;
}

export type SceneQuality = 'off' | 'tablet' | 'desktop';

export const TONE_THEMES: Record<ToneThemeId, ToneThemeDefinition> = {
  night: {
    id: 'night',
    name: { zh: '皮卡丘夜幕', en: 'Pikachu Night' },
    description: { zh: '深夜黑与皮卡丘黄', en: 'Midnight black and Pikachu yellow' },
    canvas: '#05070d', surface: '#0a0d15', sceneAccent: '#6577a8', sceneGlow: '#aeb9de',
    swatches: ['#05070d', '#171c2a', '#ffd84d'],
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

export function selectSceneQuality({ width, reducedMotion, motionEnabled, webglAvailable = true, fullMobile = false }: { width: number; reducedMotion: boolean; motionEnabled: boolean; webglAvailable?: boolean; fullMobile?: boolean }): SceneQuality {
  if (!webglAvailable || !motionEnabled || reducedMotion) return 'off';
  if (width <= 760) return fullMobile ? 'desktop' : 'off';
  return width <= 1080 ? 'tablet' : 'desktop';
}

export function shouldAnimateCssScene({ motionEnabled, reducedMotion }: { motionEnabled: boolean; reducedMotion: boolean }): boolean {
  return motionEnabled && !reducedMotion;
}
