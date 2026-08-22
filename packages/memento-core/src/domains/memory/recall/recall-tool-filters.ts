/**
 * Recall 필터·trigger 조건 처리 (recall-tool.ts에서 분리, #350).
 */

import type { AppliedFilters, RecallFilters, RecallSearchItem } from './recall-tool-types.js';

/**
 * tags ⊇ requiredTags (AND). Vector/hybrid paths may omit SQL tag filters (#754).
 */
export function filterRecallItemsByTags(
  items: RecallSearchItem[],
  requiredTags: string[] | undefined
): RecallSearchItem[] {
  if (!requiredTags || requiredTags.length === 0) {
    return items;
  }
  return items.filter((item) => {
    const itemTags = item.tags ?? [];
    return requiredTags.every((tag) => itemTags.includes(tag));
  });
}

/**
 * trigger_conditions로 필터링
 * match_trigger_conditions=true일 때, 현재 컨텍스트와 trigger_conditions가 매칭되는 항목만 반환
 *
 * PRD 요구사항: 구조화된 컨텍스트(예: tool_name, error_type, params)와 JSON 매칭
 * 구조화된 컨텍스트가 제공되면 이를 우선 사용하고, 없으면 쿼리 텍스트를 사용
 */
export function filterRecallItemsByTriggerConditions(
  items: RecallSearchItem[],
  query?: string,
  triggerContext?: Record<string, unknown>
): RecallSearchItem[] {
  const queryText = query?.toLowerCase() || '';

  return items.filter((item) => {
    // trigger_conditions가 없는 항목은 제외
    if (!item.trigger_conditions) {
      return false;
    }

    try {
      // JSON 파싱 시도
      const parsed =
        typeof item.trigger_conditions === 'string'
          ? JSON.parse(item.trigger_conditions)
          : item.trigger_conditions;

      // 객체인지 확인 (배열이나 null이 아닌 경우)
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return false;
      }

      // 구조화된 컨텍스트가 제공된 경우: 키-값 기반 정확 매칭
      // 모든 키/값 쌍이 매칭되어야 함 (첫 번째 키만 맞으면 통과하는 문제 수정)
      if (triggerContext && Object.keys(triggerContext).length > 0) {
        // trigger_conditions의 모든 키-값 쌍이 컨텍스트와 매칭되는지 확인
        for (const [key, value] of Object.entries(parsed)) {
          const contextValue = triggerContext[key];

          // trigger_conditions에 있는 키가 컨텍스트에 없으면 매칭 실패
          if (contextValue === undefined) {
            return false;
          }

          // 값이 객체인 경우 재귀적으로 비교
          if (
            typeof value === 'object' &&
            typeof contextValue === 'object' &&
            value !== null &&
            contextValue !== null
          ) {
            // 중첩 객체 매칭: context의 값이 trigger_conditions의 값과 부분적으로 일치하는지 확인
            const valueStr = JSON.stringify(value).toLowerCase();
            const contextStr = JSON.stringify(contextValue).toLowerCase();
            if (!(valueStr.includes(contextStr) || contextStr.includes(valueStr))) {
              // 하나라도 매칭되지 않으면 실패
              return false;
            }
          } else {
            // 단순 값 매칭: 문자열로 변환하여 비교
            const valueStr = String(value).toLowerCase();
            const contextStr = String(contextValue).toLowerCase();
            if (!(valueStr === contextStr || valueStr.includes(contextStr) || contextStr.includes(valueStr))) {
              // 하나라도 매칭되지 않으면 실패
              return false;
            }
          }
        }
        // 모든 키/값 쌍이 매칭됨
        return true;
      }

      // 구조화된 컨텍스트가 없는 경우: 쿼리 텍스트 기반 매칭 (fallback)
      if (queryText) {
        // 키 매칭: tool_name, error_type, params 등 구조화된 필드명과 매칭
        const triggerKeys = Object.keys(parsed).map((k) => k.toLowerCase());
        const triggerValues = Object.values(parsed).map((v) => String(v).toLowerCase());

        // 키 또는 값 중 하나라도 쿼리와 매칭되면 통과
        const keyMatch = triggerKeys.some((k) => k.includes(queryText) || queryText.includes(k));
        const valueMatch = triggerValues.some((v) => v.includes(queryText) || queryText.includes(v));
        return keyMatch || valueMatch;
      }

      // 쿼리와 컨텍스트가 모두 없으면 매칭 기준이 없으므로 필터링
      // PRD: "현재 컨텍스트와 매칭" 요구사항 - 매칭 기준이 없으면 통과하지 않음
      return false;
    } catch {
      // JSON 파싱 실패 시 제외
      return false;
    }
  });
}

/**
 * 적용된 필터 정보 반환
 */
export function getAppliedRecallFilters(filters?: RecallFilters): AppliedFilters {
  if (!filters) return {};

  const applied: AppliedFilters = {};

  if (filters.type && filters.type.length > 0) {
    applied.type = filters.type;
  }
  if (filters.tags && filters.tags.length > 0) {
    applied.tags = filters.tags;
  }
  if (filters.privacy_scope && filters.privacy_scope.length > 0) {
    applied.privacy_scope = filters.privacy_scope;
  }
  if (filters.time_from) {
    applied.time_from = filters.time_from;
  }
  if (filters.time_to) {
    applied.time_to = filters.time_to;
  }
  if (filters.pinned !== undefined) {
    applied.pinned = filters.pinned;
  }
  if (filters.importance_min !== undefined) {
    applied.importance_min = filters.importance_min;
  }
  if (filters.importance_max !== undefined) {
    applied.importance_max = filters.importance_max;
  }
  if (filters.has_reflection_notes !== undefined) {
    applied.has_reflection_notes = filters.has_reflection_notes;
  }
  // Procedural Version Management (Issue #57 Phase 2)
  if (filters.version_filter) applied.version_filter = filters.version_filter;
  if (filters.version_series_id) applied.version_series_id = filters.version_series_id;
  if (filters.version_number !== undefined) applied.version_number = filters.version_number;
  if (filters.include_version_chain !== undefined) applied.include_version_chain = filters.include_version_chain;
  if (filters.owner_id !== undefined) applied.owner_id = filters.owner_id;
  if (filters.process_id !== undefined) applied.process_id = filters.process_id;
  if (filters.session_id !== undefined) applied.session_id = filters.session_id;
  if (filters.project_id !== undefined) applied.project_id = filters.project_id;
  if (filters.include_diff_with) applied.include_diff_with = filters.include_diff_with;

  return applied;
}
