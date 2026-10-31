/**
 * Gemini 무료 tier 일일 한도는 America/Los_Angeles 자정 기준 (#1546).
 * ICU 가 없는 Node 에서도 동작하도록 Intl 로 변환한다.
 */

const PACIFIC = 'America/Los_Angeles';

export function pacificDateFromUtcIso(isoUtc: string): string {
  const d = new Date(isoUtc);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`Invalid UTC timestamp: ${isoUtc}`);
  }
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: PACIFIC,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const y = parts.find((p) => p.type === 'year')?.value;
  const m = parts.find((p) => p.type === 'month')?.value;
  const day = parts.find((p) => p.type === 'day')?.value;
  if (!y || !m || !day) {
    throw new Error(`Failed to format Pacific date for ${isoUtc}`);
  }
  return `${y}-${m}-${day}`;
}
