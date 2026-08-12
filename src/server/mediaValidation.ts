export function isLikelyKuwoRestrictionAudio(contentLength: number, trackDurationMs = 0): boolean {
  if (!Number.isFinite(contentLength) || contentLength <= 0) return false;
  if (contentLength <= 300_000) return true;
  if (trackDurationMs >= 60_000) {
    const minimumPlausibleBytes = trackDurationMs / 1000 * 4_000;
    return contentLength < minimumPlausibleBytes;
  }
  return false;
}
