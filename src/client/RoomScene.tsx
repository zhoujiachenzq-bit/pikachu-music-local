import type { CSSProperties } from 'react';
import type { ToneThemeId } from './visualTheme';

const MEADOW_SEEDS = Array.from({ length: 16 }, (_, i) => ({
  '--x': `${(i * 37) % 92}%`,
  '--y': `${6 + (i * 23) % 52}%`,
  '--s': `${9 + (i % 4) * 3}px`,
  '--d': `${13 + (i % 6) * 2.4}s`,
  '--delay': `${-(i * 2.9) % 21}s`,
  '--dx': `${150 + (i % 5) * 46}px`,
  '--dy': `${-110 - (i % 4) * 54}px`,
} as CSSProperties));

/** Illustrated depth without camera movement or additional WebGL. */
export function RoomLandscape({ theme }: { theme: ToneThemeId }) {
  if (theme !== 'night' && theme !== 'vinyl') return null;
  return <div className={`illustrated-landscape landscape-${theme}`} aria-hidden="true"/>;
}

export function RoomStage({ theme, motionEnabled = false }: { theme: 'night' | 'vinyl' | 'burgundy'; coverUrl?: string | null; motionEnabled?: boolean }) {
  if (theme === 'burgundy') return <div className="room-stage garden-scene" data-motion={motionEnabled} aria-hidden="true">
    <i className="garden-stars"/><i className="garden-haze"/><i className="garden-fireflies"/><i className="garden-shade"/>
  </div>;
  return <div className={`room-stage illustrated-scene scene-${theme}`} data-motion={motionEnabled} aria-hidden="true">
    <i className="landscape-air"/><i className="landscape-light"/>
    {theme === 'vinyl' && motionEnabled && <span className="meadow-drift">{MEADOW_SEEDS.map((style, i) => <i key={i} style={style}/>)}</span>}
  </div>;
}
