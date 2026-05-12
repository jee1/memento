/**
 * memory_injection / 개인 지식 Agent가 공유하는 컨텍스트 번들 구성 로직.
 * 하이브리드 검색 → project/owner 필터 → (선택) consolidation 메타 갱신 → 토큰 예산 내 요약 → 프롬프트 문자열
 */

import type Database from 'better-sqlite3';
import { mementoConfig } from '../../../shared/config/index.js';
import type { IConsolidationScoreService } from '../../../shared/interfaces/consolidation-score.interface.js';
import { isFullMemoryItemTypeSet, type MemoryType } from '../../../shared/types/index.js';
import { DatabaseUtils } from '../../../shared/utils/database.js';
import { emitTfidfFallbackWarningIfNeeded } from '../../../shared/utils/embedding-provider-diagnostics.js';
import { logger } from '../../../shared/utils/logger.js';
import type { WriteCoalescingManager } from '../../../shared/utils/write-coalescing.js';
import type { HybridSearchEngine, HybridSearchResult } from '../../search/algorithms/hybrid-search-engine.js';

export interface KnowledgeContextBundleBuilderDeps {
  db: Database.Database;
  hybridSearchEngine: HybridSearchEngine;
  consolidationScoreService?: IConsolidationScoreService;
  writeCoalescingManager?: WriteCoalescingManager;
}

export interface KnowledgeContextBundleParams {
  query: string;
  tokenBudget?: number;
  maxMemories?: number;
  /** core/vault 제거·검증된 타입만 전달 */
  memoryTypes?: MemoryType[];
  projectId?: string;
  ownerId?: string | string[];
}

