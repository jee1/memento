/**
 * Recall 검색 결과 → 응답 항목 매핑 (recall-tool.ts에서 분리, #350).
 */

import { formatMementoResourceUri, memoryItemResourceKind } from '../../../shared/utils/memento-resource-uri.js';
import type { RecallResultItem, RecallSearchItem } from './recall-tool-types.js';

type ProcessedItem = Record<string, unknown>;

/** JSON 문자열이면 파싱하고, 파싱 실패 시 원본을 돌려준다. */
function parseJsonOrRaw(value: unknown): unknown {
  try {
    return typeof value === 'string' ? JSON.parse(value) : value;
  } catch {
    return value;
  }
}

/** item[from] 이 undefined 가 아니면 processed[to] 로 복사한다. */
function copyDefined(
  processed: ProcessedItem,
  item: RecallSearchItem,
  fields: ReadonlyArray<readonly [keyof RecallSearchItem, string]>
): void {
  for (const [from, to] of fields) {
    if (item[from] !== undefined) processed[to] = item[from];
  }
}

const SCOPE_FIELDS = [
  ['owner_id', 'owner_id'],
  ['process_id', 'process_id'],
  ['session_id', 'session_id'],
  ['project_id', 'project_id']
] as const;

// Procedural Version Management (Issue #57 Phase 2)
const VERSION_FIELDS = [
  ['version', 'version'],
  ['version_series_id', 'version_series_id'],
  ['version_chain', 'version_chain'],
  ['diff_with_previous', 'diff_with_previous'],
  ['diff_with', 'diff_with']
] as const;

function buildBaseResult(item: RecallSearchItem): ProcessedItem {
  const createdAt =
    item.created_at instanceof Date ? item.created_at.toISOString() : String(item.created_at ?? '');
  const memoryId = item.id ?? item.memory_id ?? '';
  const processed: ProcessedItem = {
    memory_id: memoryId,
    id: item.id,
    content: item.content,
    type: item.type,
    importance: item.importance,
    created_at: createdAt,
    final_score: item.finalScore ?? item.score ?? 0
  };

  if (memoryId) {
    processed.uri = formatMementoResourceUri({
      ownerId: item.owner_id,
      kind: memoryItemResourceKind(item.type),
      id: memoryId,
    });
  }
  return processed;
}

function applyMetadataFields(processed: ProcessedItem, item: RecallSearchItem): void {
  processed.last_accessed = item.last_accessed;
  processed.pinned = item.pinned;
  processed.tags = item.tags;
  processed.source = item.source;
  processed.privacy_scope = item.privacy_scope;
  copyDefined(processed, item, SCOPE_FIELDS);

  if (item.origin_source) {
    processed.origin_source = parseJsonOrRaw(item.origin_source);
  }
}

/** Procedural Memory 전용 필드 (v7.0 Enhancement 포함) */
function applyProceduralFields(processed: ProcessedItem, item: RecallSearchItem): void {
  processed.task_goal = item.task_goal || null;
  processed.steps = item.steps || null;
  processed.workflow_name = item.workflow_name || null;
  processed.skill_name = item.skill_name || null;
  processed.trigger_conditions = item.trigger_conditions || null;
  copyDefined(processed, item, VERSION_FIELDS);
  processed.reflection_notes = item.reflection_notes ? parseJsonOrRaw(item.reflection_notes) : null;
}

function applyScoreFields(processed: ProcessedItem, item: RecallSearchItem): void {
  copyDefined(processed, item, [['textScore', 'text_score'], ['vectorScore', 'vector_score']]);
  if (item.recall_reason) {
    processed.recall_reason = item.recall_reason;
  }
  copyDefined(processed, item, [['score_breakdown', 'score_breakdown']]);
}

function mapRecallSearchItem(
  item: RecallSearchItem,
  includeMetadata: boolean,
  returnFormat: 'full' | 'steps_only'
): RecallResultItem {
  const processed = buildBaseResult(item);
  if (!includeMetadata) return processed as unknown as RecallResultItem;

  applyMetadataFields(processed, item);

  if (item.type === 'procedural') {
    applyProceduralFields(processed, item);
    // return_format='steps_only'일 때 steps만 반환
    if (returnFormat === 'steps_only') {
      return {
        memory_id: processed.memory_id,
        id: processed.id,
        steps: processed.steps
      } as unknown as RecallResultItem;
    }
  }

  applyScoreFields(processed, item);
  return processed as unknown as RecallResultItem;
}

/**
 * 검색 결과 후처리
 */
export function mapRecallSearchItemsToResultItems(
  items: RecallSearchItem[],
  includeMetadata: boolean,
  returnFormat: 'full' | 'steps_only' = 'full'
): RecallResultItem[] {
  return items.map((item) => mapRecallSearchItem(item, includeMetadata, returnFormat));
}
