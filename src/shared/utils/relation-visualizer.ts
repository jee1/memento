/**
 * 관계 그래프 시각화 유틸리티
 * 텍스트 기반으로 관계 그래프를 시각화합니다.
 */

import type { MemoryRelation } from '../shared/types/relation-graph.js';
import type { RelationType } from '../shared/types/relation.js';

/**
 * 관계 그래프 시각화 옵션
 */
export interface VisualizationOptions {
  /**
   * 최대 깊이 (기본값: 2)
   */
  maxDepth?: number;

  /**
   * 최소 신뢰도 (기본값: 0.0)
   */
  minConfidence?: number;

  /**
   * 관계 유형 필터
   */
  relationTypes?: RelationType[];

  /**
   * 메모리 ID 표시 여부 (기본값: true)
   */
  showMemoryIds?: boolean;

  /**
   * 신뢰도 표시 여부 (기본값: true)
   */
  showConfidence?: boolean;

  /**
   * 관계 유형 표시 여부 (기본값: true)
   */
  showRelationTypes?: boolean;

  /**
   * 들여쓰기 문자 (기본값: '  ')
   */
  indent?: string;

  /**
   * 화살표 문자 (기본값: '-->')
   */
  arrow?: string;
}

/**
 * 관계 그래프 시각화 유틸리티 클래스
 */
export class RelationVisualizer {
  /**
   * 관계 목록을 텍스트로 시각화
   * 
   * @param relations 관계 목록
   * @param options 시각화 옵션
   * @returns 시각화된 텍스트
   */
  static visualizeAsText(
    relations: MemoryRelation[],
    options: VisualizationOptions = {}
  ): string {
    const {
      showMemoryIds = true,
      showConfidence = true,
      showRelationTypes = true,
      indent = '  ',
      arrow = '-->'
    } = options;

    if (relations.length === 0) {
      return '관계가 없습니다.';
    }

    const lines: string[] = [];
    const visited = new Set<string>();

    for (const relation of relations) {
      const key = `${relation.source_id}-${relation.target_id}-${relation.relation_type}`;
      if (visited.has(key)) {
        continue;
      }
      visited.add(key);

      const parts: string[] = [];

      // 소스 메모리 ID
      if (showMemoryIds) {
        parts.push(relation.source_id);
      }

      // 화살표 및 관계 유형
      if (showRelationTypes) {
        parts.push(`${arrow}[${relation.relation_type}]`);
      } else {
        parts.push(arrow);
      }

      // 타겟 메모리 ID
      if (showMemoryIds) {
        parts.push(relation.target_id);
      }

      // 신뢰도
      if (showConfidence) {
        parts.push(`(confidence: ${relation.confidence.toFixed(2)})`);
      }

      lines.push(indent + parts.join(' '));
    }

    return lines.join('\n');
  }

