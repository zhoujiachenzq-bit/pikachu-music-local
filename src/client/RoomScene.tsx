import { useEffect, useRef, type CSSProperties } from 'react';
import { CoastLiveScene, GardenLiveScene, HarborLiveScene } from './CoastLiveScene';
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
  if (theme !== 'night') return null;
  return <div className={`illustrated-landscape landscape-${theme}`} aria-hidden="true"/>;
}

/** Summer Coast's phone lyrics page: a sunlit shallow. The seabed is one plate baked offline, with what moves cut out of it; only the edges are dressed, so the lines keep the open water in the middle. */
export function CoastLyricsSea({ art, motion }: { art: boolean; motion: boolean }) {
  const sea = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const sync = () => { if (sea.current) sea.current.dataset.pageHidden = String(document.hidden); };
    sync(); document.addEventListener('visibilitychange', sync);
    return () => document.removeEventListener('visibilitychange', sync);
  }, []);
  return <div ref={sea} className="coast-sea" data-motion={motion} aria-hidden="true">
    {art ? <div className="coast-sea-plate">
      <img className="coast-sea-bed" src="/coast-sea.webp" alt="" decoding="async"/>
      <img className="coast-sea-weed left" src="/coast-sea-weed-left.webp" alt="" decoding="async"/>
      <img className="coast-sea-weed right" src="/coast-sea-weed-right.webp" alt="" decoding="async"/>
      <img className="coast-sea-fish far" src="/coast-sea-fish-far.webp" alt="" decoding="async"/>
      <img className="coast-sea-fish near" src="/coast-sea-fish-near.webp" alt="" decoding="async"/>
    </div> : <><i className="coast-sea-swell far"/><i className="coast-sea-swell mid"/><i className="coast-sea-swell near"/></>}
    <i className="coast-sea-surface back"/><i className="coast-sea-surface front"/>
    <span className="coast-sea-bubbles"><i/><i/><i/><i/><i/></span>
  </div>;
}

/** Sea and You's phone lyrics page: the whole picture behind the lines, alive while the page is open. */
export function HarborLyricsScene({ live }: { live: boolean }) {
  return <div className="harbor-lyrics-scene" aria-hidden="true">{live && <HarborLiveScene/>}<i/></div>;
}

export function RoomStage({ theme, motionEnabled = false, live = false }: { theme: 'night' | 'vinyl' | 'burgundy' | 'harbor' | 'comet' | 'miku'; coverUrl?: string | null; motionEnabled?: boolean; live?: boolean }) {
  // Starry Diva: the picture is a full-frame face, so the stage shows the star eyes and the lines get a solid band below.
  if (theme === 'miku') return <div className="room-stage miku-scene" data-motion={motionEnabled} aria-hidden="true">
    <i className="miku-shade"/>
  </div>;
  // Comet Rain: the still picture, a thin slanted rain over it and a veil that keeps the lines readable.
  if (theme === 'comet') return <div className="room-stage comet-scene" data-motion={motionEnabled} aria-hidden="true">
    <i className="comet-rain"/><i className="comet-shade"/>
  </div>;
  if (theme === 'harbor') return <div className="room-stage harbor-scene" data-motion={motionEnabled} aria-hidden="true">
    {live && <HarborLiveScene/>}
    <i className="harbor-shade"/>
  </div>;
  if (theme === 'burgundy') return <div className="room-stage garden-scene" data-motion={motionEnabled} aria-hidden="true">
    {live && <GardenLiveScene/>}
    <i className="garden-stars"/><i className="garden-haze"/><i className="garden-fireflies"/><i className="garden-shade"/>
  </div>;
  return <div className={`room-stage illustrated-scene scene-${theme}`} data-motion={motionEnabled} aria-hidden="true">
    {theme === 'night' && live && <CoastLiveScene/>}
    <i className="landscape-air"/><i className="landscape-light"/>
    {theme === 'vinyl' && motionEnabled && <span className="meadow-drift">{MEADOW_SEEDS.map((style, i) => <i key={i} style={style}/>)}</span>}
  </div>;
}
