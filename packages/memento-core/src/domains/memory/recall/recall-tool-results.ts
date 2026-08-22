/**
 * Recall 검색 결과 → 응답 항목 매핑 (recall-tool.ts에서 분리, #350).
 */

import { mementoConfig } from '../../../shared/config/index.js';
import { formatMementoResourceUri, memoryItemResourceKind } from '../../../shared/utils/memento-resource-uri.js';
import type { RecallResultItem, RecallSearchItem } from './recall-tool-types.js';

/**
 * 검색 결과 후처리
 */
export function mapRecallSearchItemsToResultItems(
  items: RecallSearchItem[],
  includeMetadata: boolean,
  returnFormat: 'full' | 'steps_only' = 'full'
): RecallResultItem[] {
  return items.map((item) => {
    const createdAt =
      item.created_at instanceof Date ? item.created_at.toISOString() : String(item.created_at ?? '');
    const memoryId = item.id ?? item.memory_id ?? '';
    const processed: Record<string, unknown> = {
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

    if (includeMetadata) {
      processed.last_accessed = item.last_accessed;
      processed.pinned = item.pinned;
      processed.tags = item.tags;
      processed.source = item.source;
      processed.privacy_scope = item.privacy_scope;
      if (item.owner_id !== undefined) processed.owner_id = item.owner_id;
      if (item.process_id !== undefined) processed.process_id = item.process_id;
      if (item.session_id !== undefined) processed.session_id = item.session_id;
      if (item.project_id !== undefined) processed.project_id = item.project_id;

      // origin_source 필드 추가 (JSON 파싱)
      if (item.origin_source) {
        try {
          processed.origin_source =
            typeof item.origin_source === 'string' ? JSON.parse(item.origin_source) : item.origin_source;
        } catch {
          // JSON 파싱 실패 시 원본 문자열 반환
          processed.origin_source = item.origin_source;
        }
      }

      // Procedural Memory 전용 필드 추가
      if (item.type === 'procedural') {
        processed.task_goal = item.task_goal || null;
        processed.steps = item.steps || null;

        // Procedural Memory Enhancement (v7.0) 필드 추가
        processed.workflow_name = item.workflow_name || null;
        processed.skill_name = item.skill_name || null;
        processed.trigger_conditions = item.trigger_conditions || null;

        // Procedural Version Management (Issue #57 Phase 2)
        if (item.version !== undefined) processed.version = item.version;
        if (item.version_series_id !== undefined) processed.version_series_id = item.version_series_id;
        if (item.version_chain !== undefined) processed.version_chain = item.version_chain;
        if (item.diff_with_previous !== undefined) processed.diff_with_previous = item.diff_with_previous;
        if (item.diff_with !== undefined) processed.diff_with = item.diff_with;

        // reflection_notes 필드 추가 (JSON 파싱)
        if (item.reflection_notes) {
          try {
            // reflection_notes JSON 파싱 (문자열 → 객체/배열 변환)
            processed.reflection_notes =
              typeof item.reflection_notes === 'string'
                ? JSON.parse(item.reflection_notes)
                : item.reflection_notes;
          } catch {
            // JSON 파싱 실패 시 원본 문자열 반환
            processed.reflection_notes = item.reflection_notes;
          }
        } else {
          processed.reflection_notes = null;
        }

        // return_format='steps_only'일 때 steps만 반환
        if (returnFormat === 'steps_only') {
          return {
            memory_id: processed.memory_id,
            id: processed.id,
            steps: processed.steps
          } as unknown as RecallResultItem;
        }
      }

      if (item.textScore !== undefined) {
        processed.text_score = item.textScore;
      }
      if (item.vectorScore !== undefined) {
        processed.vector_score = item.vectorScore;
      }
      if (item.recall_reason) {
        processed.recall_reason = item.recall_reason;
      }

      // Consolidation Score 포함 (기능 플래그 활성화 시)
      if (mementoConfig.consolidationScoreEnabled && item.consolidation_score !== undefined) {
        processed.consolidation_score = item.consolidation_score;
      }

      if (item.score_breakdown !== undefined) {
        processed.score_breakdown = item.score_breakdown;
      }
    }

    return processed as unknown as RecallResultItem;
  }) as RecallResultItem[];
}
