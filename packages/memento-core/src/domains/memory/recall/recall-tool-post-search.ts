/**
 * Recall 검색 후처리 파이프라인 (recall-tool.ts에서 분리, #445).
 */

import type Database from 'better-sqlite3';
import type { VersionFilterType } from '../../../shared/types/procedural-versioning.js';
import type { ToolContext } from '../../../tools/types.js';
import { computeProceduralDiff } from '../procedural/procedural-memory-diff.js';
import { getVersionChain } from '../procedural/procedural-versioning.js';
import type { MetaMemoryService } from '../introspection/meta-memory-service.js';
import { filterRecallItemsByTags, filterRecallItemsByTriggerConditions } from './recall-tool-filters.js';
import { enrichRecallItemsWithMemoryMetadata } from './recall-tool-metadata-enrich.js';
import type { RecallToolHost } from './recall-tool-host.js';
import { mapRecallSearchItemsToResultItems } from './recall-tool-results.js';
import type { RecallHybridOrTextSearchResult, RecallParams } from './recall-tool-schema.js';
import type { RecallResultItem, RecallSearchItem } from './recall-tool-types.js';

function filterLatestOnly(procedural: RecallSearchItem[]): RecallSearchItem[] {
  const bySeries = new Map<string, RecallSearchItem>();
  for (const item of procedural) {
    const sid = item.version_series_id ?? item.id ?? '';
    if (!sid) continue;
    const cur = bySeries.get(sid);
    const v = item.version ?? 0;
    if (!cur || (cur.version ?? 0) < v) bySeries.set(sid, item);
  }
  return Array.from(bySeries.values());
}

function filterSpecificVersion(
  procedural: RecallSearchItem[],
  versionSeriesId?: string,
  versionNumber?: number,
): RecallSearchItem[] {
  return procedural.filter((i: RecallSearchItem) => {
    if (versionSeriesId && i.version_series_id !== versionSeriesId) return false;
    if (versionNumber !== undefined && (i.version ?? 0) !== versionNumber) return false;
    return true;
  });
}

/**
 * version_filter에 따라 검색 결과를 필터링합니다.
 * latest_only: version_series_id별 최신(version 최대) 1건만 유지.
 * specific_version: version_series_id + version_number 일치 항목만 유지.
 */
export function applyVersionFilter(
  items: RecallSearchItem[],
  versionFilter: VersionFilterType,
  versionSeriesId?: string,
  versionNumber?: number
): RecallSearchItem[] {
  const procedural = items.filter((i: RecallSearchItem) => i.type === 'procedural');
  const nonProcedural = items.filter((i: RecallSearchItem) => i.type !== 'procedural');
  if (procedural.length === 0) return items;
  if (versionFilter === 'latest_only') return [...nonProcedural, ...filterLatestOnly(procedural)];
  if (versionFilter === 'specific_version') return [...nonProcedural, ...filterSpecificVersion(procedural, versionSeriesId, versionNumber)];
  return items;
}

/**
 * procedural 항목에 version_chain 및 diff_with_previous/diff_with를 채웁니다.
 */
export async function enrichProceduralVersionInfo(
  db: Database.Database,
  items: RecallSearchItem[],
  includeVersionChain: boolean,
  includeDiffWith?: string
): Promise<RecallSearchItem[]> {
  return Promise.all(items.map(async (item: RecallSearchItem) => {
    if (item.type !== 'procedural') return item;
    const out = { ...item };
    const itemId = item.id;
    if (includeVersionChain && itemId) {
      try {
        out.version_chain = getVersionChain(db, itemId);
      } catch {
        out.version_chain = [];
      }
    }
    if (includeDiffWith && itemId) {
      try {
        if (includeDiffWith === 'previous') {
          const chain = getVersionChain(db, itemId);
          const prev = chain.filter((c: { version?: number; id: string }) => (c.version ?? 0) < (item.version ?? 0)).sort((a, b) => (b.version ?? 0) - (a.version ?? 0))[0];
          if (prev) {
            out.diff_with_previous = computeProceduralDiff(db, prev.id, itemId);
          } else {
            out.diff_with_previous = null;
          }
        } else {
          out.diff_with = computeProceduralDiff(db, itemId, includeDiffWith);
        }
      } catch {
        if (includeDiffWith === 'previous') out.diff_with_previous = null;
        else out.diff_with = null;
      }
    }
    return out;
  }));
}

/**
 * Meta Memory Statistics 수집
 */
