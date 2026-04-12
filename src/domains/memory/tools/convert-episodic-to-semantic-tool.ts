/**
 * Convert Episodic to Semantic Tool - Episodic Memory를 Semantic Memory로 변환하는 도구
 * 
 * AriGraph Pipeline의 수동 변환 기능을 제공합니다.
 * 기존 Episodic Memory에 대해 Triple 추출 및 Semantic Memory 생성을 수행합니다.
 */

import { z } from 'zod';
import { BaseTool } from '../../../tools/base-tool.js';
import type { ToolContext, ToolResult } from '../../../tools/types.js';
import { DatabaseUtils } from '../../../shared/utils/database.js';
import { TripleExtractionService } from '../../relation/services/triple-extraction/triple-extraction-service.js';
import { SemanticMemoryUpdateService } from '../services/semantic-memory/semantic-memory-update-service.js';
import { logger } from '../../../shared/utils/logger.js';
import { UnifiedEmbeddingService } from '../../../domains/embedding/services/unified-embedding-service.js';
import { createRelationGraph } from '../../../infrastructure/relation-graph-factory.js';

/**
 * Convert Episodic to Semantic 스키마
 */
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
  async handle(params: any, context: ToolContext): Promise<ToolResult> {
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
      
      let episodicMemories: Array<{ id: string; content: string; importance: number }> = [];
      
      if (memory_id) {
        // 단일 Episodic Memory 변환
        // skip_converted 옵션 확인
        let memory: { id: string; content: string; importance: number; triple_extracted: number | null; triple_extracted_status: string | null } | undefined;
        
        // 먼저 메모리 존재 여부 확인
        const memoryExists = DatabaseUtils.get(db, `
          SELECT id, triple_extracted, triple_extracted_status FROM memory_item
          WHERE id = ? AND type = 'episodic'
        `, [memory_id]) as { id: string; triple_extracted: number | null; triple_extracted_status: string | null } | undefined;
        
        if (!memoryExists) {
          // 메모리가 존재하지 않는 경우
          return this.createErrorResult(
            'MEMORY_NOT_FOUND',
            `Episodic Memory를 찾을 수 없습니다: ${memory_id}`
          );
        }
        
        // skip_converted=true이고 이미 변환된 경우 skipped로 처리
        if (skip_converted && memoryExists.triple_extracted === 1 && memoryExists.triple_extracted_status === 'success') {
          return this.createSuccessResult({
            total: 1,
            success: 0,
            failed: 0,
            skipped: 1,
            semantic_memory_ids: []
          });
        }
        
        // skip_converted=true인 경우: 이미 변환된 항목은 조회하지 않음
        if (skip_converted) {
          memory = DatabaseUtils.get(db, `
            SELECT id, content, importance, triple_extracted, triple_extracted_status FROM memory_item
            WHERE id = ? AND type = 'episodic'
              AND (triple_extracted IS NULL OR triple_extracted = 0)
          `, [memory_id]) as { id: string; content: string; importance: number; triple_extracted: number | null; triple_extracted_status: string | null } | undefined;
        } else {
          memory = DatabaseUtils.get(db, `
            SELECT id, content, importance, triple_extracted, triple_extracted_status FROM memory_item
            WHERE id = ? AND type = 'episodic'
          `, [memory_id]) as { id: string; content: string; importance: number; triple_extracted: number | null; triple_extracted_status: string | null } | undefined;
        }
        
        if (!memory) {
          // skip_converted=true이고 이미 변환된 경우 (위에서 처리했지만 이중 검증)
          if (skip_converted) {
            return this.createSuccessResult({
              total: 1,
              success: 0,
              failed: 0,
              skipped: 1,
              semantic_memory_ids: []
            });
          }
          // 이 경우는 발생하지 않아야 하지만 안전을 위해
          return this.createErrorResult(
            'MEMORY_NOT_FOUND',
            `Episodic Memory를 찾을 수 없습니다: ${memory_id}`
          );
        }
        
        episodicMemories = [{ id: memory.id, content: memory.content, importance: memory.importance }];
      } else {
        // PRD 5.10: 배치 처리 지원 - 필터 조건에 따라 Episodic Memory 조회
        // PRD 5.11: 변환 상태 추적 로직 (이미 변환된 항목 건너뛰기, 실패한 항목 재시도 옵션)
        
        // WHERE 조건 구성
        const conditions: string[] = ["type = 'episodic'"];
        const params: any[] = [];
        
        // skip_converted=true인 경우: 이미 변환된 항목 건너뛰기
        // triple_extracted IS NULL (미처리) 또는 triple_extracted = 0 (실패)
        if (skip_converted) {
          conditions.push("(triple_extracted IS NULL OR triple_extracted = 0)");
        }
        
        // retry_failed 옵션에 따른 조건 추가
        if (retry_failed) {
          // 실패한 항목 재시도: failed 또는 미처리 항목 포함
          // skip_converted=false이면 성공 항목도 포함되므로 조건을 추가하지 않음
          if (skip_converted) {
            conditions.push("(triple_extracted_status IS NULL OR triple_extracted_status = 'failed')");
          }
        } else {
          // retry_failed=false인 경우: 실패한 항목 제외
          conditions.push("(triple_extracted_status IS NULL OR triple_extracted_status != 'failed')");
        }
        
        // 포기된 항목은 제외 (수동 재시도 필요)
        conditions.push("(triple_extracted_status IS NULL OR triple_extracted_status != 'abandoned')");
        
        // 쿼리 실행
        // SQL Injection 방지: conditions는 이미 파라미터 바인딩(?)을 포함하고 있어 안전함
        const query = 
          `SELECT id, content, importance FROM memory_item ` +
          `WHERE ${conditions.join(' AND ')} ` +
          `ORDER BY created_at ASC ` +
          `LIMIT ?`;
        params.push(limit);
        
        episodicMemories = DatabaseUtils.all(db, query, params) as Array<{ id: string; content: string; importance: number }>;
        
        if (episodicMemories.length === 0) {
          return this.createSuccessResult({
            total: 0,
            success: 0,
            failed: 0,
            skipped: 0,
            semantic_memory_ids: [],
            message: '변환할 Episodic Memory가 없습니다.'
          });
        }
      }

      // 변환 결과 추적
      const results = {
        total: episodicMemories.length,
        success: 0,
        failed: 0,
        skipped: 0,
        semantic_memory_ids: [] as string[]
      };

      // 이미 변환된 ID 일괄 조회 (N+1 완화)
      let alreadyConvertedIds = new Set<string>();
      if (skip_converted && episodicMemories.length > 0) {
        const ids = episodicMemories.map((m) => m.id);
        const placeholders = ids.map(() => '?').join(',');
        const rows = DatabaseUtils.all(db, `
          SELECT id FROM memory_item
          WHERE id IN (${placeholders}) AND triple_extracted = 1 AND triple_extracted_status = 'success'
        `, ids) as Array<{ id: string }>;
        alreadyConvertedIds = new Set(rows.map((r) => r.id));
      }

      const tripleExtractionService = new TripleExtractionService();
      const toProcess = episodicMemories.filter((m) => !alreadyConvertedIds.has(m.id));
      results.skipped += episodicMemories.length - toProcess.length;

      const BATCH_SIZE = 3;
      for (let i = 0; i < toProcess.length; i += BATCH_SIZE) {
        const batch = toProcess.slice(i, i + BATCH_SIZE);
        const extractionResults = await Promise.all(
          batch.map((ep) => tripleExtractionService.extractTriples(ep.content, {}, ep.id))
        );
        for (let j = 0; j < batch.length; j++) {
          const episodicMemory = batch[j];
          const extractionResult = extractionResults[j];
          if (!episodicMemory || !extractionResult) continue;
          try {

          // Triple이 추출된 경우 Semantic Memory 생성/업데이트
          if (extractionResult.triples.length > 0) {
            const unifiedForSemantic: UnifiedEmbeddingService = context.services.embeddingService
              ? context.services.embeddingService.getUnifiedEmbeddingService()
              : new UnifiedEmbeddingService();
            const semanticMemoryUpdateService = new SemanticMemoryUpdateService(
              db,
              unifiedForSemantic,
              context.services.relationGraph ?? createRelationGraph(db)
            );

            const updateResult = await semanticMemoryUpdateService.updateSemanticMemory(
              extractionResult,
              {
                episodicMemoryId: episodicMemory.id,
                episodicImportance: episodicMemory.importance || 0.5
              }
            );

            // PRD 5.5, 5.5a, 5.6: Triple 추출 성공 시 상태 업데이트
            const confidenceValues: number[] = [];
            try {
              const relations = DatabaseUtils.all(db, `
                SELECT confidence FROM memory_relation
                WHERE source_id = ? AND relation_type = 'extracted_from'
              `, [episodicMemory.id]) as Array<{ confidence?: number | null }>;
              for (const rel of relations) {
                if (rel.confidence !== null && rel.confidence !== undefined) {
                  confidenceValues.push(rel.confidence);
                }
              }
            } catch (err) {
              logger.warn('Confidence 수집 실패', {
                memory_id: episodicMemory.id,
                error: err instanceof Error ? err.message : String(err)
              });
            }

            const confidenceAvg = confidenceValues.length > 0
              ? confidenceValues.reduce((sum, c) => sum + c, 0) / confidenceValues.length
              : null;

            const metadata = {
              triple_count: extractionResult.triples.length,
              ...(confidenceAvg !== null && { confidence_avg: confidenceAvg }),
              extracted_at: new Date().toISOString()
            };

            await DatabaseUtils.run(db, `
              UPDATE memory_item SET
                triple_extracted = ?,
                triple_extracted_status = ?,
                triple_extraction_metadata = ?
              WHERE id = ?
            `, [
              1, // SQLite에서는 boolean을 INTEGER로 변환
              'success',
              JSON.stringify(metadata),
              episodicMemory.id
            ]);

            results.success++;
            results.semantic_memory_ids.push(...updateResult.semanticMemoryIds);

            logger.info('Episodic Memory 변환 성공', {
              episodic_memory_id: episodicMemory.id,
              triple_count: extractionResult.triples.length,
              semantic_memory_count: updateResult.semanticMemoryIds.length,
              confidence_avg: confidenceAvg
            });
          } else {
            // Triple 추출 실패 시 상태 업데이트
            const failureReason = extractionResult.extractionInfo.failureReason || 'no_triple';
            
            let retryCount = 0;
            try {
              const existing = DatabaseUtils.get(db, `
                SELECT triple_extraction_metadata FROM memory_item WHERE id = ?
              `, [episodicMemory.id]) as { triple_extraction_metadata?: string } | undefined;
              if (existing?.triple_extraction_metadata) {
                const existingMeta = JSON.parse(existing.triple_extraction_metadata);
                retryCount = (existingMeta.retry_count || 0) + 1;
              } else {
                retryCount = 1;
              }
            } catch (err) {
              retryCount = 1;
            }

            const metadata = {
              failureReason,
              retry_count: retryCount,
              last_attempt: new Date().toISOString()
            };

            await DatabaseUtils.run(db, `
              UPDATE memory_item SET
                triple_extracted = ?,
                triple_extracted_status = ?,
                triple_extraction_metadata = ?
              WHERE id = ?
            `, [
              0, // SQLite에서는 boolean을 INTEGER로 변환
              'failed',
              JSON.stringify(metadata),
              episodicMemory.id
            ]);

            results.failed++;

            logger.warn('Episodic Memory 변환 실패', {
              episodic_memory_id: episodicMemory.id,
              failure_reason: failureReason,
              retry_count: retryCount
            });
          }
        } catch (error) {
          results.failed++;
          
          // 에러 발생 시에도 상태 업데이트 (PRD 5.5, 5.5a, 5.6)
          try {
            await DatabaseUtils.run(db, `
              UPDATE memory_item SET
                triple_extracted = ?,
                triple_extracted_status = ?,
                triple_extraction_metadata = ?
              WHERE id = ?
            `, [
              0, // SQLite에서는 boolean을 INTEGER로 변환
              'failed',
              JSON.stringify({
                failureReason: 'conversion_error',
                error: error instanceof Error ? error.message : String(error),
                last_attempt: new Date().toISOString()
              }),
              episodicMemory.id
            ]);
          } catch (updateError) {
            logger.warn('상태 업데이트 실패', {
              episodic_memory_id: episodicMemory.id,
              error: updateError instanceof Error ? updateError.message : String(updateError)
            });
          }
          
          logger.error('Episodic Memory 변환 중 에러 발생', {
            episodic_memory_id: episodicMemory.id,
            error: error instanceof Error ? error.message : String(error)
          });
        }
        }
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
}

