const punctuation = /[\s\-‐‑‒–—―_·•.,，。!！?？:：;；'"“”‘’()[\]{}（）【】《》<>]/g;

const derivativeVersionPattern = /(?:翻唱|翻自|翻奏|cover(?:\s*version)?|(?<![a-z])(?:live|edit)(?![a-z])|现场(?:版|录音)?|演唱会版?|音乐会|特辑|铃声(?:版)?|手机铃声|伴奏|instrumental|karaoke|ktv|(?:^|[^a-z])dj(?:版|\s*(?:mix|remix))?(?:$|[^a-z])|remix|混音版?|纯音乐|钢琴版|吉他版|女声版|男声版|加速版|慢速版|sped\s*up|slowed(?:\s*down)?|8d(?:环绕)?|改编|指弹|弹唱|钢琴曲|吉他曲|串烧|medley|mashup|长音频|胎教|助眠|白噪音)/i;
// Crediting an original artist in the title means this recording is someone
// else's: "说了再见 (原唱: 周杰伦)". "(原唱版)" still names the original itself.
const creditedOriginalPattern = /原唱\s*[:：]|[（(【[](?![^）)】\]]*原唱版)[^）)】\]]*原唱[^）)】\]]*[）)】\]]/;
// Album names use "版" for ordinary editions, so these two only read the title.
const qualifiedEditionPattern = /[（(【[](?![^）)】\]]*(?:原唱|完整|正式|录音室|国语|粤语|闽南语|日语|英文|英语|韩语|电影|剧场)版)[^）)】\]]*版[）)】\]]/;
// Hashtags mark short-video clips rather than songs.
const medleyTitlePattern = /\s\+\s|\+[^+]+\+|#/;
const trailingQualifier = /\s*[（(【[]([^）)】\]]{1,48})[）)】\]]\s*$/;
const artistSeparators = /[/／,，、&＆;；|+()（）]|\s(?:feat\.?|ft\.?|with|x|×)\s/i;

export function normalizeTrackText(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/&nbsp;|&#160;/gi, ' ').replace(punctuation, '');
}

export function canonicalTrackKey(title: string, artist: string): string {
  return `${normalizeTrackText(title)}|${normalizeTrackText(artist)}`;
}

export function isDerivativeTrackVersion(title: string, album = ''): boolean {
  return derivativeVersionPattern.test(`${title} ${album}`) || creditedOriginalPattern.test(title)
    || qualifiedEditionPattern.test(title) || medleyTitlePattern.test(title);
}

function artistNames(artist: string): string[] {
  return artist.split(artistSeparators).map(normalizeTrackText).filter(Boolean);
}

/** Lower is better. Orders search results without hiding any version. */
export function searchRelevance(track: { title: string; artist: string; album?: string }, query: string): number {
  const wanted = normalizeTrackText(query);
  const credited = artistNames(track.artist).find(name => wanted.includes(name));
  const remainder = credited ? wanted.replace(credited, '') : wanted;
  const title = normalizeTrackText(track.title);
  const titled = Boolean(remainder) && (title === remainder || trackFamilyKey(track.title) === remainder
    || (!credited && title.length > 1 && wanted.includes(title)));
  const rank = titled && credited ? 0 : titled ? 1 : credited ? 2 : 3;
  return isDerivativeTrackVersion(track.title, track.album) ? rank + 4 : rank;
}

export function baseTrackTitle(title: string): string {
  let value = title.normalize('NFKC').trim();
  const qualifier = value.match(trailingQualifier);
  if (qualifier) value = value.slice(0, qualifier.index).trim();
  value = value
    .replace(/\s*[-–—_/|·]\s*(?:翻唱|翻奏|cover(?:\s*version)?|live|现场版?|演唱会版?|铃声版?|伴奏|instrumental|karaoke|ktv|dj(?:版|\s*(?:mix|remix))?|remix|混音版?|纯音乐|钢琴版|吉他版|女声版|男声版|加速版|慢速版|sped\s*up|slowed(?:\s*down)?|8d(?:环绕)?)\s*$/i, '')
    .trim();
  return value || title.trim();
}

export function trackFamilyKey(title: string): string {
  return normalizeTrackText(baseTrackTitle(title));
}

export function trackVersionPreference(title: string, album = ''): number {
  if (isDerivativeTrackVersion(title, album)) return 2;
  return normalizeTrackText(title) === trackFamilyKey(title) ? 0 : 1;
}

export function hasCompatibleTrackDuration(first: number, second: number, toleranceMs = 8_000): boolean {
  return Number.isFinite(first) && Number.isFinite(second) && first > 0 && second > 0
    && Math.abs(first - second) <= toleranceMs;
}

export function stableMetadataId(title: string, artist: string): string {
  const value = canonicalTrackKey(title, artist);
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `meta-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}