export interface KnowledgeContextBundle {
  /** LLM system 프롬프트에 넣을 본문 */
  promptText: string;
  /** 요약에 포함된 기억 개수 */
  itemCount: number;
  tokenEstimate: number;
  /** Agent Loop 메타용 한 줄 요약 */
  contextSummary: string;
  query: string;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function getMemoryTypeEmoji(type: string): string {
  const emojiMap: Record<string, string> = {
    working: '🧠',
    episodic: '📝',
    semantic: '📚',
    procedural: '⚙️',
  };
  return emojiMap[type] || '💭';
}

function summarizeMemoryContent(content: string, maxTokens: number): string {
  const words = content.split(' ');
  const maxWords = Math.floor(maxTokens / 1.5);

  if (words.length <= maxWords) {
    return content;
  }

  const sentences = content.split(/[.!?]+/).filter((s) => s.trim().length > 0);

  if (sentences.length <= 2) {
    return words.slice(0, maxWords).join(' ') + '...';
  }

  const firstSentence = sentences[0]?.trim() || '';
  const lastSentence = sentences[sentences.length - 1]?.trim() || '';
  const middleSentences = sentences.slice(1, -1);

  let summary = firstSentence;
  let remainingWords = maxWords - firstSentence.split(' ').length;

  if (remainingWords > 0 && middleSentences.length > 0) {
    const middleText = middleSentences.join('. ');
    const middleWords = middleText.split(' ');
    const middleWordsToInclude = Math.min(remainingWords - lastSentence.split(' ').length, middleWords.length);

    if (middleWordsToInclude > 0) {
      summary += ' ' + middleWords.slice(0, middleWordsToInclude).join(' ');
      remainingWords -= middleWordsToInclude;
    }
  }

  if (remainingWords > 0) {
    summary += ' ' + lastSentence;
  }

  return summary + (summary.length < content.length ? '...' : '');
}

function summarizeMemories(
  memories: HybridSearchResult[],
  tokenBudget: number,
  maxMemories: number,
): Array<{ id: string; content: string; type: string; importance: number; summary: string }> {
  const summaries: Array<{ id: string; content: string; type: string; importance: number; summary: string }> = [];
  let usedTokens = 0;
  const maxTokensPerMemory = Math.floor(tokenBudget / maxMemories);

  const sortedMemories = [...memories].sort((a, b) => b.finalScore + b.importance - (a.finalScore + a.importance)).slice(0, maxMemories);

  for (const memory of sortedMemories) {
    if (usedTokens >= tokenBudget) break;

    const summary = summarizeMemoryContent(memory.content, maxTokensPerMemory);
    const summaryTokens = estimateTokens(summary);

    if (usedTokens + summaryTokens <= tokenBudget) {
      summaries.push({
        id: memory.id,
        content: memory.content,
        type: memory.type,
        importance: memory.importance,
        summary,
      });
      usedTokens += summaryTokens;
    }
  }

  return summaries;
}

function formatMemoryPrompt(
  summaries: Array<{ id: string; content: string; type: string; importance: number; summary: string }>,
  query: string,
): string {
  if (summaries.length === 0) {
    return '관련 기억을 찾을 수 없습니다.';
  }

  let prompt = `# 관련 기억 (${summaries.length}개)\n\n`;
  prompt += `**검색 쿼리**: "${query}"\n\n`;

  summaries.forEach((memory, index) => {
    const typeEmoji = getMemoryTypeEmoji(memory.type);
    const importanceStars = '★'.repeat(Math.ceil(memory.importance * 5));

    prompt += `## ${index + 1}. ${typeEmoji} ${memory.type.toUpperCase()} 기억\n`;
    prompt += `**중요도**: ${importanceStars} (${memory.importance.toFixed(2)})\n`;
    prompt += `**내용**: ${memory.summary}\n\n`;
  });

  prompt += '---\n';
  prompt += '*이 기억들은 현재 대화와 관련된 맥락 정보입니다. 참고하여 더 정확하고 관련성 높은 답변을 제공하세요.*';

  return prompt;
}

async function updateConsolidationScoreMetadata(
  db: Database.Database,
  consolidationScoreService: IConsolidationScoreService,
  writeCoalescingManager: WriteCoalescingManager | undefined,
  searchItems: HybridSearchResult[],
): Promise<void> {
  if (!searchItems || searchItems.length === 0) {
    return;
  }

  try {
    const now = new Date();
    const nowISO = now.toISOString();

    for (const item of searchItems) {
      const memoryId = item.id;
      if (!memoryId) {
        continue;
      }

      try {
        const memory = DatabaseUtils.get(
          db,
          `SELECT 
              recall_count, 
              last_accessed_at, 
              g_value, 
              created_at, 
              type, 
              pinned 
            FROM memory_item 
            WHERE id = ?`,
          [memoryId],
        ) as
          | {
              recall_count: number;
              last_accessed_at: string | null;
              g_value: number | null;
              created_at: string;
              type: MemoryType;
              pinned: boolean | number;
            }
          | undefined;

        if (!memory) {
          logger.warn(`[knowledge-context-bundle] 메모리를 찾을 수 없습니다: ${memoryId}`);
          continue;
        }

        const newRecallCount = (memory.recall_count || 0) + 1;

        const lastAccessedAt = memory.last_accessed_at ? new Date(memory.last_accessed_at) : new Date(memory.created_at);
        const timeElapsed = consolidationScoreService.calculateTimeElapsed(
          lastAccessedAt,
          new Date(memory.created_at),
          now,
        );

        const newGValue = consolidationScoreService.updateGValueForRecall({
          previousGValue: memory.g_value,
          timeElapsed,
        });

        const scoreResult = consolidationScoreService.calculateScore({
          recallCount: newRecallCount,
          lastAccessedAt: now,
          createdAt: new Date(memory.created_at),
          gValue: newGValue,
          type: memory.type,
          pinned: memory.pinned === 1 || memory.pinned === true,
        });

        if (writeCoalescingManager) {
          writeCoalescingManager.addWrite({
            memoryId,
            fields: {
              recall_count: newRecallCount,
              last_accessed_at: nowISO,
              g_value: newGValue,
              consolidation_score: scoreResult.score,
            },
          });
        } else {
          DatabaseUtils.run(
            db,
            `UPDATE memory_item 
               SET 
                 recall_count = ?,
                 last_accessed_at = ?,
                 g_value = ?,
                 consolidation_score = ?
               WHERE id = ?`,
            [newRecallCount, nowISO, newGValue, scoreResult.score, memoryId],
          );
        }
      } catch (error) {
        logger.warn(`[knowledge-context-bundle] 메모리 업데이트 실패 (${memoryId})`, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  } catch (error) {
    logger.error('[knowledge-context-bundle] Consolidation Score 메타데이터 업데이트 실패', {
      itemCount: searchItems.length,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function filterByOwner(memories: HybridSearchResult[], ownerId?: string | string[]): HybridSearchResult[] {
  if (ownerId === undefined || ownerId === null) {
    return memories;
  }
  const ownerIds = Array.isArray(ownerId) ? ownerId : [ownerId];
  return memories.filter((m) => m.owner_id != null && ownerIds.includes(String(m.owner_id)));
}

/**
 * memory_injection과 동일한 검색·요약·포맷 경로로 컨텍스트 번들을 생성합니다.
 */
export async function buildKnowledgeContextBundle(
  deps: KnowledgeContextBundleBuilderDeps,
  params: KnowledgeContextBundleParams,
): Promise<KnowledgeContextBundle> {
  const {
    query,
    tokenBudget = 1000,
    maxMemories = 5,
    memoryTypes: filteredMemoryTypes,
    projectId,
    ownerId,
  } = params;

  const finalMemoryTypes: MemoryType[] | undefined =
    filteredMemoryTypes && filteredMemoryTypes.length > 0
      ? isFullMemoryItemTypeSet(filteredMemoryTypes)
        ? undefined
        : filteredMemoryTypes
      : undefined;

  const searchResult = await deps.hybridSearchEngine.search(deps.db, {
    query,
    filters: {
      type: finalMemoryTypes,
    },
    limit: maxMemories * 2,
    vectorWeight: 0.7,
    textWeight: 0.3,
  });

  emitTfidfFallbackWarningIfNeeded(
    searchResult.fallback_used,
    searchResult.query_embedding_providers,
    searchResult.tfidf_query_embedding_fallback,
    searchResult.tfidf_query_embedding_fallback_providers,
  );

  // TODO(#232 follow-up): project_id / owner_id를 검색 단계(SQL/하이브리드 filters)에서 적용하지 않고
  // 여기서 후처리만 하므로, 좁은 필터일 때 limit 이전에 걸러져 후보가 maxMemories보다 훨씬 적을 수 있음.

  let memories: HybridSearchResult[] = searchResult.items;
  if (projectId) {
    memories = memories.filter((m) => m.project_id != null && m.project_id === projectId);
  }
  memories = filterByOwner(memories, ownerId);

  logger.debug('[knowledge-context-bundle] 검색된 기억', { count: memories.length });

  if (mementoConfig.consolidationScoreEnabled && deps.consolidationScoreService && memories.length > 0) {
    await updateConsolidationScoreMetadata(
      deps.db,
      deps.consolidationScoreService,
      deps.writeCoalescingManager,
      memories,
    );
  }

  if (memories.length === 0) {
    const emptyText = '관련 기억을 찾을 수 없습니다.';
    return {
      promptText: emptyText,
      itemCount: 0,
      tokenEstimate: 0,
      contextSummary: '관련 기억 0건',
      query,
    };
  }

  const summary = summarizeMemories(memories, tokenBudget, maxMemories);
  const formattedPrompt = formatMemoryPrompt(summary, query);
  const tokenEstimate = estimateTokens(formattedPrompt);

  const typeCounts = summary.reduce<Record<string, number>>((acc, row) => {
    acc[row.type] = (acc[row.type] ?? 0) + 1;
    return acc;
  }, {});
  const breakdown = Object.entries(typeCounts)
    .map(([t, n]) => `${t} ${n}`)
    .join(', ');
  const contextSummary = `관련 기억 ${summary.length}건 (${breakdown}), 추정 토큰 ${tokenEstimate}`;

  logger.info('[knowledge-context-bundle] 완료', {
    memoryCount: summary.length,
    tokenCount: tokenEstimate,
  });

  return {
    promptText: formattedPrompt,
    itemCount: summary.length,
    tokenEstimate,
    contextSummary,
    query,
  };
}
