import type { MemoryItem } from '../types.js';

/**
 * 검색 쿼리 정규화
 */
export function normalizeQuery(query: string): string {
  return query
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s가-힣]/g, '');
}

/**
 * 검색 결과 점수 정규화 (0-1 범위)
 */
export function normalizeScore(score: number, minScore: number = 0, maxScore: number = 1): number {
  if (maxScore === minScore) return 0;
  return Math.max(0, Math.min(1, (score - minScore) / (maxScore - minScore)));
}

/**
 * 검색 결과 그룹화 (타입별, 태그별)
 */
export function groupSearchResults(
  results: MemoryItem[],
  groupBy: 'type' | 'tags' | 'privacy_scope',
): Record<string, MemoryItem[]> {
  const groups: Record<string, MemoryItem[]> = {};

  for (const result of results) {
    let key: string;

    switch (groupBy) {
      case 'type':
        key = result.type;
        break;
      case 'tags':
        key = result.tags?.join(',') || 'untagged';
        break;
      case 'privacy_scope':
        key = result.privacy_scope;
        break;
      default:
        key = 'unknown';
    }

    if (!groups[key]) {
      groups[key] = [];
    }
    groups[key]!.push(result);
  }

  return groups;
}
