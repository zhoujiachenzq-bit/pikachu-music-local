import type { ResolvedTrack } from '../shared/types';

export function playbackCandidates(track: ResolvedTrack): ResolvedTrack[] {
  if (!track.proxyUrl || track.proxyUrl === track.audioUrl) return [track];
  return [track, { ...track, audioUrl: track.proxyUrl, relayed: true }];
}