  /**
   * 서브그래프를 시각화 (특정 메모리를 중심으로)
   * 
   * @param centerMemoryId 중심 메모리 ID
   * @param relations 관계 목록
   * @param options 시각화 옵션
   * @returns 시각화된 텍스트
   */
  static visualizeSubgraph(
    centerMemoryId: string,
    relations: MemoryRelation[],
    options: VisualizationOptions = {}
  ): string {
    const {
      maxDepth = 2,
      minConfidence = 0.0,
      relationTypes,
      showMemoryIds = true,
      showConfidence = true,
      showRelationTypes = true,
      indent = '  ',
      arrow = '-->'
    } = options;

    // 필터링: 신뢰도 및 관계 유형
    let filteredRelations = relations.filter(r => r.confidence >= minConfidence);
    if (relationTypes && relationTypes.length > 0) {
      filteredRelations = filteredRelations.filter(r => relationTypes.includes(r.relation_type));
    }

    if (filteredRelations.length === 0) {
      return `중심 메모리: ${centerMemoryId}\n관계가 없습니다.`;
    }

    // 그래프 구조 생성 (BFS 방식)
    const graph = new Map<string, Array<{ target: string; relation: MemoryRelation }>>();
    const reverseGraph = new Map<string, Array<{ source: string; relation: MemoryRelation }>>();

    for (const relation of filteredRelations) {
      // Outgoing 관계
      if (!graph.has(relation.source_id)) {
        graph.set(relation.source_id, []);
      }
      graph.get(relation.source_id)!.push({
        target: relation.target_id,
        relation
      });

      // Incoming 관계
      if (!reverseGraph.has(relation.target_id)) {
        reverseGraph.set(relation.target_id, []);
      }
      reverseGraph.get(relation.target_id)!.push({
        source: relation.source_id,
        relation
      });
    }

    // BFS로 서브그래프 탐색
    const visited = new Set<string>();
    const queue: Array<{ memoryId: string; depth: number; path: string[] }> = [];
    const result: Array<{ memoryId: string; depth: number; path: string[]; relation: MemoryRelation | null }> = [];

    queue.push({ memoryId: centerMemoryId, depth: 0, path: [] });
    visited.add(centerMemoryId);

    while (queue.length > 0) {
      const current = queue.shift()!;

      if (current.depth > 0) {
        // 중심 메모리가 아닌 경우 결과에 추가
        result.push({
          memoryId: current.memoryId,
          depth: current.depth,
          path: current.path,
          relation: null // path에서 관계 정보 추출 가능
        });
      }

      if (current.depth >= maxDepth) {
        continue;
      }

      // Outgoing 관계 탐색
      const outgoing = graph.get(current.memoryId) || [];
      for (const { target, relation } of outgoing) {
        if (!visited.has(target)) {
          visited.add(target);
          queue.push({
            memoryId: target,
            depth: current.depth + 1,
            path: [...current.path, `${current.memoryId}--[${relation.relation_type}]-->${target}`]
          });
        }
      }

      // Incoming 관계 탐색
      const incoming = reverseGraph.get(current.memoryId) || [];
      for (const { source, relation } of incoming) {
        if (!visited.has(source)) {
          visited.add(source);
          queue.push({
            memoryId: source,
            depth: current.depth + 1,
            path: [...current.path, `${source}--[${relation.relation_type}]-->${current.memoryId}`]
          });
        }
      }
    }

    // 시각화 텍스트 생성
    const lines: string[] = [];
    lines.push(`중심 메모리: ${centerMemoryId}`);
    lines.push('');

    // 깊이별로 그룹화하여 출력
    const depthGroups = new Map<number, Array<{ memoryId: string; path: string[]; relation: MemoryRelation | null }>>();
    for (const item of result) {
      if (!depthGroups.has(item.depth)) {
        depthGroups.set(item.depth, []);
      }
      depthGroups.get(item.depth)!.push(item);
    }

    // 관계 정보 추출 및 표시
    const relationMap = new Map<string, MemoryRelation>();
    for (const relation of filteredRelations) {
      const key = `${relation.source_id}-${relation.target_id}-${relation.relation_type}`;
      relationMap.set(key, relation);
    }

    for (let depth = 1; depth <= maxDepth; depth++) {
      const items = depthGroups.get(depth) || [];
      if (items.length === 0) {
        continue;
      }

      lines.push(`[${depth}-hop 관계]`);
      for (const item of items) {
        // path에서 마지막 관계 정보 추출
        const lastPath = item.path[item.path.length - 1];
        if (lastPath) {
          const match = lastPath.match(/^(.+?)--\[(.+?)\]-->(.+?)$/);
          if (match && match[1] && match[2] && match[3]) {
            const [, source, relationType, target] = match;
            const key = `${source}-${target}-${relationType}`;
            const relation = relationMap.get(key);

            const parts: string[] = [];
            parts.push(indent.repeat(depth));

            if (showMemoryIds) {
              parts.push(source);
            }

            if (showRelationTypes) {
              parts.push(`${arrow}[${relationType}]`);
            } else {
              parts.push(arrow);
            }

            if (showMemoryIds) {
              parts.push(target);
            }

            if (showConfidence && relation) {
              parts.push(`(confidence: ${relation.confidence.toFixed(2)})`);
            }

            lines.push(parts.join(' '));
          } else {
            // path 파싱 실패 시 간단히 표시
            lines.push(indent.repeat(depth) + item.memoryId);
          }
        }
      }
      lines.push('');
    }

    if (result.length === 0) {
      lines.push('관계가 없습니다.');
    }

    return lines.join('\n');
  }

  /**
   * 관계 목록을 간단한 텍스트 형식으로 시각화
   * 
   * @param relations 관계 목록
   * @returns 시각화된 텍스트
   */
  static visualizeSimple(relations: MemoryRelation[]): string {
    if (relations.length === 0) {
      return '관계가 없습니다.';
    }

    const lines: string[] = [];
    for (const relation of relations) {
      lines.push(
        `${relation.source_id} --[${relation.relation_type}]--> ${relation.target_id} (confidence: ${relation.confidence.toFixed(2)})`
      );
    }

    return lines.join('\n');
  }

  /**
   * 관계 목록을 JSON 형식으로 시각화
   * 
   * @param relations 관계 목록
   * @param pretty JSON 포맷팅 여부 (기본값: true)
   * @returns JSON 문자열
   */
  static visualizeAsJSON(relations: MemoryRelation[], pretty: boolean = true): string {
    const data = relations.map(r => ({
      id: r.id,
      source_id: r.source_id,
      target_id: r.target_id,
      relation_type: r.relation_type,
      confidence: r.confidence,
      created_at: r.created_at.toISOString(),
      updated_at: r.updated_at.toISOString(),
      metadata: r.metadata
    }));

    return pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data);
  }
}
