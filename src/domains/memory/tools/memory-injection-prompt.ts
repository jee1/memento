/**
 * Memory Injection 프롬프트 도구
 * MCP 프롬프트 인터페이스를 통한 관련 기억 주입
 */

import { BaseTool } from '../../../tools/base-tool.js';
import type { ToolContext } from '../../../tools/types.js';
import { z } from 'zod';
import { CommonSchemas } from '../../../tools/types.js';
import { isMemoryItemType, type MemoryTypeRequest, type MemoryType } from '../../../shared/types/index.js';
import { mementoConfig } from '../../../shared/config/index.js';
import { DatabaseUtils } from '../../../shared/utils/database.js';
import { PIIMasker } from '../../../shared/utils/pii-masker.js';
import { logger } from '../../../shared/utils/logger.js';
import type { ConsolidationScoreService } from '../../../infrastructure/consolidation-score-service.js';
import type { WriteCoalescingManager } from '../../../shared/utils/write-coalescing.js';

const MemoryInjectionSchema = z.object({
  query: z.string().describe('검색할 쿼리'),
  token_budget: z.number().optional().describe('토큰 예산 (기본값: 1000)'),
  max_memories: z.number().optional().describe('최대 기억 개수 (기본값: 5)'),
  memory_types: z.array(CommonSchemas.MemoryType).optional().describe('포함할 기억 타입들'),
  importance_threshold: z.number().optional().describe('중요도 임계값 (기본값: 0.5)')
});

export class MemoryInjectionPrompt extends BaseTool {
  constructor() {
    super(
      'memory_injection',
      '관련 기억을 요약하여 프롬프트에 주입',
      {
        type: 'object',
        properties: {
          query: { 
            type: 'string', 
            description: '검색할 쿼리' 
          },
          token_budget: { 
            type: 'number', 
            description: '토큰 예산 (기본값: 1000)',
            default: 1000
          },
          max_memories: { 
            type: 'number', 
            description: '최대 기억 개수 (기본값: 5)',
            default: 5
          },
          memory_types: { 
            type: 'array',
            items: {
              type: 'string',
              enum: ['working', 'episodic', 'semantic', 'procedural', 'core', 'vault']
            },
            description: '포함할 기억 타입들 (core/vault는 자동으로 제거됩니다)',
            default: ['working', 'episodic', 'semantic', 'procedural']
          },
          importance_threshold: { 
            type: 'number', 
            description: '중요도 임계값 (기본값: 0.5)',
            default: 0.5
          }
        },
        required: ['query']
      }
    );
  }

  async handle(params: any, context: ToolContext): Promise<any> {
    const {
      query,
      token_budget = 1000,
      max_memories = 5,
      memory_types = ['working', 'episodic', 'semantic', 'procedural'],
      importance_threshold = 0.5
    } = MemoryInjectionSchema.parse(params);

    try {
      logger.info('Memory Injection 시작', {
        query,
        token_budget
      });

      if (!context.db) {
        throw new Error('데이터베이스가 연결되지 않았습니다');
      }

      if (!context.services?.hybridSearchEngine) {
        throw new Error('하이브리드 검색 엔진이 사용할 수 없습니다');
      }

      // memory_types 배열 전처리 ('core'/'vault' 제거)
      let filteredMemoryTypes = memory_types;
      if (memory_types && memory_types.length > 0) {
        const invalidTypes = memory_types.filter(t => t === 'core' || t === 'vault');
        if (invalidTypes.length > 0) {
          this.logWarning('memory_types 배열에서 core/vault는 memory_item 검색에 사용할 수 없습니다. 자동으로 제거합니다.', {
            invalid_types: invalidTypes,
            original_memory_types: memory_types,
            suggestion: 'Core/Vault 조회는 recall Tool의 type 파라미터를 사용하세요.'
          });
          filteredMemoryTypes = memory_types.filter(t => t !== 'core' && t !== 'vault');
          if (filteredMemoryTypes.length === 0) {
            throw new Error("memory_types 배열에 유효한 타입이 없습니다. 'core'와 'vault'는 memory_types에서 사용할 수 없습니다.");
          }
        }
        
        // 타입 가드 적용: MemoryTypeRequest[] -> MemoryType[]
        const validMemoryTypes = filteredMemoryTypes.filter(isMemoryItemType);
        if (validMemoryTypes.length === 0) {
          throw new Error("memory_types 배열에 유효한 타입이 없습니다.");
        }
        filteredMemoryTypes = validMemoryTypes;
      }

      // 1. 관련 기억 검색
      // importance_min은 MemorySearchFilters에 없으므로 제거
      // importance 필터링은 검색 후 별도로 처리하거나 다른 방법 사용
      // filteredMemoryTypes는 이미 validMemoryTypes로 변환되어 MemoryType[] 타입
      const finalMemoryTypes: MemoryType[] | undefined = filteredMemoryTypes && filteredMemoryTypes.length > 0 
        ? (filteredMemoryTypes.length === 4 ? undefined : filteredMemoryTypes as MemoryType[])
        : undefined;
      const searchResult = await context.services.hybridSearchEngine.search(context.db, {
        query,
        filters: {
          type: finalMemoryTypes
        },
        limit: max_memories * 2, // 더 많은 후보를 가져와서 요약
        vectorWeight: 0.7, // 의미적 유사성에 더 중점
        textWeight: 0.3
      });

      const memories = searchResult.items;
      logger.debug('검색된 기억', {
        count: memories.length
      });

      // Consolidation Score System 업데이트 (기능 플래그 확인)
      if (mementoConfig.consolidationScoreEnabled && context.services.consolidationScoreService && memories.length > 0) {
        await this.updateConsolidationScoreMetadata(
          context.db,
          context.services.consolidationScoreService,
          context.services.writeCoalescingManager,
          memories
        );
      }

      if (memories.length === 0) {
        return this.createSuccessResult({
          message: '관련 기억을 찾을 수 없습니다.',
          memories_used: 0,
          token_estimate: 0,
          query: query
        });
      }

      // 2. 기억 요약 및 토큰 예산 관리
      const summary = await this.summarizeMemories(memories, token_budget, max_memories);

      // 3. 프롬프트 형식으로 포맷팅
      const formattedPrompt = this.formatMemoryPrompt(summary, query);

      logger.info('Memory Injection 완료', {
        memoryCount: summary.length,
        tokenCount: this.estimateTokens(formattedPrompt)
      });

      return this.createSuccessResult({
        message: formattedPrompt,
        memories_used: summary.length,
        token_estimate: this.estimateTokens(formattedPrompt),
        query: query
      });

    } catch (error) {
      const maskedError = error instanceof Error ? PIIMasker.maskError(error) : { message: String(error), name: 'Error' };
      logger.error('Memory Injection 실패', {
        error: maskedError.message
      });
      throw error;
    }
  }

