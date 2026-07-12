/**
 * Add Relation Tool - 관계 추가 도구
 * 수동으로 메모리 간의 관계를 추가합니다.
 */

import { z } from 'zod';
import { CyclicRelationError, DuplicateRelationError } from '../services/relation-errors.js';
import { DatabaseUtils } from '../../../shared/utils/database.js';
import { formatMementoResourceUri, memoryItemResourceKind } from '../../../shared/utils/memento-resource-uri.js';
import { BaseTool } from '../../../tools/base-tool.js';
import type { ToolContext,ToolResult } from '../../../tools/types.js';
import { EventOutboxService } from '../../telemetry/services/event-outbox-service.js';

type RelationMemoryRow = { id: string; owner_id?: string | null; type: string };

function memoryItemHasOwnerIdColumn(db: NonNullable<ToolContext['db']>): boolean {
  const columns = DatabaseUtils.all(db, 'PRAGMA table_info(memory_item)') as Array<{ name: string }>;
  return columns.some((column) => column.name === 'owner_id');
}

const AddRelationSchema = z.object({
  source_id: z.string().min(1, 'source_id는 필수입니다'),
  target_id: z.string().min(1, 'target_id는 필수입니다'),
  relation_type: z.enum(['CAUSES', 'DEPENDS_ON', 'FOLLOWS', 'CONTRASTS_WITH', 'REFERENCES', 'BELONGS_TO', 'VERSION_OF']),
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
            enum: ['CAUSES', 'DEPENDS_ON', 'FOLLOWS', 'CONTRASTS_WITH', 'REFERENCES', 'BELONGS_TO', 'VERSION_OF'],
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
      const ownerIdColumn = memoryItemHasOwnerIdColumn(db) ? ', owner_id' : '';
      const sourceMemory = DatabaseUtils.get(db, `
        SELECT id, type${ownerIdColumn} FROM memory_item WHERE id = ?
      `, [source_id]) as RelationMemoryRow | undefined;

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
        SELECT id, type${ownerIdColumn} FROM memory_item WHERE id = ?
      `, [target_id]) as RelationMemoryRow | undefined;

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

      const relationGraph = context.services.relationGraph;
      if (!relationGraph) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: 'RELATION_GRAPH_UNAVAILABLE',
              message: '관계 그래프 서비스가 구성되지 않았습니다'
            }, null, 2)
          }]
        };
      }

      // When: 관계 추가 수행
      try {
        const relationId = await relationGraph.addRelation(
          source_id,
          target_id,
          relation_type,
          { 
            confidence: confidence || 0.7,
            metadata: {
              method: 'manual' as 'rule' | 'llm', // 'manual'은 타입 정의에 없지만 런타임에서는 허용됨
              extracted_at: new Date().toISOString()
            }
          }
        );

        const relationUri = formatMementoResourceUri({ ownerId: sourceMemory.owner_id ?? null, kind: 'relation', id: relationId });
        try {
          new EventOutboxService(db).enqueue({
            eventType: 'relation.added',
            targetUri: relationUri,
            ownerId: sourceMemory.owner_id ?? null,
            payload: { source_id, target_id, relation_type, confidence: confidence || 0.7 },
            idempotencyKey: `relation.added:${relationUri}`,
          });
        } catch (error) {
          this.logWarning('Outbox event enqueue failed after relation add', {
            error: error instanceof Error ? error.message : String(error), relation_id: relationId,
          });
        }

        // Then: 결과 반환
        return this.createSuccessResult({
          relation_id: relationId,
          uri: relationUri,
          source_id,
          source_uri: formatMementoResourceUri({
            ownerId: sourceMemory.owner_id ?? null,
            kind: memoryItemResourceKind(sourceMemory.type),
            id: source_id,
          }),
          target_id,
          target_uri: formatMementoResourceUri({
            ownerId: targetMemory.owner_id ?? null,
            kind: memoryItemResourceKind(targetMemory.type),
            id: target_id,
          }),
          relation_type,
          confidence: confidence || 0.7,
          message: `관계가 추가되었습니다: ${source_id} --[${relation_type}]--> ${target_id}`
        });

      } catch (error) {
        if (error instanceof DuplicateRelationError) {
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
        if (error instanceof CyclicRelationError) {
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