export async function collectMetaMemoryStats(
  host: RecallToolHost,
  searchItems: RecallSearchItem[],
  metaMemoryService: MetaMemoryService
): Promise<void> {
  if (!searchItems || searchItems.length === 0) {
    return;
  }

  try {
    const recallItems = searchItems.map((item): RecallResultItem => {
      const memoryId = item.id ?? item.memory_id ?? '';
      const createdAt = item.created_at instanceof Date ? item.created_at.toISOString() : String(item.created_at ?? '');
      const finalScore = item.final_score ?? item.finalScore ?? item.score ?? 0;
      return {
        memory_id: memoryId,
        id: item.id ?? item.memory_id,
        content: item.content,
        type: item.type,
        importance: item.importance,
        created_at: createdAt,
        final_score: finalScore
      } as RecallResultItem;
    });

    await metaMemoryService.recordRecall(recallItems);
  } catch (error) {
    host.logError(error as Error, 'Meta Memory Statistics 수집 실패', {
      items_count: searchItems.length
    });
  }
}

export async function runMemoryItemPostSearchPipeline(
  host: RecallToolHost,
  context: ToolContext,
  searchResult: RecallHybridOrTextSearchResult | undefined,
  input: {
    query: string;
    version_filter: RecallParams['version_filter'];
    version_series_id: RecallParams['version_series_id'];
    version_number: RecallParams['version_number'];
    include_version_chain: RecallParams['include_version_chain'];
    include_diff_with: RecallParams['include_diff_with'];
    owner_id_filter: RecallParams['owner_id'];
    process_id_filter: RecallParams['process_id'];
    session_id_filter: RecallParams['session_id'];
    project_id_filter: RecallParams['project_id'];
    tags_filter: RecallParams['tags'];
    match_trigger_conditions: boolean;
    actualTriggerContext: Record<string, unknown> | undefined;
    includeMetadata: boolean;
    return_format: 'full' | 'steps_only';
  }
): Promise<{ searchItems: RecallSearchItem[]; processedResults: RecallResultItem[] }> {
  const {
    query,
    version_filter,
    version_series_id,
    version_number,
    include_version_chain,
    include_diff_with,
    owner_id_filter,
    process_id_filter,
    session_id_filter,
    project_id_filter,
    tags_filter,
    match_trigger_conditions,
    actualTriggerContext,
    includeMetadata,
    return_format
  } = input;

  let searchItems: RecallSearchItem[] = (searchResult?.items ?? []) as RecallSearchItem[];

  if (context.db && searchItems.length > 0) {
    // applyVersionFilter·filterRecallItemsByTriggerConditions보다 앞 — version/trigger_conditions 필요 (#1009)
    searchItems = enrichRecallItemsWithMemoryMetadata(context.db, searchItems);
  }

  if (version_filter && searchItems.length > 0) {
    searchItems = applyVersionFilter(searchItems, version_filter, version_series_id, version_number);
  }

  if (tags_filter && tags_filter.length > 0 && searchItems.length > 0) {
    searchItems = filterRecallItemsByTags(searchItems, tags_filter);
  }

  if (owner_id_filter && owner_id_filter.length > 0 && searchItems.length > 0) {
    const ownerIds = Array.isArray(owner_id_filter) ? owner_id_filter : [owner_id_filter];
    searchItems = searchItems.filter(
      (i: RecallSearchItem) => i.owner_id != null && ownerIds.includes(i.owner_id)
    );
  }

  if (process_id_filter && process_id_filter.length > 0 && searchItems.length > 0) {
    const processIds = Array.isArray(process_id_filter) ? process_id_filter : [process_id_filter];
    searchItems = searchItems.filter(
      (i: RecallSearchItem) => i.process_id != null && processIds.includes(i.process_id)
    );
  }
  if (session_id_filter && session_id_filter.length > 0 && searchItems.length > 0) {
    const sessionIds = Array.isArray(session_id_filter) ? session_id_filter : [session_id_filter];
    searchItems = searchItems.filter(
      (i: RecallSearchItem) => i.session_id != null && sessionIds.includes(i.session_id)
    );
  }
  if (project_id_filter && searchItems.length > 0) {
    searchItems = searchItems.filter(
      (i: RecallSearchItem) => i.project_id != null && i.project_id === project_id_filter
    );
  }

  if ((include_version_chain || include_diff_with) && context.db && searchItems.length > 0) {
    searchItems = await enrichProceduralVersionInfo(
      context.db,
      searchItems,
      include_version_chain === true,
      include_diff_with
    );
  }

  if (match_trigger_conditions && searchItems.length > 0) {
    searchItems = filterRecallItemsByTriggerConditions(searchItems, query, actualTriggerContext);
  }

  if (context.services.metaMemoryService && searchItems.length > 0) {
    try {
      await collectMetaMemoryStats(host, searchItems, context.services.metaMemoryService);
    } catch (error) {
      host.logError(error as Error, '메타 통계 수집 실패', {});
    }
  }

  const processedResults = mapRecallSearchItemsToResultItems(searchItems, includeMetadata, return_format);
  return { searchItems, processedResults };
}
