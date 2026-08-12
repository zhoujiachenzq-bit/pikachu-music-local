const punctuation = /[\s\-‐‑‒–—―_·•.,，。!！?？:：;；'"“”‘’()[\]{}（）【】《》<>]/g;

export function normalizeTrackText(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/&nbsp;|&#160;/gi, ' ').replace(punctuation, '');
}

export function canonicalTrackKey(title: string, artist: string): string {
  return `${normalizeTrackText(title)}|${normalizeTrackText(artist)}`;
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
