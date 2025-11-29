/**
 * Extract Relations Tool - 관계 추출 도구
 * 특정 메모리에 대해 관계를 추출합니다.
 */

import { z } from 'zod';
import { BaseTool } from '../../../tools/base-tool.js';
import type { ToolContext, ToolResult } from '../../../tools/types.js';
import { DatabaseUtils } from '../../../../shared/utils/database.js';
import { RelationExtractor } from '../domains/relation/services/relation-extractor.js';
import { RelationGraph } from '../domains/relation/services/relation-graph.js';
import type { MemoryType, PrivacyScope } from '../../../../shared/types/types/index.js';
import { logger } from '../../../../shared/utils/logger.js';
import { isMemoryRow, convertMemoryRowToItem } from '../../../../shared/utils/type-guards.js';

const ExtractRelationsSchema = z.object({
  memory_id: z.string().min(1, 'memory_id는 필수입니다'),
  force: z.boolean().optional().default(false).describe('강제 재추출 여부 (캐시 무시)')
});

export class ExtractRelationsTool extends BaseTool {
  constructor() {
    super(
      'extract_relations',
      '특정 메모리에 대해 기존 메모리들과의 관계를 추출합니다',
      {
        type: 'object',
        properties: {
          memory_id: {
            type: 'string',
            description: '관계를 추출할 메모리 ID'
          },
          force: {
            type: 'boolean',
            description: '강제 재추출 여부 (캐시 무시, 기본값: false)',
            default: false
          }
        },
        required: ['memory_id']
      }
    );
  }

  /**
   * Given: memory_id와 force 옵션
   * When: 관계 추출 수행
   * Then: 추출된 관계 목록 반환
   */
  async handle(params: z.infer<typeof ExtractRelationsSchema>, context: ToolContext): Promise<ToolResult> {
    const { memory_id, force } = ExtractRelationsSchema.parse(params);
    const db = context.db;

    try {
      // Given: 메모리 존재 확인
      const memoryResult = DatabaseUtils.get(db, `
        SELECT id, type, content, importance, privacy_scope, created_at
        FROM memory_item
        WHERE id = ?
      `, [memory_id]);

      if (!memoryResult || !isMemoryRow(memoryResult)) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: 'MEMORY_NOT_FOUND',
              message: `메모리를 찾을 수 없습니다: ${memory_id}`
            }, null, 2)
          }]
        };
      }

      // MemoryItem으로 변환 (타입 안전성 보장)
      const memoryItem = convertMemoryRowToItem(memoryResult);
      if (!memoryItem) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: 'INVALID_MEMORY_TYPE',
              message: `메모리 타입이 유효하지 않습니다: ${memory_id}`
            }, null, 2)
          }]
        };
      }

      // 기존 메모리 목록 조회 (자기 자신 제외)
      const existingMemoriesResult = DatabaseUtils.all(db, `
        SELECT id, type, content, importance, privacy_scope, created_at
        FROM memory_item
        WHERE id != ?
        ORDER BY created_at DESC
        LIMIT 1000
      `, [memory_id]);

      // 타입 가드를 사용하여 안전하게 변환
      const existingMemoryItems = existingMemoriesResult
        .map(row => {
          if (!isMemoryRow(row)) {
            logger.warn('기존 메모리 조회 결과 타입 검증 실패', { row });
            return null;
          }
          return convertMemoryRowToItem(row);
        })
        .filter((item): item is NonNullable<typeof item> => item !== null);

      if (existingMemoryItems.length === 0) {
        return this.createSuccessResult({
          memory_id,
          extracted_count: 0,
          relations: [],
          message: '관계를 추출할 기존 메모리가 없습니다'
        });
      }

      // When: 관계 추출 수행
      const relationExtractor = new RelationExtractor();

      // force가 true이면 캐시를 무시하고 즉시 처리
      const extractOptions = {
        immediate: force, // force가 true면 즉시 처리 (캐시 무시), false면 캐시 사용
        minConfidence: 0.5
      };

      const candidates = await relationExtractor.extractRelations(
        memoryItem,
        existingMemoryItems,
        extractOptions
      );

      // 추출된 관계를 RelationGraph에 저장
      let savedCount = 0;
      if (candidates.length > 0) {
        // RelationGraph 인스턴스 생성 (context에 없으면 새로 생성)
        const relationGraph = context.services.relationGraph || new RelationGraph(db);
        
        for (const candidate of candidates) {
          try {
            await relationGraph.addRelation(
              candidate.source_id,
              candidate.target_id,
              candidate.relation_type,
              { confidence: candidate.confidence }
            );
            savedCount++;
          } catch (error) {
            // 중복 관계나 순환 관계는 무시
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.warn('관계 저장 실패', {
              source_id: candidate.source_id,
              target_id: candidate.target_id,
              relation_type: candidate.relation_type,
              error: errorMessage
            });
          }
        }
      }

      // Then: 결과 반환
      return this.createSuccessResult({
        memory_id,
        extracted_count: candidates.length,
        saved_count: savedCount,
        relations: candidates.map(c => ({
          source_id: c.source_id,
          target_id: c.target_id,
          relation_type: c.relation_type,
          confidence: c.confidence
        })),
        message: `${candidates.length}개의 관계를 추출했습니다 (${savedCount}개 저장됨)`
      });

    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: 'EXTRACTION_FAILED',
            message: error instanceof Error ? error.message : String(error)
          }, null, 2)
        }]
      };
    }
  }
}