  /**
   * 기억들을 요약하여 토큰 예산 내에서 관리
   */
  private async summarizeMemories(
    memories: any[], 
    tokenBudget: number, 
    maxMemories: number
  ): Promise<Array<{id: string, content: string, type: string, importance: number, summary: string}>> {
    const summaries: Array<{id: string, content: string, type: string, importance: number, summary: string}> = [];
    let usedTokens = 0;
    const maxTokensPerMemory = Math.floor(tokenBudget / maxMemories);

    // 중요도와 점수 순으로 정렬
    const sortedMemories = memories
      .sort((a, b) => (b.finalScore + b.importance) - (a.finalScore + a.importance))
      .slice(0, maxMemories);

    for (const memory of sortedMemories) {
      if (usedTokens >= tokenBudget) break;

      // 기억 내용 요약
      const summary = this.summarizeMemoryContent(memory.content, maxTokensPerMemory);
      const summaryTokens = this.estimateTokens(summary);

      if (usedTokens + summaryTokens <= tokenBudget) {
        summaries.push({
          id: memory.id,
          content: memory.content,
          type: memory.type,
          importance: memory.importance,
          summary
        });
        usedTokens += summaryTokens;
      }
    }

    return summaries;
  }

  /**
   * 개별 기억 내용 요약
   */
  private summarizeMemoryContent(content: string, maxTokens: number): string {
    // 간단한 요약 로직 (실제로는 더 정교한 요약 알고리즘 사용 가능)
    const words = content.split(' ');
    const maxWords = Math.floor(maxTokens / 1.5); // 대략적인 단어 수 계산

    if (words.length <= maxWords) {
      return content;
    }

    // 중요도 기반 요약 (첫 문장 + 마지막 문장 + 중간 핵심 내용)
    const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 0);
    
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

  /**
   * 프롬프트 형식으로 포맷팅
   */
  private formatMemoryPrompt(
    summaries: Array<{id: string, content: string, type: string, importance: number, summary: string}>,
    query: string
  ): string {
    if (summaries.length === 0) {
      return '관련 기억을 찾을 수 없습니다.';
    }

    let prompt = `# 관련 기억 (${summaries.length}개)\n\n`;
    prompt += `**검색 쿼리**: "${query}"\n\n`;

    summaries.forEach((memory, index) => {
      const typeEmoji = this.getMemoryTypeEmoji(memory.type);
      const importanceStars = '★'.repeat(Math.ceil(memory.importance * 5));
      
      prompt += `## ${index + 1}. ${typeEmoji} ${memory.type.toUpperCase()} 기억\n`;
      prompt += `**중요도**: ${importanceStars} (${memory.importance.toFixed(2)})\n`;
      prompt += `**내용**: ${memory.summary}\n\n`;
    });

    prompt += '---\n';
    prompt += '*이 기억들은 현재 대화와 관련된 맥락 정보입니다. 참고하여 더 정확하고 관련성 높은 답변을 제공하세요.*';

    return prompt;
  }

