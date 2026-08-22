export function clamp01(value: number, fallback: number = 0): number {
  if (!Number.isFinite(value)) {
    return Number.isFinite(fallback) ? Math.min(1, Math.max(0, fallback)) : 0;
  }
  return Math.min(1, Math.max(0, value));
}
