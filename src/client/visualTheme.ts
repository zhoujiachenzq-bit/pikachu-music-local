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
    description: { zh: '酒窖暗红与香槟光', en: 'Cellar red and champagne light' },
    canvas: '#10070b', surface: '#1a0d13', sceneAccent: '#8e304d', sceneGlow: '#d596a9',
    swatches: ['#10070b', '#4a1728', '#d596a9'],
  },
  cobalt: {
    id: 'cobalt',
    name: { zh: '钴蓝画廊', en: 'Cobalt Gallery' },
    description: { zh: '深海钴蓝与冷白画框', en: 'Deep cobalt and cool gallery light' },
    canvas: '#06101f', surface: '#0b192d', sceneAccent: '#3c74ff', sceneGlow: '#9ab7ff',
    swatches: ['#06101f', '#154186', '#9ab7ff'],
  },
  paper: {
    id: 'paper',
    name: { zh: '暖纸工作室', en: 'Warm Paper Studio' },
    description: { zh: '暖白纸张与深色媒体舞台', en: 'Warm paper with a dark media stage' },
    canvas: '#e9e3d8', surface: '#f7f2e8', sceneAccent: '#315b88', sceneGlow: '#8ca9c3',
    swatches: ['#e9e3d8', '#f7f2e8', '#1a1917'],
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

export function selectSceneQuality({ width, reducedMotion, motionEnabled, webglAvailable = true }: { width: number; reducedMotion: boolean; motionEnabled: boolean; webglAvailable?: boolean }): SceneQuality {
  if (!webglAvailable || !motionEnabled || reducedMotion || width <= 760) return 'off';
  return width <= 1080 ? 'tablet' : 'desktop';
}

export function shouldAnimateCssScene({ motionEnabled, reducedMotion }: { motionEnabled: boolean; reducedMotion: boolean }): boolean {
  return motionEnabled && !reducedMotion;
}
