import { describe, expect, it } from 'vitest';
import { estimateUntimedLyricTime, findActiveLyric, findUntimedLyricStart, lyricCenterOffset, parseLrc } from './lyrics';

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
