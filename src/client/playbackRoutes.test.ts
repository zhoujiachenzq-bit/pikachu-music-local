import { describe, expect, it } from 'vitest';
import type { ResolvedTrack } from '../shared/types';
import { playbackCandidates } from './playbackRoutes';

const track: ResolvedTrack = { id: 'qq:1', source: 'qq', sourceTrackId: '1', title: 'Song', artist: 'Artist', album: '', duration: 1, coverUrl: null, sourceUrl: null, audioUrl: 'https://qqmusic.qq.com/song.m4a', lyric: null, actualSource: 'qq', fallback: false };

describe('playback connection candidates', () => {
  it('tries direct media before the same-origin compatibility relay', () => {
    const candidates = playbackCandidates({ ...track, proxyUrl: '/api/media/ticket' });
    expect(candidates).toHaveLength(2); expect(candidates[0].audioUrl).toBe(track.audioUrl); expect(candidates[0].relayed).toBeUndefined();
    expect(candidates[1]).toMatchObject({ audioUrl: '/api/media/ticket', relayed: true });
  });
  it('does not duplicate an already same-origin backup route', () => {
    const backup = { ...track, audioUrl: '/api/backup-media?source=qq', proxyUrl: '/api/backup-media?source=qq' };
    expect(playbackCandidates(backup)).toEqual([backup]);
  });
});
