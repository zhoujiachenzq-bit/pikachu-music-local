export function rangeProgress(value: number, min: number, max: number) {
  if (!Number.isFinite(value) || !Number.isFinite(min) || !Number.isFinite(max) || max <= min) return 0;
  return Math.min(100, Math.max(0, (value - min) / (max - min) * 100));
}
