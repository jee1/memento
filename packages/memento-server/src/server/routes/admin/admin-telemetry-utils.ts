import type { TelemetryPeriod } from '@memento/core';

export const TELEMETRY_PERIODS: TelemetryPeriod[] = ['24h', '7d', '30d'];

/**
 * FR-013: 쿼리에서 `period`가 **생략**된 경우만 기본 `24h`.
 * 빈 문자열(`?period=`)이나 미지원 값은 그대로 두어 `TELEMETRY_PERIODS` 검사에서 400이 되게 한다.
 */
export function effectiveTelemetryPeriod(periodRaw: string | undefined): string {
  return periodRaw === undefined ? '24h' : periodRaw;
}
