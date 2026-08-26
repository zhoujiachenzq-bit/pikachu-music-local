import { describe, expect, it } from 'vitest';
import { estimateUntimedLyricTime, findActiveLyric, findUntimedLyricStart, lyricCenterOffset, lyricClickSeekTime, parseLrc } from './lyrics';

describe('lyrics helpers', () => {
  it('does not activate the first line before its timestamp', () => {
    const lines = parseLrc('[00:05.00]第一句\n[00:10.00]第二句');
    expect(findActiveLyric(lines, 0)).toBe(-1);
    expect(findActiveLyric(lines, 5)).toBe(0);
    expect(findActiveLyric(lines, 12)).toBe(1);
  });

  it('keeps timed production credits visible but outside seeking and lyric following', () => {
    const lines = parseLrc('[00:00.00]作词: 林夕\n[00:01.00]录音棚: Big J Studio\n[00:02.00]ISRC CN-D14-14-00063\n[00:04.00]看着飞舞的尘埃掉下来');
    expect(lines.slice(0, 3).every(line => line.kind === 'credit')).toBe(true);
    expect(lines[3]).toMatchObject({ kind: 'lyric', time: 4 });
    expect(findActiveLyric(lines, 3.9)).toBe(-1);
    expect(findActiveLyric(lines, 4)).toBe(3);
  });

  it('treats inline timestamps as enhanced word timing instead of duplicate lines', () => {
    const lines = parseLrc('[00:31.29]又[00:31.53]站[00:31.89]在[00:32.18]你[00:32.55]家[00:32.90]的[00:33.23]门[00:33.65]口[00:34.16]\n[00:37.41]这[00:37.67]样[00:37.93]子[00:38.16]单[00:38.51]方[00:38.81]面[00:39.07]的[00:39.31]守[00:39.68]候[00:41.26]');
    expect(lines).toEqual([
      { time: 31.29, text: '又站在你家的门口', kind: 'lyric' },
      { time: 37.41, text: '这样子单方面的守候', kind: 'lyric' },
    ]);
    expect(findActiveLyric(lines, 35)).toBe(0);
  });

  it('preserves standard multiple leading timestamps and removes exact duplicates', () => {
    const lines = parseLrc('[00:10.00][01:20.00]重复出现的副歌\n[00:10.000]重复出现的副歌');
    expect(lines).toEqual([
      { time: 10, text: '重复出现的副歌', kind: 'lyric' },
      { time: 80, text: '重复出现的副歌', kind: 'lyric' },
    ]);
  });

  it('keeps untimed lyrics visible without inventing an active line', () => {
    const lines = parseLrc('第一句\n第二句');
    expect(lines).toHaveLength(2);
    expect(findActiveLyric(lines, 99)).toBe(-1);
  });

  it('centers a clicked lyric without overshooting either end', () => {
    expect(lyricCenterOffset(20, 40, 400, 1600)).toBe(0);
    expect(lyricCenterOffset(760, 40, 400, 1600)).toBe(580);
    expect(lyricCenterOffset(1540, 40, 400, 1600)).toBe(1200);
  });

  it('seeks slightly before the lyric start without crossing zero', () => {
    expect(lyricClickSeekTime(31.29)).toBeCloseTo(30.99, 5);
    expect(lyricClickSeekTime(.2)).toBe(0);
    expect(lyricClickSeekTime(10, 0)).toBe(10);
    expect(lyricClickSeekTime(Number.NaN)).toBeNaN();
  });

  it('estimates positions for lyrics without timestamps', () => {
    expect(estimateUntimedLyricTime(0, 5, 100)).toBe(5);
    expect(estimateUntimedLyricTime(2, 5, 100)).toBe(50);
    expect(estimateUntimedLyricTime(4, 5, 100)).toBe(95);
    expect(estimateUntimedLyricTime(0, 1, 100)).toBe(50);
    expect(estimateUntimedLyricTime(4, 0, 100)).toBeNaN();
  });

  it('starts untimed estimation at the first sung lyric after credits', () => {
    const lines = parseLrc('知了\n作词Lyrics: 王琛\n作曲Composed: 林辞远\n编曲Arranger: 林亦\n【未经著作权人许可不得翻唱翻录或使用】\n摩挲过记忆的尾巴\n知了叫了一整个夏');
    const start = findUntimedLyricStart(lines);
    expect(start).toBe(5);
    expect(estimateUntimedLyricTime(4, lines.length, 100, start)).toBeNaN();
    expect(estimateUntimedLyricTime(5, lines.length, 100, start)).toBe(5);
    expect(estimateUntimedLyricTime(6, lines.length, 100, start)).toBe(95);
  });

  it('keeps the first line when plain lyrics contain no credit block', () => {
    const lines = parseLrc('第一句歌词\n第二句歌词');
    expect(findUntimedLyricStart(lines)).toBe(0);
  });
});
