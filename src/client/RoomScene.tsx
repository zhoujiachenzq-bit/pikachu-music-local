import type { ToneThemeId } from './visualTheme';

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
  </div>;
}
