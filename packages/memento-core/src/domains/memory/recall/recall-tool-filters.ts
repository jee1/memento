/**
 * Recall 필터·trigger 조건 처리 (recall-tool.ts에서 분리, #350).
 */

import type { AppliedFilters, RecallFilters, RecallSearchItem } from './recall-tool-types.js';

/**
 * tags ⊇ requiredTags (AND). #998 이후 두 레인 모두 SQL 에서 태그를 거른다.
 * #1006 이후 벡터 레인 항목에도 tags 가 실리므로, 이 후처리는 벡터 항목을 통째로 떨어뜨리지 않는다. 이중 안전망이다.
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

type TriggerConditions = Record<string, unknown>;

/** trigger_conditions 를 객체로 파싱한다. 객체가 아니거나 파싱 실패면 null. */
function parseTriggerConditions(raw: unknown): TriggerConditions | null {
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return null;
    }
    return parsed as TriggerConditions;
  } catch {
    return null;
  }
}

/** 한쪽이 다른 쪽을 포함하면 일치. 둘 다 객체면 JSON 문자열로 비교한다. */
function triggerValueMatches(value: unknown, contextValue: unknown): boolean {
  const bothObjects =
    typeof value === 'object' &&
    typeof contextValue === 'object' &&
    value !== null &&
    contextValue !== null;
  const valueStr = (bothObjects ? JSON.stringify(value) : String(value)).toLowerCase();
  const contextStr = (bothObjects ? JSON.stringify(contextValue) : String(contextValue)).toLowerCase();
  return valueStr.includes(contextStr) || contextStr.includes(valueStr);
}

/** 구조화된 컨텍스트: trigger_conditions 의 모든 키/값 쌍이 컨텍스트와 매칭되어야 한다. */
function matchesTriggerContext(
  conditions: TriggerConditions,
  triggerContext: Record<string, unknown>
): boolean {
  return Object.entries(conditions).every(([key, value]) => {
    const contextValue = triggerContext[key];
    return contextValue !== undefined && triggerValueMatches(value, contextValue);
  });
}

/** 쿼리 텍스트 fallback: 키 또는 값 중 하나라도 쿼리와 매칭되면 통과. */
function matchesQueryText(conditions: TriggerConditions, queryText: string): boolean {
  const overlaps = (s: string) => s.includes(queryText) || queryText.includes(s);
  return (
    Object.keys(conditions).some((k) => overlaps(k.toLowerCase())) ||
    Object.values(conditions).some((v) => overlaps(String(v).toLowerCase()))
  );
}

/**
 * trigger_conditions로 필터링
 * match_trigger_conditions=true일 때, 현재 컨텍스트와 trigger_conditions가 매칭되는 항목만 반환
 *
 * PRD 요구사항: 구조화된 컨텍스트(예: tool_name, error_type, params)와 JSON 매칭
 * 구조화된 컨텍스트가 제공되면 이를 우선 사용하고, 없으면 쿼리 텍스트를 사용.
 * 쿼리와 컨텍스트가 모두 없으면 매칭 기준이 없으므로 통과하지 않는다.
 */
export function filterRecallItemsByTriggerConditions(
  items: RecallSearchItem[],
  query?: string,
  triggerContext?: Record<string, unknown>
): RecallSearchItem[] {
  const queryText = query?.toLowerCase() || '';
  const hasContext = triggerContext !== undefined && Object.keys(triggerContext).length > 0;

  return items.filter((item) => {
    const conditions = item.trigger_conditions ? parseTriggerConditions(item.trigger_conditions) : null;
    if (!conditions) return false;
    if (hasContext) return matchesTriggerContext(conditions, triggerContext);
    return queryText !== '' && matchesQueryText(conditions, queryText);
  });
}

type FilterPresence = (value: unknown) => boolean;
const nonEmpty: FilterPresence = (value) => Boolean(value) && (value as { length: number }).length > 0;
const truthy: FilterPresence = (value) => Boolean(value);
const defined: FilterPresence = (value) => value !== undefined;

/** filters_applied 에 싣는 키와 "적용됨" 판정. 순서가 응답 키 순서다. */
const APPLIED_FILTER_RULES: ReadonlyArray<readonly [keyof AppliedFilters & keyof RecallFilters, FilterPresence]> = [
  ['type', nonEmpty],
  ['tags', nonEmpty],
  ['privacy_scope', nonEmpty],
  ['time_from', truthy],
  ['time_to', truthy],
  ['pinned', defined],
  ['importance_min', defined],
  ['importance_max', defined],
  ['has_reflection_notes', defined],
  // Procedural Version Management (Issue #57 Phase 2)
  ['version_filter', truthy],
  ['version_series_id', truthy],
  ['version_number', defined],
  ['include_version_chain', defined],
  ['owner_id', defined],
  ['process_id', defined],
  ['session_id', defined],
  ['project_id', defined],
  ['include_diff_with', truthy]
];

/**
 * 적용된 필터 정보 반환
 */
export function getAppliedRecallFilters(filters?: RecallFilters): AppliedFilters {
  if (!filters) return {};

  const applied: Record<string, unknown> = {};
  for (const [key, isApplied] of APPLIED_FILTER_RULES) {
    if (isApplied(filters[key])) applied[key] = filters[key];
  }
  return applied as AppliedFilters;
}
