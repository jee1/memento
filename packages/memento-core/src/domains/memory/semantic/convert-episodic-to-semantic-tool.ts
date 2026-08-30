/**
 * Convert Episodic to Semantic Tool - Episodic Memory를 Semantic Memory로 변환하는 도구
 * 
 * AriGraph Pipeline의 수동 변환 기능을 제공합니다.
 * 기존 Episodic Memory에 대해 Triple 추출 및 Semantic Memory 생성을 수행합니다.
 */

import { z } from 'zod';
import type Database from 'better-sqlite3';
import { BaseTool } from '../../../tools/base-tool.js';
import type { ToolContext, ToolResult } from '../../../tools/types.js';
import { DatabaseUtils } from '../../../shared/utils/database.js';
import { TripleExtractionService } from '../../relation/services/triple-extraction/triple-extraction-service.js';
import { SemanticMemoryUpdateService } from './semantic-memory-update-service.js';
import { logger } from '../../../shared/utils/logger.js';
import { UnifiedEmbeddingService } from '../../embedding/services/unified-embedding-service.js';
import { convertEpisodicSource } from './episodic-semantic-conversion.js';

/**
 * Convert Episodic to Semantic 스키마
 */
const RELATION_GRAPH_UNAVAILABLE_ERROR = 'relation_graph_unavailable';

/** #805 T014: 배치 job과 동일한 재시도 기본값 (triple-extraction-batch-job.ts) */
const MAX_RETRIES = 3;
const RETRY_BACKOFF_DAYS = [1, 2, 4];

type EpisodicMemoryRow = {
  id: string;
  content: string;
  importance: number | null; // DB NULL 가능, 사용 시 ?? 0.5 폴백
};

type ConversionResults = {
  total: number;
  success: number;
  failed: number;
  skipped: number;
  semantic_memory_ids: string[];
};

const ConvertEpisodicToSemanticSchema = z.object({
  memory_id: z.string().optional(), // 단일 Episodic Memory ID (선택)
  // 필터 조건 (memory_id가 없을 때 사용)
  skip_converted: z.boolean().default(true).optional(), // 이미 변환된 항목 건너뛰기 (기본값: true)
  retry_failed: z.boolean().default(false).optional(), // 실패한 항목 재시도 (기본값: false)
  limit: z.number().min(1).max(100).default(10).optional(), // 배치 처리 시 최대 개수 (기본값: 10)
});

export class ConvertEpisodicToSemanticTool extends BaseTool {
  constructor() {
    super(
      'convert_episodic_to_semantic',
      '기존 Episodic Memory를 Semantic Memory로 변환합니다. Triple 추출 및 Semantic Memory 생성을 수행합니다.',
      {
        type: 'object',
        properties: {
          memory_id: {
            type: 'string',
            description: '변환할 Episodic Memory ID (단일 변환 시 사용, 선택)'
          },
          skip_converted: {
            type: 'boolean',
            description: '이미 변환된 항목 건너뛰기 여부 (기본값: true)',
            default: true
          },
          retry_failed: {
            type: 'boolean',
            description: '실패한 항목 재시도 여부 (기본값: false)',
            default: false
          },
          limit: {
            type: 'number',
            minimum: 1,
            maximum: 100,
            description: '배치 처리 시 최대 개수 (기본값: 10)',
            default: 10
          }
        },
        required: [] // memory_id 또는 필터 조건 중 하나는 필수
      }
    );
  }

