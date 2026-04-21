/**
 * Get Relations Tool - 관계 조회 도구
 * 특정 메모리의 관계를 조회합니다.
 */

import { z } from 'zod';
import { createRelationGraph } from '../../../infrastructure/relation-graph-factory.js';
import type { GetRelationsOptions,MemoryRelation } from '../../../shared/types/relation-graph.js';
import type { RelationType } from '../../../shared/types/relation.js';
import { RELATION_TYPE_CATEGORY_MAP } from '../../../shared/types/relation.js';
import { DatabaseUtils } from '../../../shared/utils/database.js';
import { BaseTool } from '../../../tools/base-tool.js';
import type { ToolContext,ToolResult } from '../../../tools/types.js';

const GetRelationsSchema = z.object({
  memory_id: z.string().min(1, 'memory_id는 필수입니다'),
  relation_type: z.enum(['CAUSES', 'DEPENDS_ON', 'FOLLOWS', 'CONTRASTS_WITH', 'REFERENCES', 'BELONGS_TO', 'VERSION_OF']).optional(),
  category: z.enum(['Causal', 'Temporal', 'Structural', 'Semantic']).optional(),
  direction: z.enum(['incoming', 'outgoing', 'both']).optional().default('both')
});

export class GetRelationsTool extends BaseTool {
  constructor() {
    super(
      'get_relations',
      '특정 메모리의 관계를 조회합니다',
      {
        type: 'object',
        properties: {
          memory_id: {
            type: 'string',
            description: '관계를 조회할 메모리 ID'
          },
          relation_type: {
            type: 'string',
            enum: ['CAUSES', 'DEPENDS_ON', 'FOLLOWS', 'CONTRASTS_WITH', 'REFERENCES', 'BELONGS_TO', 'VERSION_OF'],
            description: '관계 유형 필터 (선택)'
          },
          category: {
            type: 'string',
            enum: ['Causal', 'Temporal', 'Structural', 'Semantic'],
            description: '관계 카테고리 필터 (선택)'
          },
          direction: {
            type: 'string',
            enum: ['incoming', 'outgoing', 'both'],
            description: '관계 방향 (기본값: both)',
            default: 'both'
          }
        },
        required: ['memory_id']
      }
    );
  }

  /**
   * Given: memory_id와 필터 옵션
   * When: 관계 조회 수행
   * Then: 조회된 관계 목록 반환
   */
  async handle(params: z.infer<typeof GetRelationsSchema>, context: ToolContext): Promise<ToolResult> {
    const { memory_id, relation_type, category, direction } = GetRelationsSchema.parse(params);
    const db = context.db;

    try {
      // Given: 메모리 존재 확인
      const memory = DatabaseUtils.get(db, `
        SELECT id FROM memory_item WHERE id = ?
      `, [memory_id]) as { id: string } | undefined;

      if (!memory) {
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

      // RelationGraph 인스턴스 생성 (context에 없으면 새로 생성)
      const relationGraph = context.services.relationGraph || createRelationGraph(db);

      // When: 관계 조회 수행
      const options: GetRelationsOptions = {
        direction: direction || 'both',
        minConfidence: 0.0 // 모든 신뢰도 포함
      };

      // relation_type 필터 적용
      if (relation_type) {
        options.relationTypes = [relation_type];
      }

      // category 필터 적용
      if (category) {
        // category를 relation_type 배열로 변환 (RELATION_TYPE_CATEGORY_MAP의 역방향 매핑)
        const categoryToTypes: RelationType[] = [];
        for (const [relationType, relationCategory] of Object.entries(RELATION_TYPE_CATEGORY_MAP)) {
          if (relationCategory === category) {
            categoryToTypes.push(relationType as RelationType);
          }
        }
        
        if (categoryToTypes.length > 0) {
          if (options.relationTypes && options.relationTypes.length > 0) {
            // relation_type과 category 모두 지정된 경우 교집합
            options.relationTypes = options.relationTypes.filter((type: RelationType) =>
              categoryToTypes.includes(type)
            );
            // 교집합이 비어있으면 빈 배열로 설정하여 결과 없음을 명시
          } else {
            options.relationTypes = categoryToTypes;
          }
        } else {
          // category에 해당하는 relation_type이 없으면 빈 배열로 설정
          options.relationTypes = [];
        }
      }

      // relationTypes가 빈 배열이면 조회하지 않고 빈 결과 반환
      if (options.relationTypes && options.relationTypes.length === 0) {
        return this.createSuccessResult({
          memory_id,
          relation_count: 0,
          relations: [],
          filters: {
            relation_type: relation_type || null,
            category: category || null,
            direction: direction || 'both'
          },
          message: '0개의 관계를 찾았습니다'
        });
      }

      const relations = await relationGraph.getRelations(memory_id, options);

      // Then: 결과 반환
      return this.createSuccessResult({
        memory_id,
        relation_count: relations.length,
        relations: relations.map((r: MemoryRelation) => ({
          relation_id: r.id,
          source_id: r.source_id,
          target_id: r.target_id,
          relation_type: r.relation_type,
          confidence: r.confidence,
          metadata: r.metadata,
          created_at: r.created_at
        })),
        filters: {
          relation_type: relation_type || null,
          category: category || null,
          direction: direction || 'both'
        },
        message: `${relations.length}개의 관계를 찾았습니다`
      });

    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: 'QUERY_FAILED',
            message: error instanceof Error ? error.message : String(error)
          }, null, 2)
        }]
      };
    }
  }
}
