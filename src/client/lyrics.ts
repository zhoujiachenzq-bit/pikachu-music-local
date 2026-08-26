export interface LyricLine { time: number; text: string; kind: 'lyric' | 'credit' }

const creditLine = /^(?:(?:作词|作曲|词|曲|演唱|歌手|编曲|制作人|配唱制作人|监制|混音(?:师)?|录音(?:师|棚)?|音频剪辑|和声(?:编写)?|弦乐|吉他|贝斯|鼓|母带|出品|发行|企划|统筹|宣发|版权|OP|SP|Lyrics?|Composed|Composer|Vocal|Singer|Arranger|Strings?|Mixing|Mastering|Producer|Audio\s*Clip)(?:\s*[A-Za-z ]+)?\s*[:：]|ISRC(?:\s*[:：]|\s+[A-Z0-9-])|【?未经著作权人许可|【?未经许可不得)/i;

export const isLyricCreditLine = (text: string) => creditLine.test(text.trim());

const timestamp = /\[(\d{1,2}):(\d{2}(?:\.\d{1,3})?)\]/g;
const leadingTimestamps = /^(?:\[\d{1,2}:\d{2}(?:\.\d{1,3})?\]\s*)+/;

function normalizedLyricKey(time: number, text: string) {
  return `${Math.round(time * 1000)}\u0000${text.replace(/\s+/g, ' ').trim()}`;
}

export function parseLrc(raw: string | null): LyricLine[] {
  if (!raw) return [];
  const lines: LyricLine[] = [];
  raw.split(/\r?\n/).forEach(line => {
    const content = line.replace(/\[[a-z]+:.*?\]/gi, '').trimStart();
    const leading = content.match(leadingTimestamps)?.[0];
    if (!leading) return;
    const words = content.slice(leading.length).replace(timestamp, '').trim();
    if (!words) return;
    // Enhanced LRC puts a timestamp before every word. Only timestamps in the
    // leading block represent whole-line positions; inline tags are word timing.
    for (const match of leading.matchAll(timestamp)) {
      lines.push({ time: Number(match[1]) * 60 + Number(match[2]), text: words, kind: isLyricCreditLine(words) ? 'credit' : 'lyric' });
    }
  });
  const seen = new Set<string>();
  const timed = lines.filter(line => line.text).sort((a, b) => a.time - b.time).filter(line => {
    const key = normalizedLyricKey(line.time, line.text);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (timed.length) return timed;
  return raw.split(/\r?\n/)
    .filter(line => !/^\[(ar|ti|al|by|offset):/i.test(line.trim()))
    .map(line => line.replace(/^\[[^\]]+\]\s*/, '').trim()).filter(Boolean)
    .map(text => ({ time: Number.POSITIVE_INFINITY, text, kind: isLyricCreditLine(text) ? 'credit' as const : 'lyric' as const }));
}

export function findActiveLyric(lines: LyricLine[], currentTime: number) {
  if (!Number.isFinite(currentTime)) return -1;
  return lines.findLastIndex(line => line.kind !== 'credit' && Number.isFinite(line.time) && line.time <= currentTime);
}

export function lyricCenterOffset(lineTop: number, lineHeight: number, viewportHeight: number, scrollHeight: number) {
  if (![lineTop, lineHeight, viewportHeight, scrollHeight].every(Number.isFinite)) return 0;
  const centered = lineTop + lineHeight / 2 - viewportHeight / 2;
  return Math.min(Math.max(0, centered), Math.max(0, scrollHeight - viewportHeight));
}

export function lyricClickSeekTime(lineTime: number, prerollSeconds = .3) {
  if (!Number.isFinite(lineTime) || !Number.isFinite(prerollSeconds) || prerollSeconds < 0) return Number.NaN;
  return Math.max(0, lineTime - prerollSeconds);
}

export function findUntimedLyricStart(lines: LyricLine[]) {
  if (!lines.length || lines.some(line => line.kind !== 'credit' && Number.isFinite(line.time))) return 0;
  const firstCredit = lines.slice(0, 8).findIndex(line => line.kind === 'credit');
  if (firstCredit < 0) return 0;
  let lastCredit = firstCredit;
  const scanEnd = Math.min(lines.length, 30);
  for (let index = firstCredit + 1; index < scanEnd; index += 1) {
    if (lines[index].kind === 'credit') lastCredit = index;
  }
  return Math.min(lines.length, lastCredit + 1);
}

export function estimateUntimedLyricTime(index: number, total: number, duration: number, contentStart = 0) {
  if (!Number.isInteger(index) || !Number.isInteger(total) || total <= 0 || !Number.isInteger(contentStart) || contentStart < 0 || contentStart >= total || index < contentStart || index >= total || !Number.isFinite(duration) || duration <= 0) return Number.NaN;
  const contentTotal = total - contentStart;
  const contentIndex = index - contentStart;
  if (contentTotal === 1) return duration / 2;
  const ratio = contentIndex / (contentTotal - 1);
  return Math.min(Math.max(0, duration * (.05 + ratio * .9)), Math.max(0, duration - .05));
}
