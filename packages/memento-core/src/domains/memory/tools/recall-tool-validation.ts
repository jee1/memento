/**
 * Recall 입력 검증 (recall-tool.ts에서 분리, #350).
 */

import type { RecallFilters } from './recall-tool-types.js';

export function validateRecallQuery(query: string): void {
  if (!query || query.trim().length === 0) {
    throw new Error('검색 쿼리는 비어있을 수 없습니다');
  }

  if (query.length > 1000) {
    throw new Error('검색 쿼리가 너무 깁니다 (최대 1000자)');
  }

  // 특수 문자 검증
  const dangerousPatterns = [/<script/i, /javascript:/i, /on\w+\s*=/i];

  for (const pattern of dangerousPatterns) {
    if (pattern.test(query)) {
      throw new Error('검색 쿼리에 허용되지 않는 문자가 포함되어 있습니다');
    }
  }
}

/**
 * 필터 검증
 */
export function validateRecallFilters(filters?: RecallFilters): void {
  if (!filters) return;

  // 시간 범위 검증
  if (filters.time_from && filters.time_to) {
    const fromDate = new Date(filters.time_from);
    const toDate = new Date(filters.time_to);

    if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
      throw new Error('유효하지 않은 시간 형식입니다');
    }

    if (fromDate > toDate) {
      throw new Error('시작 시간은 종료 시간보다 이전이어야 합니다');
    }
  }

  // 중요도 범위 검증
  if (filters.importance_min !== undefined && filters.importance_max !== undefined) {
    if (filters.importance_min > filters.importance_max) {
      throw new Error('최소 중요도는 최대 중요도보다 작거나 같아야 합니다');
    }
  }
}
