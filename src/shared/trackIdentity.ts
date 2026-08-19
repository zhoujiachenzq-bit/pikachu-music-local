const punctuation = /[\s\-‐‑‒–—―_·•.,，。!！?？:：;；'"“”‘’()[\]{}（）【】《》<>]/g;

const derivativeVersionPattern = /(?:翻唱|翻奏|cover(?:\s*version)?|live|现场(?:版|录音)?|演唱会版?|铃声(?:版)?|手机铃声|伴奏|instrumental|karaoke|ktv|(?:^|[^a-z])dj(?:版|\s*(?:mix|remix))?(?:$|[^a-z])|remix|混音版?|纯音乐|钢琴版|吉他版|女声版|男声版|加速版|慢速版|sped\s*up|slowed(?:\s*down)?|8d(?:环绕)?)/i;
const trailingQualifier = /\s*[（(【[]([^）)】\]]{1,48})[）)】\]]\s*$/;

export function normalizeTrackText(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/&nbsp;|&#160;/gi, ' ').replace(punctuation, '');
}

export function canonicalTrackKey(title: string, artist: string): string {
  return `${normalizeTrackText(title)}|${normalizeTrackText(artist)}`;
}

export function isDerivativeTrackVersion(title: string, album = ''): boolean {
  return derivativeVersionPattern.test(`${title} ${album}`);
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
