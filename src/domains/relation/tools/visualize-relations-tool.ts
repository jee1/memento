/**
 * Visualize Relations Tool - 관계 그래프 시각화 도구
 * 메모리 간의 관계를 시각화합니다.
 */

import { z } from 'zod';
import { BaseTool } from '../../../tools/base-tool.js';
import type { ToolContext, ToolResult } from '../../../tools/types.js';
import { DatabaseUtils } from '../../../../shared/utils/database.js';
import { RelationGraph } from '../domains/relation/services/relation-graph.js';
import { RelationVisualizer, type VisualizationOptions } from '../../../../shared/utils/relation-visualizer.js';

const VisualizeRelationsSchema = z.object({
  memory_id: z.string().min(1, 'memory_id는 필수입니다'),
  max_depth: z.number().int().min(1).max(5).optional().default(2).describe('최대 깊이 (1~5, 기본값: 2)'),
  format: z.enum(['text', 'subgraph', 'simple', 'json']).optional().default('subgraph').describe('시각화 형식 (text, subgraph, simple, json, 기본값: subgraph)'),
  min_confidence: z.number().min(0).max(1).optional().describe('최소 신뢰도 (0.0~1.0)'),
  relation_types: z.array(z.enum(['CAUSES', 'DEPENDS_ON', 'FOLLOWS', 'CONTRASTS_WITH', 'REFERENCES', 'BELONGS_TO'])).optional().describe('관계 유형 필터'),
  show_memory_ids: z.boolean().optional().default(true).describe('메모리 ID 표시 여부 (기본값: true)'),
  show_confidence: z.boolean().optional().default(true).describe('신뢰도 표시 여부 (기본값: true)'),
  show_relation_types: z.boolean().optional().default(true).describe('관계 유형 표시 여부 (기본값: true)')
});

export class VisualizeRelationsTool extends BaseTool {
  constructor() {
    super(
      'visualize_relations',
      '메모리 간의 관계를 시각화합니다. text, subgraph, simple, json 형식을 지원합니다.',
      {
        type: 'object',
        properties: {
          memory_id: {
            type: 'string',
            description: '중심 메모리 ID'
          },
          max_depth: {
            type: 'number',
            minimum: 1,
            maximum: 5,
            description: '최대 깊이 (1~5, 기본값: 2)',
            default: 2
          },
          format: {
            type: 'string',
            enum: ['text', 'subgraph', 'simple', 'json'],
            description: '시각화 형식 (text, subgraph, simple, json, 기본값: subgraph)',
            default: 'subgraph'
          },
          min_confidence: {
            type: 'number',
            minimum: 0,
            maximum: 1,
            description: '최소 신뢰도 (0.0~1.0)'
          },
          relation_types: {
            type: 'array',
            items: {
              type: 'string',
              enum: ['CAUSES', 'DEPENDS_ON', 'FOLLOWS', 'CONTRASTS_WITH', 'REFERENCES', 'BELONGS_TO']
            },
            description: '관계 유형 필터'
          },
          show_memory_ids: {
            type: 'boolean',
            description: '메모리 ID 표시 여부 (기본값: true)',
            default: true
          },
          show_confidence: {
            type: 'boolean',
            description: '신뢰도 표시 여부 (기본값: true)',
            default: true
          },
          show_relation_types: {
            type: 'boolean',
            description: '관계 유형 표시 여부 (기본값: true)',
            default: true
          }
        },
        required: ['memory_id']
      }
    );
  }

  /**
   * Given: memory_id, max_depth, format, 옵션들
   * When: 관계 그래프 시각화 수행
   * Then: 시각화된 텍스트 반환
   */
  async handle(params: z.infer<typeof VisualizeRelationsSchema>, context: ToolContext): Promise<ToolResult> {
    const parsed = VisualizeRelationsSchema.parse(params);
    const db = context.db;

    try {
      // Given: 메모리 존재 확인
      const memory = DatabaseUtils.get(db, `
        SELECT id FROM memory_item WHERE id = ?
      `, [parsed.memory_id]) as { id: string } | undefined;

      if (!memory) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: 'MEMORY_NOT_FOUND',
              message: `메모리를 찾을 수 없습니다: ${parsed.memory_id}`
            }, null, 2)
          }]
        };
      }

      // RelationGraph 인스턴스 생성 (context에 없으면 새로 생성)
      const relationGraph = context.services.relationGraph || new RelationGraph(db);

      // When: 관계 조회
      const relations = await relationGraph.getRelations(parsed.memory_id, {
        direction: 'both',
        relationTypes: parsed.relation_types,
        minConfidence: parsed.min_confidence
      });

      // 시각화 옵션 준비
      const visualizationOptions: VisualizationOptions = {
        maxDepth: parsed.max_depth,
        minConfidence: parsed.min_confidence,
        relationTypes: parsed.relation_types,
        showMemoryIds: parsed.show_memory_ids,
        showConfidence: parsed.show_confidence,
        showRelationTypes: parsed.show_relation_types
      };

      let visualization: string;

      // Then: 형식에 따라 시각화
      switch (parsed.format) {
        case 'text':
          visualization = RelationVisualizer.visualizeAsText(relations, visualizationOptions);
          break;

        case 'subgraph':
          visualization = RelationVisualizer.visualizeSubgraph(
            parsed.memory_id,
            relations,
            visualizationOptions
          );
          break;

        case 'simple':
          visualization = RelationVisualizer.visualizeSimple(relations);
          break;

        case 'json':
          visualization = RelationVisualizer.visualizeAsJSON(relations, true);
          break;

        default:
          // 기본값: subgraph
          visualization = RelationVisualizer.visualizeSubgraph(
            parsed.memory_id,
            relations,
            visualizationOptions
          );
      }

      return this.createSuccessResult({
        memory_id: parsed.memory_id,
        format: parsed.format,
        relation_count: relations.length,
        visualization
      });

    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: 'VISUALIZATION_FAILED',
            message: error instanceof Error ? error.message : String(error)
          }, null, 2)
        }]
      };
    }
  }
}
