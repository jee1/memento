import type { TelemetryPeriod } from '../types/telemetry.types.js';
import { DAY_MS } from '../../../shared/utils/date.js';

export function periodCutoffIso(period: TelemetryPeriod): string {
  const d = new Date();
  if (period === '24h') {
    d.setTime(d.getTime() - DAY_MS);
  } else if (period === '7d') {
    d.setTime(d.getTime() - 7 * DAY_MS);
  } else {
    d.setTime(d.getTime() - 30 * DAY_MS);
  }
  return d.toISOString();
}

export function rolling24hCutoffIso(): string {
  const d = new Date();
  d.setTime(d.getTime() - DAY_MS);
  return d.toISOString();
}

/** p95 from sorted ascending latencies (1-based rank) */
export function percentile95Sorted(sorted: number[]): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.ceil(sorted.length * 0.95) - 1;
  return sorted[Math.max(0, idx)]!;
}
