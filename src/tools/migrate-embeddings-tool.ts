/**
 * Migrate Embeddings Tool - 임베딩 마이그레이션 도구
 * 기존 기억을 새로운 provider로 재임베딩
 */

import { z } from 'zod';
import { BaseTool } from './base-tool.js';
import type { ToolContext, ToolResult } from './types.js';
import { UnifiedEmbeddingService } from '../services/unified-embedding-service.js';
import type { EmbeddingProvider } from '../shared/types/index.js';
import { DatabaseUtils } from '../shared/utils/database.js';
import { vectorCompatibilityService } from '../services/vector-compatibility-service.js';

const MigrationSchema = z.object({
  source_provider: z.enum(['tfidf', 'lightweight', 'minilm', 'openai', 'gemini']).optional(),
  target_provider: z.enum(['tfidf', 'lightweight', 'minilm', 'openai', 'gemini']),
  batch_size: z.number().int().min(1).max(1000).optional().default(100),
  dry_run: z.boolean().optional().default(false)
}).refine((data) => {
  // source_provider와 target_provider가 동일하면 에러
  if (data.source_provider && data.source_provider === data.target_provider) {
    return false;
  }
  return true;
}, {
  message: "재임베딩 불필요 - source와 target이 동일합니다"
});

interface MigrationResult {
  total_count: number;
  success_count: number;
  failed_count: number;
  failed_memory_ids: string[];
  errors: Array<{ memory_id: string; error: string }>;
}

export class MigrateEmbeddingsTool extends BaseTool {
  private embeddingService: UnifiedEmbeddingService;
  private readonly createdByTag = 'migrate_embeddings_tool';

  constructor() {
    super(
      'migrate_embeddings',
      '기존 기억을 새로운 임베딩 provider로 재임베딩합니다',
      {
        type: 'object',
        properties: {
          source_provider: {
            type: 'string',
            enum: ['tfidf', 'lightweight', 'minilm', 'openai', 'gemini'],
            description: '마이그레이션할 source provider (선택사항, 미지정 시 모든 provider)'
          },
          target_provider: {
            type: 'string',
            enum: ['tfidf', 'lightweight', 'minilm', 'openai', 'gemini'],
            description: '마이그레이션할 target provider (필수)'
          },
          batch_size: {
            type: 'number',
            minimum: 1,
            maximum: 1000,
            default: 100,
            description: '배치 크기 (기본값: 100)'
          },
          dry_run: {
            type: 'boolean',
            default: false,
            description: '시뮬레이션 모드 (실제 DB 변경 없이 로그만 출력)'
          }
        },
        required: ['target_provider']
      }
    );

    this.embeddingService = new UnifiedEmbeddingService();
  }

  /**
   * sqlite-vec 확장 로드
   */
  private async loadVecExtension(db: any): Promise<void> {
    try {
      const { getLoadablePath } = await import('sqlite-vec');
      const extensionPath = getLoadablePath();
      db.loadExtension(extensionPath);
    } catch (error) {
      console.warn('⚠️ sqlite-vec 확장 로드 실패:', error);
    }
  }

  /**
   * 특정 provider로 임베딩 생성 및 저장
   */
  private async createAndStoreEmbeddingForProvider(
    db: any,
    memoryId: string,
    content: string,
    targetProvider: EmbeddingProvider
  ): Promise<void> {
    // sqlite-vec 확장 로드
    await this.loadVecExtension(db);

    // target_provider로 임베딩 생성
    const embeddingResult = await this.embeddingService.generateEmbedding(content, targetProvider);
    if (!embeddingResult) {
      throw new Error('임베딩 생성 실패');
    }

    const embeddingVector = Array.isArray(embeddingResult.embedding) ? embeddingResult.embedding : [];
    if (embeddingVector.length === 0) {
      throw new Error('임베딩 결과가 비어있음');
    }

    const provider = (embeddingResult.provider || targetProvider).toLowerCase() as EmbeddingProvider;

    // 벡터 호환성 평가
    const compatibility = vectorCompatibilityService.assessProviderCompatibility(
      embeddingVector,
      provider
    );

    const blockingIssues = compatibility.issues.filter(
      issue => issue.severity === 'error' && issue.code !== 'dimension_mismatch'
    );

    if (blockingIssues.length > 0) {
      throw new Error(`임베딩 벡터 검증 실패: ${blockingIssues.map(issue => issue.message).join(', ')}`);
    }

    const projection = compatibility.projection;
    const storedVector = projection.vector;
    const serializedEmbedding = JSON.stringify(storedVector);
    const sourceDimensions = projection.sourceDimensions;
    const storedDimensions = projection.targetDimensions;
    const projectionType = projection.projectionType;
    const normalized = projection.normalized ? 1 : 0;

    // metadata 보정 (기존 레거시 행 대비)
    await DatabaseUtils.run(db, `
      UPDATE memory_embedding
      SET embedding_provider = COALESCE(
        NULLIF(embedding_provider, ''),
        'tfidf'
      )
      WHERE embedding_provider IS NULL
         OR embedding_provider = ''
    `);

    // memory_embedding 테이블에 저장 (기존 임베딩 유지, 새 provider 추가)
    // UNIQUE 제약조건으로 인해 같은 provider가 있으면 업데이트, 없으면 삽입
    await DatabaseUtils.run(db, `
      INSERT OR REPLACE INTO memory_embedding (
        memory_id,
        embedding_provider,
        projection_type,
        embedding,
        dim,
        model,
        dimensions,
        precision,
        normalized,
        version,
        created_by,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `, [
      memoryId,
      provider,
      projectionType,
      serializedEmbedding,
      sourceDimensions,
      embeddingResult.model,
      storedDimensions,
      32,
      normalized,
      1,
      this.createdByTag
    ]);
  }

