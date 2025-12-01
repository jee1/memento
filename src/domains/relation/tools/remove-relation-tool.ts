/**
 * Remove Relation Tool - 관계 삭제 도구
 * 메모리 간의 관계를 삭제합니다.
 * relation_id 또는 source_id/target_id/relation_type 조합으로 삭제 가능합니다.
 */

import { z } from 'zod';
import { BaseTool } from '../../../tools/base-tool.js';
import type { ToolContext, ToolResult } from '../../../tools/types.js';
import { DatabaseUtils } from '../../../shared/utils/database.js';
import { RelationGraph } from '../services/relation-graph.js';
import type { RelationType } from '../../../shared/types/relation.js';

const RemoveRelationSchema = z.object({
  relation_id: z.number().int().positive().optional().describe('관계 ID (relation_id 또는 source_id/target_id/relation_type 조합 중 하나는 필수)'),
  source_id: z.string().min(1).optional().describe('소스 메모리 ID'),
  target_id: z.string().min(1).optional().describe('타겟 메모리 ID'),
  relation_type: z.enum(['CAUSES', 'DEPENDS_ON', 'FOLLOWS', 'CONTRASTS_WITH', 'REFERENCES', 'BELONGS_TO']).optional().describe('관계 유형')
}).refine(
  (data) => {
    // relation_id가 있거나, source_id/target_id/relation_type이 모두 있어야 함
    if (data.relation_id) {
      return true;
    }
    return !!(data.source_id && data.target_id && data.relation_type);
  },
  {
    message: 'relation_id 또는 source_id/target_id/relation_type 조합 중 하나는 필수입니다'
  }
);

export class RemoveRelationTool extends BaseTool {
  constructor() {
    super(
      'remove_relation',
      '메모리 간의 관계를 삭제합니다. relation_id 또는 source_id/target_id/relation_type 조합으로 삭제 가능합니다.',
      {
        type: 'object',
        properties: {
          relation_id: {
            type: 'number',
            description: '관계 ID (relation_id 또는 source_id/target_id/relation_type 조합 중 하나는 필수)'
          },
          source_id: {
            type: 'string',
            description: '소스 메모리 ID'
          },
          target_id: {
            type: 'string',
            description: '타겟 메모리 ID'
          },
          relation_type: {
            type: 'string',
            enum: ['CAUSES', 'DEPENDS_ON', 'FOLLOWS', 'CONTRASTS_WITH', 'REFERENCES', 'BELONGS_TO'],
            description: '관계 유형'
          }
        }
      }
    );
  }

  /**
   * Given: relation_id 또는 source_id/target_id/relation_type
   * When: 관계 삭제 수행
   * Then: 삭제 성공 여부 반환
   */
  async handle(params: z.infer<typeof RemoveRelationSchema>, context: ToolContext): Promise<ToolResult> {
    const parsed = RemoveRelationSchema.parse(params);
    const db = context.db;

    try {
      // RelationGraph 인스턴스 생성 (context에 없으면 새로 생성)
      const relationGraph = context.services.relationGraph || new RelationGraph(db);

      let deleted = false;
      let relationInfo: { source_id: string; target_id: string; relation_type: RelationType } | null = null;

      // Given: relation_id로 삭제
      if (parsed.relation_id) {
        // 관계 정보 조회
        const relation = DatabaseUtils.get(db, `
          SELECT source_id, target_id, relation_type
          FROM memory_relation
          WHERE id = ?
        `, [parsed.relation_id]) as { source_id: string; target_id: string; relation_type: RelationType } | undefined;

        if (!relation) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: false,
                error: 'RELATION_NOT_FOUND',
                message: `관계를 찾을 수 없습니다: relation_id=${parsed.relation_id}`
              }, null, 2)
            }]
          };
        }

        relationInfo = relation;

        // When: removeRelation 메서드 사용 (캐시 무효화 포함)
        deleted = await relationGraph.removeRelation(
          relation.source_id,
          relation.target_id,
          relation.relation_type
        );

      } else {
        // Given: source_id/target_id/relation_type 조합으로 삭제
        const { source_id, target_id, relation_type } = parsed;

        if (!source_id || !target_id || !relation_type) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: false,
                error: 'INVALID_PARAMS',
                message: 'source_id, target_id, relation_type이 모두 필요합니다'
              }, null, 2)
            }]
          };
        }

        relationInfo = { source_id, target_id, relation_type };

        // When: removeRelation 메서드 사용
        deleted = await relationGraph.removeRelation(source_id, target_id, relation_type);
      }

      // Then: 결과 반환
      if (deleted && relationInfo) {
        return this.createSuccessResult({
          deleted: true,
          ...relationInfo,
          message: `관계가 삭제되었습니다: ${relationInfo.source_id} --[${relationInfo.relation_type}]--> ${relationInfo.target_id}`
        });
      } else {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: 'RELATION_NOT_FOUND',
              message: relationInfo
                ? `관계를 찾을 수 없습니다: ${relationInfo.source_id} --[${relationInfo.relation_type}]--> ${relationInfo.target_id}`
                : '관계를 찾을 수 없습니다'
            }, null, 2)
          }]
        };
      }

    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: 'REMOVE_RELATION_FAILED',
            message: error instanceof Error ? error.message : String(error)
          }, null, 2)
        }]
      };
    }
  }
}
