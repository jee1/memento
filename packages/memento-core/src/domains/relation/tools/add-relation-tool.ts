/**
 * Add Relation Tool - 관계 추가 도구
 * 수동으로 메모리 간의 관계를 추가합니다.
 */

import { z } from 'zod';
import { CyclicRelationError, DuplicateRelationError } from '../services/relation-errors.js';
import { DatabaseUtils } from '../../../shared/utils/database.js';
import { formatMementoResourceUri, memoryItemResourceKind } from '../../../shared/utils/memento-resource-uri.js';
import { BaseTool } from '../../../tools/base-tool.js';
import { callerOwnerClause } from '../../../tools/caller-scope.js';
import type { ToolContext,ToolResult } from '../../../tools/types.js';
import { relationToolError } from './relation-tool-response.js';

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
      const ownerScope = callerOwnerClause(context);
      const sourceMemory = DatabaseUtils.get(db, `
        SELECT id, type${ownerIdColumn} FROM memory_item WHERE id = ?${ownerScope.sql}
      `, [source_id, ...ownerScope.params]) as RelationMemoryRow | undefined;

      if (!sourceMemory) {
        return relationToolError('SOURCE_MEMORY_NOT_FOUND', `소스 메모리를 찾을 수 없습니다: ${source_id}`);
      }

      const targetMemory = DatabaseUtils.get(db, `
        SELECT id, type${ownerIdColumn} FROM memory_item WHERE id = ?${ownerScope.sql}
      `, [target_id, ...ownerScope.params]) as RelationMemoryRow | undefined;

      if (!targetMemory) {
        return relationToolError('TARGET_MEMORY_NOT_FOUND', `타겟 메모리를 찾을 수 없습니다: ${target_id}`);
      }

      // 소스와 타겟이 같으면 에러
      if (source_id === target_id) {
        return relationToolError('INVALID_RELATION', '소스 메모리와 타겟 메모리는 같을 수 없습니다');
      }

      const relationGraph = context.services.relationGraph;
      if (!relationGraph) {
        return relationToolError('RELATION_GRAPH_UNAVAILABLE', '관계 그래프 서비스가 구성되지 않았습니다');
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
          return relationToolError('DUPLICATE_RELATION', error.message);
        }
        if (error instanceof CyclicRelationError) {
          return relationToolError('CYCLIC_RELATION', error.message);
        }
        throw error;
      }

    } catch (error) {
      return relationToolError('ADD_RELATION_FAILED', error instanceof Error ? error.message : String(error));
    }
  }
}