  async handle(params: any, context: ToolContext): Promise<ToolResult> {
    this.logInfo('Migrate Embeddings 도구 호출됨', { params });

    try {
      // 파라미터 검증 및 파싱
      const {
        source_provider,
        target_provider,
        batch_size,
        dry_run
      } = MigrationSchema.parse(params);

      // source_provider === target_provider 케이스 처리
      if (source_provider === target_provider) {
        return this.createErrorResult(
          'INVALID_PARAMETERS',
          '재임베딩 불필요 - source와 target이 동일합니다',
          `source_provider와 target_provider가 모두 '${source_provider}'로 동일합니다. 다른 provider를 선택하세요.`
        );
      }

      // 데이터베이스 연결 확인
      this.validateDatabase(context);

      const db = context.db!;
      const startTime = Date.now();

      // 마이그레이션할 메모리 조회
      let memoryQuery = `
        SELECT DISTINCT mi.id, mi.content, mi.type
        FROM memory_item mi
        INNER JOIN memory_embedding me ON mi.id = me.memory_id
        WHERE me.embedding_provider IS NOT NULL
          AND me.embedding_provider != ''
      `;

      const queryParams: any[] = [];

      if (source_provider) {
        memoryQuery += ` AND me.embedding_provider = ?`;
        queryParams.push(source_provider);
      }

      // target_provider로 이미 임베딩이 있는 메모리는 제외
      memoryQuery += `
        AND NOT EXISTS (
          SELECT 1 FROM memory_embedding me2
          WHERE me2.memory_id = mi.id
            AND me2.embedding_provider = ?
        )
      `;
      queryParams.push(target_provider);

      memoryQuery += ` ORDER BY mi.id LIMIT ?`;
      queryParams.push(10000); // 최대 10000개까지 처리

      const memoriesToMigrate = db.prepare(memoryQuery).all(...queryParams) as Array<{
        id: string;
        content: string;
        type: string;
      }>;

      const totalCount = memoriesToMigrate.length;

      if (totalCount === 0) {
        return this.createSuccessResult({
          total_count: 0,
          success_count: 0,
          failed_count: 0,
          failed_memory_ids: [],
          errors: [],
          message: dry_run 
            ? '마이그레이션할 메모리가 없습니다 (dry_run 모드)'
            : '마이그레이션할 메모리가 없습니다'
        });
      }

      this.logInfo('마이그레이션 시작', {
        total_count: totalCount,
        source_provider: source_provider || 'all',
        target_provider,
        batch_size,
        dry_run
      });

      // 배치 처리
      const result: MigrationResult = {
        total_count: totalCount,
        success_count: 0,
        failed_count: 0,
        failed_memory_ids: [],
        errors: []
      };

      for (let i = 0; i < memoriesToMigrate.length; i += batch_size) {
        const batch = memoriesToMigrate.slice(i, i + batch_size);
        const batchNumber = Math.floor(i / batch_size) + 1;
        const totalBatches = Math.ceil(memoriesToMigrate.length / batch_size);

        this.logInfo(`배치 ${batchNumber}/${totalBatches} 처리 중`, {
          batch_size: batch.length,
          progress: `${i + batch.length}/${totalCount}`
        });

        for (const memory of batch) {
          try {
            if (dry_run) {
              // dry_run 모드: 실제 재임베딩 없이 로그만 출력
              this.logInfo('재임베딩 시뮬레이션', {
                memory_id: memory.id,
                source_provider: source_provider || 'any',
                target_provider
              });
              result.success_count++;
            } else {
              // 실제 재임베딩 수행
              // target_provider로 임베딩 생성 및 저장 (기존 임베딩은 유지)
              await this.createAndStoreEmbeddingForProvider(
                db,
                memory.id,
                memory.content,
                target_provider as EmbeddingProvider
              );

              result.success_count++;
            }
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            result.failed_count++;
            result.failed_memory_ids.push(memory.id);
            result.errors.push({
              memory_id: memory.id,
              error: errorMessage
            });

            this.logWarning('재임베딩 실패', {
              memory_id: memory.id,
              error: errorMessage
            });
          }
        }
      }

      const executionTime = Date.now() - startTime;

      this.logInfo('마이그레이션 완료', {
        total_count: result.total_count,
        success_count: result.success_count,
        failed_count: result.failed_count,
        execution_time: `${executionTime}ms`,
        dry_run
      });

      return this.createSuccessResult({
        ...result,
        execution_time_ms: executionTime,
        dry_run
      });
    } catch (error) {
      this.logError(error as Error, '마이그레이션 실행 중 오류', { params });
      
      if (error instanceof z.ZodError) {
        return this.createErrorResult(
          'INVALID_PARAMETERS',
          '파라미터 검증 실패',
          error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')
        );
      }

      return this.createErrorResult(
        'MIGRATION_FAILED',
        '마이그레이션 실행 실패',
        error instanceof Error ? error.message : String(error)
      );
    }
  }
}
