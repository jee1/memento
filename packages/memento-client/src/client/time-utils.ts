/**
 * 상대적 시간 문자열 생성
 */
const DAY_MS = 86_400_000;

export function getRelativeTime(date: string | Date): string {
  const now = new Date();
  const target = new Date(date);
  const diffMs = now.getTime() - target.getTime();
  const diffDays = Math.floor(diffMs / DAY_MS);
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffMinutes = Math.floor(diffMs / (1000 * 60));

  if (diffDays > 0) {
    return `${diffDays}일 전`;
  } else if (diffHours > 0) {
    return `${diffHours}시간 전`;
  } else if (diffMinutes > 0) {
    return `${diffMinutes}분 전`;
  } else {
    return '방금 전';
  }
}

/**
 * 날짜 범위 필터 생성
 */
export function createDateRangeFilter(days: number): {
  time_from: string;
  time_to: string;
} {
  const now = new Date();
  const from = new Date(now.getTime() - days * DAY_MS);

  return {
    time_from: from.toISOString(),
    time_to: now.toISOString(),
  };
}