  /**
   * 기억 타입별 이모지
   */
  private getMemoryTypeEmoji(type: string): string {
    const emojiMap: Record<string, string> = {
      'working': '🧠',
      'episodic': '📝',
      'semantic': '📚',
      'procedural': '⚙️'
    };
    return emojiMap[type] || '💭';
  }

  /**
   * 토큰 수 추정 (간단한 추정)
   */
  private estimateTokens(text: string): number {
    // 대략적인 토큰 수 추정 (실제로는 더 정확한 토크나이저 사용 가능)
    return Math.ceil(text.length / 4);
  }

  /**
   * Consolidation Score 메타데이터 업데이트
   * 검색 결과로 반환된 메모리들의 recall_count, last_accessed_at, g_value 업데이트
   * Write Coalescing을 사용하여 I/O 부하를 줄입니다.
   * (recall-tool.ts와 동일한 로직)
   * 
   * @param db 데이터베이스 연결
   * @param consolidationScoreService Consolidation Score 서비스
   * @param writeCoalescingManager Write Coalescing Manager (선택적)
   * @param searchItems 검색 결과 아이템 배열
   */
  private async updateConsolidationScoreMetadata(
    db: any,
    consolidationScoreService: ConsolidationScoreService,
    writeCoalescingManager: WriteCoalescingManager | undefined,
    searchItems: any[]
  ): Promise<void> {
    if (!searchItems || searchItems.length === 0) {
      return;
    }

    try {
      const now = new Date();
      const nowISO = now.toISOString();

      // 각 검색 결과에 대해 업데이트
      for (const item of searchItems) {
        const memoryId = item.id || item.memory_id;
        if (!memoryId) {
          continue; // ID가 없으면 스킵
        }

        try {
          // 기존 메모리 정보 조회 (recall_count, last_accessed_at, g_value, created_at, type, pinned)
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
            [memoryId]
          ) as {
            recall_count: number;
            last_accessed_at: string | null;
            g_value: number | null;
            created_at: string;
            type: MemoryType;
            pinned: boolean | number;
          } | undefined;

          if (!memory) {
            this.logWarning(`메모리를 찾을 수 없습니다: ${memoryId}`);
            continue;
          }

          // recall_count 증가
          const newRecallCount = (memory.recall_count || 0) + 1;

          // 경과 시간 계산 (last_accessed_at이 있으면 사용, 없으면 created_at 사용)
          const lastAccessedAt = memory.last_accessed_at 
            ? new Date(memory.last_accessed_at) 
            : new Date(memory.created_at);
          const timeElapsed = consolidationScoreService.calculateTimeElapsed(
            lastAccessedAt,
            new Date(memory.created_at),
            now
          );

          // g_value 업데이트
          const newGValue = consolidationScoreService.updateGValueForRecall({
            previousGValue: memory.g_value,
            timeElapsed
          });

          // consolidation_score 계산
          const scoreResult = consolidationScoreService.calculateScore({
            recallCount: newRecallCount,
            lastAccessedAt: now,
            createdAt: new Date(memory.created_at),
            gValue: newGValue,
            type: memory.type,
            pinned: memory.pinned === 1 || memory.pinned === true
          });

          // Write Coalescing 사용 여부 확인
          if (writeCoalescingManager) {
            // 버퍼에 추가 (주기적으로 flush됨)
            writeCoalescingManager.addWrite({
              memoryId,
              fields: {
                recall_count: newRecallCount,
                last_accessed_at: nowISO,
                g_value: newGValue,
                consolidation_score: scoreResult.score
              }
            });
          } else {
            // Write Coalescing이 없으면 즉시 업데이트
            DatabaseUtils.run(
              db,
              `UPDATE memory_item 
               SET 
                 recall_count = ?,
                 last_accessed_at = ?,
                 g_value = ?,
                 consolidation_score = ?
               WHERE id = ?`,
              [newRecallCount, nowISO, newGValue, scoreResult.score, memoryId]
            );
          }

        } catch (error) {
          // 개별 메모리 업데이트 실패해도 다른 메모리는 계속 업데이트
          this.logWarning(`메모리 업데이트 실패 (${memoryId})`, {
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }
    } catch (error) {
      // 전체 업데이트 실패해도 검색 결과는 정상 반환
      this.logError(error as Error, 'Consolidation Score 메타데이터 업데이트 실패', {
        itemCount: searchItems.length
      });
    }
  }
}
