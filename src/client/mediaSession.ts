import type { ResolvedTrack, Track } from '../shared/types';

export interface MediaSessionControls {
  play: () => void;
  pause: () => void;
  next: () => void;
  previous: () => void;
  seek: (time: number) => void;
  seekBy: (offset: number) => void;
}

export function installMediaSessionControls(controls: MediaSessionControls) {
  if (!('mediaSession' in navigator)) return () => undefined;
  const handlers: Partial<Record<MediaSessionAction, MediaSessionActionHandler>> = {
    play: () => controls.play(), pause: () => controls.pause(), nexttrack: () => controls.next(), previoustrack: () => controls.previous(),
    seekbackward: details => controls.seekBy(-(details.seekOffset || 10)),
    seekforward: details => controls.seekBy(details.seekOffset || 10),
    seekto: details => { if (typeof details.seekTime === 'number') controls.seek(details.seekTime); },
  };
  for (const [action, handler] of Object.entries(handlers) as Array<[MediaSessionAction, MediaSessionActionHandler]>) {
    try { navigator.mediaSession.setActionHandler(action, handler); } catch { /* Older Chrome may omit an action. */ }
  }
  return () => {
    for (const action of Object.keys(handlers) as MediaSessionAction[]) {
      try { navigator.mediaSession.setActionHandler(action, null); } catch { /* Ignore unsupported actions. */ }
    }
  };
}

export function updateMediaMetadata(track: Track | null, resolved: ResolvedTrack | null) {
  if (!('mediaSession' in navigator)) return;
  if (!track) { navigator.mediaSession.metadata = null; return; }
  const cover = resolved?.coverUrl || track.coverUrl;
  const artwork: MediaImage[] = [];
  if (cover && (/^https:\/\//i.test(cover) || cover.startsWith('/'))) artwork.push({ src: cover });
  artwork.push({ src: '/pikachu-192.png', sizes: '192x192', type: 'image/png' }, { src: '/pikachu-512.png', sizes: '512x512', type: 'image/png' });
  navigator.mediaSession.metadata = new MediaMetadata({
    title: resolved?.title || track.title,
    artist: resolved?.artist || track.artist,
    album: resolved?.album || track.album,
    artwork,
  });
}

export function mediaPosition(duration: number, position: number, playbackRate = 1) {
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(position)) return null;
  return { duration, position: Math.min(duration, Math.max(0, position)), playbackRate: Number.isFinite(playbackRate) && playbackRate > 0 ? playbackRate : 1 };
}

export function syncMediaSession(element: HTMLAudioElement, playing: boolean) {
  if (!('mediaSession' in navigator)) return;
  navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
  const position = mediaPosition(element.duration, element.currentTime, element.playbackRate);
  if (!position) return;
  try { navigator.mediaSession.setPositionState(position); } catch { /* Some streams do not expose a stable duration. */ }
}
