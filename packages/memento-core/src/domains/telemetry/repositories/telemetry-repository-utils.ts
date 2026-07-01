import type { TelemetryPeriod } from '../types/telemetry.types.js';

export function periodCutoffIso(period: TelemetryPeriod): string {
  const d = new Date();
  if (period === '24h') {
    d.setTime(d.getTime() - 24 * 60 * 60 * 1000);
  } else if (period === '7d') {
    d.setTime(d.getTime() - 7 * 24 * 60 * 60 * 1000);
  } else {
    d.setTime(d.getTime() - 30 * 24 * 60 * 60 * 1000);
  }
  return d.toISOString();
}

export function rolling24hCutoffIso(): string {
  const d = new Date();
  d.setTime(d.getTime() - 24 * 60 * 60 * 1000);
  return d.toISOString();
}

/** p95 from sorted ascending latencies (1-based rank) */
export function percentile95Sorted(sorted: number[]): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.ceil(sorted.length * 0.95) - 1;
  return sorted[Math.max(0, idx)]!;
}
