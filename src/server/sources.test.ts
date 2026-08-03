import { describe, expect, it } from 'vitest';
import { hasTimedLyric, isAmbiguousFallback, matchScore, parsePlaylistInput, resolveTrackWithFallback, SourceError } from './sources.js';
import { createDatabase, setCached } from './db.js';
import type { Track } from '../shared/types.js';

describe('playlist input parsing', () => {
  it('parses all four public playlist formats', () => {
    expect(parsePlaylistInput('https://music.migu.cn/v3/music/playlist/221731526')).toEqual({ source: 'migu', id: '221731526' });
    expect(parsePlaylistInput('https://music.163.com/#/playlist?id=3778678')).toEqual({ source: 'netease', id: '3778678' });
    expect(parsePlaylistInput('https://y.qq.com/n/ryqq/playlist/7011264340')).toEqual({ source: 'qq', id: '7011264340' });
    expect(parsePlaylistInput('https://www.kuwo.cn/web/inventory/share?pid=2095581898&type=2016')).toEqual({ source: 'kuwo', id: '2095581898' });
  });

  it('accepts numeric ids only with an explicit source', () => {
    expect(parsePlaylistInput('3778678', 'netease')).toEqual({ source: 'netease', id: '3778678' });
    expect(() => parsePlaylistInput('3778678')).toThrow(SourceError);
  });

  it('rejects arbitrary hosts to prevent SSRF', () => {
    expect(() => parsePlaylistInput('http://127.0.0.1:3000/private?id=12345', 'netease')).toThrow('链接不属于');
    expect(() => parsePlaylistInput('file:///etc/passwd', 'netease')).toThrow('只允许');
  });
});

describe('cross-source match scoring', () => {
  const base: Track = { id: 'netease:1', source: 'netease', sourceTrackId: '1', title: '修炼爱情', artist: '林俊杰', album: '', duration: 267_000, coverUrl: null, sourceUrl: null };
  it('scores exact title/artist/duration above automatic threshold', () => {
    expect(matchScore(base, { ...base, id: 'qq:2', source: 'qq', sourceTrackId: '2', duration: 269_000 })).toBeGreaterThanOrEqual(.9);
  });
  it('does not auto-match unrelated songs', () => {
    expect(matchScore(base, { ...base, id: 'qq:3', source: 'qq', sourceTrackId: '3', title: '江南', artist: '其他歌手', duration: 200_000 })).toBeLessThan(.8);
  });
  it('does not treat the same exact song from two platforms as ambiguous', () => {
    const qq = { ...base, id: 'qq:2', source: 'qq' as const, sourceTrackId: '2' }; const kuwo = { ...base, id: 'kuwo:3', source: 'kuwo' as const, sourceTrackId: '3' };
    expect(isAmbiguousFallback({ candidate: qq, score: .9 }, { candidate: kuwo, score: .9 })).toBe(false);
    expect(isAmbiguousFallback({ candidate: qq, score: .9 }, { candidate: { ...kuwo, title: '江南' }, score: .9 })).toBe(true);
  });
});

describe('temporary playback cache', () => {
  it('reuses a resolved public media URL without contacting the source again', async () => {
    const db = createDatabase(':memory:');
    const input: Track = { id: 'netease:1', source: 'netease', sourceTrackId: '1', title: '修炼爱情', artist: '林俊杰', album: '', duration: 267_000, coverUrl: null, sourceUrl: null };
    setCached(db, 'resolve:netease:1', { ...input, audioUrl: 'https://example.com/public.mp3', lyric: '[00:00.00]测试歌词', actualSource: 'netease', fallback: false }, 60_000);
    await expect(resolveTrackWithFallback(input, db)).resolves.toMatchObject({ audioUrl: 'https://example.com/public.mp3', lyric: '[00:00.00]测试歌词' });
    db.close();
  });

  it('keeps reusable lyrics longer than the temporary media response', async () => {
    const db = createDatabase(':memory:');
    const input: Track = { id: 'netease:2', source: 'netease', sourceTrackId: '2', title: '缓存歌词', artist: '测试歌手', album: '', duration: 180_000, coverUrl: null, sourceUrl: null };
    setCached(db, 'resolve:netease:2', { ...input, audioUrl: 'https://example.com/temporary.mp3', lyric: null, actualSource: 'netease', fallback: false }, 60_000);
    setCached(db, 'lyric:netease:2', { lyric: '[00:01.00]长期歌词缓存' }, 60_000);
    await expect(resolveTrackWithFallback(input, db)).resolves.toMatchObject({ lyric: '[00:01.00]长期歌词缓存' });
    db.close();
  });
});

describe('timed lyric detection', () => {
  it('distinguishes LRC timelines from plain lyric text', () => {
    expect(hasTimedLyric('[00:05.12]第一句\n[00:10.00]第二句')).toBe(true);
    expect(hasTimedLyric('第一句\n第二句')).toBe(false);
    expect(hasTimedLyric(null)).toBe(false);
  });
});
