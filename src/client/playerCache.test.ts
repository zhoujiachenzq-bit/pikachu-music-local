import { describe, expect, it } from 'vitest';
import type { ResolvedTrack } from '../shared/types';
import { LYRIC_TTL_MS, PlaybackCache, RESOLVED_TTL_MS } from './playerCache';

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) || null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

const track: ResolvedTrack = {
  id: 'netease:1', source: 'netease', sourceTrackId: '1', title: '缓存歌曲', artist: '歌手', album: '', duration: 180_000,
  coverUrl: null, sourceUrl: null, audioUrl: 'https://example.com/song.mp3', lyric: '[00:00.00]缓存歌词', actualSource: 'netease', fallback: false
};

describe('persistent playback cache', () => {
  it('restores a recently resolved track in a new cache instance', () => {
    const storage = new MemoryStorage(); let now = 1000;
    new PlaybackCache(storage, () => now).rememberResolved(track);
    now += 1000;
    expect(new PlaybackCache(storage, () => now).getResolved(track.id)).toEqual(track);
  });

  it('expires temporary media URLs while retaining reusable lyrics', () => {
    const storage = new MemoryStorage(); let now = 1000; const cache = new PlaybackCache(storage, () => now); cache.rememberResolved(track);
    now += RESOLVED_TTL_MS + 1;
    expect(new PlaybackCache(storage, () => now).getResolved(track.id)).toBeNull();
    expect(new PlaybackCache(storage, () => now).getLyric(track.id)).toBe(track.lyric);
    now += LYRIC_TTL_MS;
    expect(new PlaybackCache(storage, () => now).getLyric(track.id)).toBeNull();
  });

  it('fills a missing lyric from the longer-lived local cache', () => {
    const storage = new MemoryStorage(); const cache = new PlaybackCache(storage, () => 1000); cache.rememberResolved(track);
    expect(cache.withRememberedLyric({ ...track, lyric: null }).lyric).toBe(track.lyric);
  });

  it('drops a failed media URL without discarding its lyric', () => {
    const storage = new MemoryStorage(); const cache = new PlaybackCache(storage, () => 1000); cache.rememberResolved(track); cache.forgetResolved(track.id);
    expect(cache.getResolved(track.id)).toBeNull(); expect(cache.getLyric(track.id)).toBe(track.lyric);
  });
});
