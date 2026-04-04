# Data Model: 기억 관계 그래프 뷰

**Feature**: 009-memory-graph-view  
**Date**: 2026-04-02

## 기존 DB 테이블 (읽기 전용, 변경 없음)

### memory_item (노드 소스)

| 컬럼 | 타입 | 용도 |
|------|------|------|
| id | TEXT PK | 기억 고유 ID (노드 id) |
| content | TEXT | 기억 내용 (label 생성 원본) |
| type | TEXT | episodic / semantic / procedural / working |
| importance | REAL | 0.0~1.0 (노드 크기 결정) |
| created_at | TEXT | ISO8601 (상세 패널 표시용) |
| tags | TEXT | JSON array (상세 패널 표시용) |
| pinned | INTEGER | 1/0 (상세 패널 표시용) |

### memory_relation (엣지 소스)

| 컬럼 | 타입 | 용도 |
|------|------|------|
| id | INTEGER PK | 관계 고유 ID |
| source_id | TEXT FK→memory_item.id | 엣지 시작점 |
| target_id | TEXT FK→memory_item.id | 엣지 끝점 |
| relation_type | TEXT | 엣지 색상 결정 |
| confidence | REAL | 0.0~1.0 (엣지 굵기/투명도) |

### kg_triple (보조 엣지 소스)

| 컬럼 | 타입 | 용도 |
|------|------|------|
| id | TEXT PK | 트리플 고유 ID |
| subject | TEXT | 주어 엔티티 |
| predicate | TEXT | 관계 술어 |
| object | TEXT | 목적어 엔티티 |
| representative_memory_id | TEXT FK→memory_item.id | 연결된 기억 ID |

## API 응답 타입 (새로 정의)

```typescript
// GET /admin/graph 응답 타입
export interface GraphNode {
  id: string;           // memory_item.id
  label: string;        // content 앞 50자 truncate (그래프 노드 레이블용)
  content: string;      // memory_item.content 전체 (상세 패널 표시용)
  type: 'episodic' | 'semantic' | 'procedural' | 'working';
  importance: number;   // 0.0~1.0
  created_at: string;   // ISO8601
  tags: string[];       // 파싱된 태그 배열
  pinned: boolean;
}

export interface GraphEdge {
  id: string;           // `rel_${memory_relation.id}` 또는 `kg_${kg_triple.id}`
  source: string;       // memory_item.id
  target: string;       // memory_item.id
  relation_type: string; // relation_type 또는 kg_triple.predicate
  confidence: number;    // memory_relation.confidence (kg_triple은 기본 1.0)
  edge_source: 'memory_relation' | 'kg_triple'; // 출처 구분
}

export interface GraphResponse {
  nodes: GraphNode[];
  edges: GraphEdge[];
  meta: {
    total_nodes: number;
    total_edges: number;
    applied_filters: GraphFilter;
    truncated: boolean;  // limit 초과로 잘렸으면 true
  };
}

// 쿼리 파라미터 타입
export interface GraphFilter {
  types?: ('episodic' | 'semantic' | 'procedural' | 'working')[];
  relation_types?: string[];
  min_importance?: number;  // 0.0~1.0, 기본 0.0
  limit?: number;           // 기본 500, 최대 1000
}
```

## 변환 로직

```
memory_item rows → GraphNode[]
  - label: content.slice(0, 50) + (content.length > 50 ? '...' : '')
  - content: content (전체, 상세 패널용)
  - tags: JSON.parse(tags ?? '[]')
  - importance: importance ?? 0.5

memory_relation rows → GraphEdge[]
  - id: `rel_${id}`
  - edge_source: 'memory_relation'
  - confidence: confidence

kg_triple rows (representative_memory_id가 있는 경우만) → GraphEdge[]
  - 두 트리플이 동일 memory_id를 가리킬 때 노드 연결은 불명확 → memory_relation과 중복 방지
  - kg_triple은 subject/object가 텍스트 엔티티 → memory_item id와 매핑 불가
  - **결론**: kg_triple은 노드 레이블 보강에만 사용 (이번 구현 scope에서 엣지 소스로는 제외)
  - spec의 FR-012(양쪽 데이터 소스 시각화)는 향후 확장 포인트로 명시
```

## 필터링 적용 순서

1. `types` 필터로 `memory_item.type` 필터링
2. `min_importance` 필터로 `memory_item.importance >= min_importance` 필터링  
3. 노드 집합 확정 후, 해당 노드들만 참조하는 엣지 필터링
4. `importance` DESC 정렬 후 `limit` 적용 (truncated = total_nodes > limit)
