export interface LyricLine { time: number; text: string }

export function parseLrc(raw: string | null): LyricLine[] {
  if (!raw) return [];
  const lines: LyricLine[] = [];
  raw.split(/\r?\n/).forEach(line => {
    const words = line.replace(/\[[a-z]+:.*?\]/gi, '').replace(/\[\d{1,2}:\d{2}(?:\.\d{1,3})?\]/g, '').trim();
    if (!words) return;
    for (const match of line.matchAll(/\[(\d{1,2}):(\d{2}(?:\.\d{1,3})?)\]/g)) {
      lines.push({ time: Number(match[1]) * 60 + Number(match[2]), text: words });
    }
  });
  const timed = lines.filter(line => line.text).sort((a, b) => a.time - b.time);
  if (timed.length) return timed;
  return raw.split(/\r?\n/)
    .filter(line => !/^\[(ar|ti|al|by|offset):/i.test(line.trim()))
    .map(line => line.replace(/^\[[^\]]+\]\s*/, '').trim()).filter(Boolean)
    .map(text => ({ time: Number.POSITIVE_INFINITY, text }));
}

export function findActiveLyric(lines: LyricLine[], currentTime: number) {
  if (!Number.isFinite(currentTime)) return -1;
  return lines.findLastIndex(line => Number.isFinite(line.time) && line.time <= currentTime);
}

export function lyricCenterOffset(lineTop: number, lineHeight: number, viewportHeight: number, scrollHeight: number) {
  if (![lineTop, lineHeight, viewportHeight, scrollHeight].every(Number.isFinite)) return 0;
  const centered = lineTop + lineHeight / 2 - viewportHeight / 2;
  return Math.min(Math.max(0, centered), Math.max(0, scrollHeight - viewportHeight));
}

const creditLine = /^(?:(?:作词|作曲|词|曲|演唱|歌手|编曲|制作人|监制|混音|录音|音频剪辑|和声|弦乐|吉他|贝斯|鼓|母带|出品|发行|企划|统筹|宣发|版权|OP|SP|Lyrics?|Composed|Composer|Vocal|Singer|Arranger|Strings?|Mixing|Mastering|Producer|Audio\s*Clip)(?:\s*[A-Za-z ]+)?\s*[:：]|【?未经著作权人许可|【?未经许可不得)/i;

export function findUntimedLyricStart(lines: LyricLine[]) {
  if (!lines.length || lines.some(line => Number.isFinite(line.time))) return 0;
  const firstCredit = lines.slice(0, 8).findIndex(line => creditLine.test(line.text.trim()));
  if (firstCredit < 0) return 0;
  let lastCredit = firstCredit;
  const scanEnd = Math.min(lines.length, 30);
  for (let index = firstCredit + 1; index < scanEnd; index += 1) {
    if (creditLine.test(lines[index].text.trim())) lastCredit = index;
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
