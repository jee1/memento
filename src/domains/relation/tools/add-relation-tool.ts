/**
 * Add Relation Tool - 관계 추가 도구
 * 수동으로 메모리 간의 관계를 추가합니다.
 */

import { z } from 'zod';
import { BaseTool } from '../../../tools/base-tool.js';
import type { ToolContext, ToolResult } from '../../../tools/types.js';
import { DatabaseUtils } from '../../../../shared/utils/database.js';
import { RelationGraph } from '../domains/relation/services/relation-graph.js';
import type { RelationType } from '../../../../shared/types/relation.js';

const AddRelationSchema = z.object({
  source_id: z.string().min(1, 'source_id는 필수입니다'),
  target_id: z.string().min(1, 'target_id는 필수입니다'),
  relation_type: z.enum(['CAUSES', 'DEPENDS_ON', 'FOLLOWS', 'CONTRASTS_WITH', 'REFERENCES', 'BELONGS_TO']),
  confidence: z.number().min(0).max(1).optional().default(0.7).describe('신뢰도 (0.0~1.0, 기본값: 0.7)')
});

export class AddRelationTool extends BaseTool {
  constructor() {
    super(
      'add_relation',
      '수동으로 메모리 간의 관계를 추가합니다',
      {
        type: 'object',
        properties: {
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
          },
          confidence: {
            type: 'number',
            minimum: 0,
            maximum: 1,
            description: '신뢰도 (0.0~1.0, 기본값: 0.7)',
            default: 0.7
          }
        },
        required: ['source_id', 'target_id', 'relation_type']
      }
    );
  }

  /**
   * Given: source_id, target_id, relation_type, confidence
   * When: 관계 추가 수행
   * Then: 추가된 관계 ID 반환
   */
  async handle(params: z.infer<typeof AddRelationSchema>, context: ToolContext): Promise<ToolResult> {
    const { source_id, target_id, relation_type, confidence } = AddRelationSchema.parse(params);
    const db = context.db;

    try {
      // Given: 소스 및 타겟 메모리 존재 확인
      const sourceMemory = DatabaseUtils.get(db, `
        SELECT id FROM memory_item WHERE id = ?
      `, [source_id]) as { id: string } | undefined;

      if (!sourceMemory) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: 'SOURCE_MEMORY_NOT_FOUND',
              message: `소스 메모리를 찾을 수 없습니다: ${source_id}`
            }, null, 2)
          }]
        };
      }

      const targetMemory = DatabaseUtils.get(db, `
        SELECT id FROM memory_item WHERE id = ?
      `, [target_id]) as { id: string } | undefined;

      if (!targetMemory) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: 'TARGET_MEMORY_NOT_FOUND',
              message: `타겟 메모리를 찾을 수 없습니다: ${target_id}`
            }, null, 2)
          }]
        };
      }

      // 소스와 타겟이 같으면 에러
      if (source_id === target_id) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: 'INVALID_RELATION',
              message: '소스 메모리와 타겟 메모리는 같을 수 없습니다'
            }, null, 2)
          }]
        };
      }

      // RelationGraph 인스턴스 생성 (context에 없으면 새로 생성)
      const relationGraph = context.services.relationGraph || new RelationGraph(db);

      // When: 관계 추가 수행
      try {
        const relationId = await relationGraph.addRelation(
          source_id,
          target_id,
          relation_type,
          { 
            confidence: confidence || 0.7,
            metadata: {
              method: 'manual',
              extracted_at: new Date().toISOString()
            }
          }
        );

        // Then: 결과 반환
        return this.createSuccessResult({
          relation_id: relationId,
          source_id,
          target_id,
          relation_type,
          confidence: confidence || 0.7,
          message: `관계가 추가되었습니다: ${source_id} --[${relation_type}]--> ${target_id}`
        });

      } catch (error) {
        // 중복 관계나 순환 관계 에러 처리
        if (error instanceof Error) {
          if (error.message.includes('이미 존재하는 관계')) {
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  success: false,
                  error: 'DUPLICATE_RELATION',
                  message: error.message
                }, null, 2)
              }]
            };
          }
          if (error.message.includes('순환 참조')) {
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  success: false,
                  error: 'CYCLIC_RELATION',
                  message: error.message
                }, null, 2)
              }]
            };
          }
        }
        throw error;
      }

    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: 'ADD_RELATION_FAILED',
            message: error instanceof Error ? error.message : String(error)
          }, null, 2)
        }]
      };
    }
  }
}