  /**
   * Given: memory_id 또는 필터 조건
   * When: convert_episodic_to_semantic 호출
   * Then: Triple 추출 및 Semantic Memory 생성 결과 반환
   */
  async handle(params: unknown, context: ToolContext): Promise<ToolResult> {
    try {
      const {
        memory_id,
        skip_converted = true,
        retry_failed = false,
        limit = 10
      } = ConvertEpisodicToSemanticSchema.parse(params);

      const db = context.db;
      if (!db) {
        return this.createErrorResult(
          'DATABASE_NOT_AVAILABLE',
          '데이터베이스가 사용 가능하지 않습니다'
        );
      }

      // PRD 5.9: 수동 변환 로직 구현
      // 선택된 Episodic Memory에 대해 Triple 추출 및 Semantic Memory 생성

      const resolved = this.resolveMemories(db, memory_id, skip_converted, retry_failed, limit);
      if (!Array.isArray(resolved)) return resolved;
      const episodicMemories = resolved;

      // 변환 결과 추적
      const results = {
        total: episodicMemories.length,
        success: 0,
        failed: 0,
        skipped: 0,
        semantic_memory_ids: [] as string[]
      };

      const alreadyConvertedIds = this.fetchAlreadyConverted(db, episodicMemories, skip_converted);

      const tripleExtractionService = new TripleExtractionService();
      const semanticMemoryUpdateService = this.buildSemanticMemoryUpdateService(db, context);
      const toProcess = episodicMemories.filter((m) => !alreadyConvertedIds.has(m.id));
      results.skipped += episodicMemories.length - toProcess.length;

      for (const episodicMemory of toProcess) {
        await this.convertSingleMemory(
          episodicMemory,
          db,
          results,
          tripleExtractionService,
          semanticMemoryUpdateService,
          skip_converted
        );
      }

      return this.createSuccessResult({
        total: results.total,
        success: results.success,
        failed: results.failed,
        skipped: results.skipped,
        semantic_memory_ids: results.semantic_memory_ids
      });
    } catch (error) {
      logger.error('ConvertEpisodicToSemanticTool: 에러 발생', {
        error: error instanceof Error ? error.message : String(error)
      });
      
      return this.createErrorResult(
        'CONVERSION_ERROR',
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  private resolveMemories(
    db: Database.Database,
    memoryId: string | undefined,
    skipConverted: boolean,
    retryFailed: boolean,
    limit: number,
  ): EpisodicMemoryRow[] | ToolResult {
    if (memoryId) {
      return this.fetchSingleMemory(db, memoryId, skipConverted);
    }
    return this.fetchBatchMemories(db, skipConverted, retryFailed, limit);
  }

  private fetchAlreadyConverted(
    db: Database.Database,
    memories: EpisodicMemoryRow[],
    skipConverted: boolean,
  ): Set<string> {
    if (!skipConverted || memories.length === 0) return new Set();
    const ids = memories.map((m) => m.id);
    const placeholders = ids.map(() => '?').join(',');
    const rows = DatabaseUtils.all(db, `
      SELECT id FROM memory_item
      WHERE id IN (${placeholders}) AND triple_extracted = 1 AND triple_extracted_status = 'success'
    `, ids) as Array<{ id: string }>;
    return new Set(rows.map((r) => r.id));
  }

  private fetchSingleMemory(
    db: Database.Database,
    memoryId: string,
    skipConverted: boolean,
  ): EpisodicMemoryRow[] | ToolResult {
    const memoryExists = DatabaseUtils.get(db, `
      SELECT id, triple_extracted, triple_extracted_status FROM memory_item
      WHERE id = ? AND type = 'episodic'
    `, [memoryId]) as { id: string; triple_extracted: number | null; triple_extracted_status: string | null } | undefined;

    if (!memoryExists) {
      return this.createErrorResult('MEMORY_NOT_FOUND', `Episodic Memory를 찾을 수 없습니다: ${memoryId}`);
    }

    if (skipConverted && memoryExists.triple_extracted === 1 && memoryExists.triple_extracted_status === 'success') {
      return this.createSuccessResult({ total: 1, success: 0, failed: 0, skipped: 1, semantic_memory_ids: [] });
    }

    type MemoryRow = { id: string; content: string; importance: number | null; triple_extracted: number | null; triple_extracted_status: string | null };
    let memory: MemoryRow | undefined;

    if (skipConverted) {
      memory = DatabaseUtils.get(db, `
        SELECT id, content, importance, triple_extracted, triple_extracted_status FROM memory_item
        WHERE id = ? AND type = 'episodic'
          AND (triple_extracted IS NULL OR triple_extracted = 0)
      `, [memoryId]) as MemoryRow | undefined;
    } else {
      memory = DatabaseUtils.get(db, `
        SELECT id, content, importance, triple_extracted, triple_extracted_status FROM memory_item
        WHERE id = ? AND type = 'episodic'
      `, [memoryId]) as MemoryRow | undefined;
    }

    if (!memory) {
      // triple_extracted=1이지만 status가 'success'가 아닌 레거시/부패 데이터 방어
      if (skipConverted) {
        return this.createSuccessResult({ total: 1, success: 0, failed: 0, skipped: 1, semantic_memory_ids: [] });
      }
      return this.createErrorResult('MEMORY_NOT_FOUND', `Episodic Memory를 찾을 수 없습니다: ${memoryId}`);
    }

    return [{ id: memory.id, content: memory.content, importance: memory.importance }];
  }

  /**
   * memory 선택과 공개 결과 집계만 담당한다. source snapshot/commit/failure 전이는 공유
   * conversion coordinator(#805 T013, `convertEpisodicSource`)가 전담하고, 이 메서드는 coordinator의
   * outcome kind만 기존 `{success,failed,skipped,semantic_memory_ids}` 카운터로 변환한다.
   */
  private async convertSingleMemory(
    episodicMemory: EpisodicMemoryRow,
    db: Database.Database,
    results: ConversionResults,
    tripleExtractionService: Pick<TripleExtractionService, 'extractTriples'>,
    semanticMemoryUpdateService: SemanticMemoryUpdateService,
    skipConverted: boolean,
  ): Promise<void> {
    const outcome = await convertEpisodicSource(
      { db, tripleExtractionService, semanticMemoryUpdateService },
      {
        sourceId: episodicMemory.id,
        skipConverted,
        maxRetries: MAX_RETRIES,
        retryBackoffDays: RETRY_BACKOFF_DAYS,
        now: () => new Date()
      }
    );

    if (outcome.kind === 'success') {
      results.success++;
      results.semantic_memory_ids.push(...outcome.update.semanticMemoryIds);
    } else if (outcome.kind === 'failed') {
      results.failed++;
    } else {
      results.skipped++;
    }
  }

  /**
   * relationGraph가 없으면 coordinator가 실제 추출 이후 실패로 분류할 수 있도록 lazy하게
   * `relation_graph_unavailable`을 던지는 stub을 반환한다 (기존 동작 보존).
   * relationGraph가 있으면 실제 서비스 생성도 첫 호출까지 지연해 no-triple 케이스의 불필요한
   * 초기화를 피한다.
   */
  private buildSemanticMemoryUpdateService(
    db: Database.Database,
    context: ToolContext,
  ): SemanticMemoryUpdateService {
    const relationGraph = context.services.relationGraph;
    if (!relationGraph) {
      return {
        updateSemanticMemoryWithEvidence: async () => {
          throw new Error(RELATION_GRAPH_UNAVAILABLE_ERROR);
        }
      } as unknown as SemanticMemoryUpdateService;
    }

    let real: SemanticMemoryUpdateService | undefined;
    const getReal = (): SemanticMemoryUpdateService => {
      if (!real) {
        const unifiedForSemantic: UnifiedEmbeddingService = context.services.embeddingService
          ? context.services.embeddingService.getUnifiedEmbeddingService()
          : new UnifiedEmbeddingService();
        real = new SemanticMemoryUpdateService(
          db,
          relationGraph,
          unifiedForSemantic,
          undefined,
          context.services.embeddingService
        );
      }
      return real;
    };

    return {
      updateSemanticMemoryWithEvidence: (extractionResult: unknown, options: unknown) =>
        getReal().updateSemanticMemoryWithEvidence(extractionResult, options)
    } as unknown as SemanticMemoryUpdateService;
  }

  private fetchBatchMemories(
    db: Database.Database,
    skipConverted: boolean,
    retryFailed: boolean,
    limit: number,
  ): EpisodicMemoryRow[] | ToolResult {
    const conditions: string[] = ["type = 'episodic'"];
    const queryParams: unknown[] = [];

    if (skipConverted) {
      conditions.push("(triple_extracted IS NULL OR triple_extracted = 0)");
    }

    if (retryFailed) {
      if (skipConverted) {
        conditions.push("(triple_extracted_status IS NULL OR triple_extracted_status = 'failed')");
      }
      // skipConverted=false이면 성공 항목도 포함되므로 status 필터를 추가하지 않음
    } else {
      conditions.push("(triple_extracted_status IS NULL OR triple_extracted_status != 'failed')");
    }

    conditions.push("(triple_extracted_status IS NULL OR triple_extracted_status != 'abandoned')");

    const query =
      `SELECT id, content, importance FROM memory_item ` +
      `WHERE ${conditions.join(' AND ')} ` +
      `ORDER BY created_at ASC ` +
      `LIMIT ?`;
    queryParams.push(limit);

    const memories = DatabaseUtils.all(db, query, queryParams) as EpisodicMemoryRow[];

    if (memories.length === 0) {
      return this.createSuccessResult({
        total: 0,
        success: 0,
        failed: 0,
        skipped: 0,
        semantic_memory_ids: [],
        message: '변환할 Episodic Memory가 없습니다.'
      });
    }

    return memories;
  }
}

