# 0007-prd-semantic-relation-engine.md

## Introduction/Overview

기억 간의 **의미적 관계(Semantic Relations)**를 추론하고 관리하는 엔진입니다.

현재 Memento는 벡터 유사도를 기반으로 "비슷한 기억"을 찾을 수 있지만, **"왜" 두 기억이 연결되는지**, **"무엇이" 영향을 주었는지**, **"어떤 순서로" 발생했는지**는 알 수 없습니다. 관계 추론 엔진은 이 한계를 극복하고, 기억 간의 의미적 연결을 파악하여 더 깊은 맥락 이해와 인과적 추론을 가능하게 합니다.

이 기능은 Memento의 기억 구조를 단순한 벡터 집합이 아니라, **"서로 연결된 지식 그래프(Relational Memory Graph)"** 형태로 확장합니다. 관계 추론 엔진은 기억들 사이의 **인과(Causal)**, **의존(Dependency)**, **시간(Temporal)**, **맥락(Contextual)** 관계를 식별하여 앵커 시스템, 맥락 재생, 인사이트 제안, 메타-기억이 모두 활용할 수 있는 **연결 조직망(connectome)**을 제공합니다.

**핵심 문제**: 벡터 유사도 기반 검색은 의미적으로 유사한 기억을 찾을 수 있지만, 기억 간의 구조적 관계(원인-결과, 의존성, 시간적 순서 등)를 이해하지 못합니다. 이로 인해 맥락 기반 탐색, 인과적 추론, 실패 패턴 분석 등 고급 기능이 제한됩니다.

**목표**: 기억 간의 의미적 관계를 자동으로 추출하고, 관계 그래프를 구축하여 앵커 시스템의 hop 탐색에 의미적 구조를 제공하고, 검색 랭킹에 관계 가중치를 반영하며, 메타-기억의 실패 원인 분석을 강화합니다.

## Goals

### Phase 1 (MVP) - 핵심 기능

1. **관계 추출 엔진 구현**: 새로운 기억 저장 시 LLM 및 규칙 기반 하이브리드 방식으로 다른 기억과의 관계 후보를 자동 생성
2. **확장 가능한 관계 유형 시스템**: 계층화된 관계 유형 구조(Causal, Temporal, Structural, Semantic) 지원 및 초기 6가지 세부 관계 유형 구현
3. **타입별 관계 유형 적용**: 기억 타입(working, episodic, semantic, procedural)별로 적합한 관계 유형을 자동 선택
4. **관계 그래프 저장 및 관리**: SQLite 기반 관계 그래프 저장소 구축 및 대규모 데이터(10,000개 이상 기억)에 대한 성능 최적화
5. **관계 기반 검색 점수 통합**: 기존 검색 랭킹 공식에 관계 가중치를 추가하여 관계가 있는 기억에 부스트 적용 (Config 기반 가중치 관리)
6. **앵커 시스템 기본 통합**: 앵커 기반 1~2-hop 탐색 시 관계 그래프를 활용한 의미적 hop 계산
7. **관계 품질 검증 시스템**: 수동 라벨링 테스트셋 기반 정확도 측정 및 CI 통합
8. **엣지 케이스 처리**: 순환 참조 감지, 대량 데이터 성능 최적화, 관계 갱신/삭제 정책 구현

### Phase 2 (확장 버전) - 고급 기능

9. **관계 강화 학습**: 주기적으로 관계 그래프를 재평가하여 신뢰도 갱신 및 자동 조정
10. **메타-기억 기본 통합**: 실패 패턴 분석 시 관계 정보를 활용하여 원인 추적 강화
11. **관계 그래프 시각화 API**: HTTP API 엔드포인트를 통한 관계 그래프 JSON 반환 (대시보드 통합용)
12. **MCP Tool 인터페이스**: `extract_relations`, `get_relations`, `add_relation`, `remove_relation`, `visualize_relations` 도구 제공
13. **앵커 시스템 완전 통합**: 3-hop 이상 확장 탐색 및 고급 관계 기반 알고리즘

## User Stories

### AI 에이전트 관점
- **US-001**: AI 에이전트로서 "정산 오류" 관련 기억을 검색할 때, 단순히 비슷한 표현이 아니라 **"원인-결과" 관계가 있는 기억**까지 탐색하고 싶다
- **US-002**: AI 에이전트로서 앵커 시스템에서 2-hop 탐색 시, "현재 오류 → 세금 계산 로직 → 배포 성공 사례"로 의미적으로 확장된 맥락을 얻고 싶다
- **US-003**: AI 에이전트로서 메타-기억이 실패 패턴을 분석할 때, "어떤 관계망에서 반복적으로 실패가 발생했는가"를 추론하여 학습하고 싶다
- **US-004**: AI 에이전트로서 시간적 순서가 중요한 작업(예: 배포 프로세스)에서 "FOLLOWS" 관계를 활용하여 단계별 맥락을 유지하고 싶다
- **US-005**: AI 에이전트로서 서로 모순되는 기억(예: "CONTRASTS_WITH")을 자동으로 감지하여 일관성 문제를 해결하고 싶다

### 개발자 관점
- **US-006**: 개발자로서 새로운 기억이 저장될 때 자동으로 관련 기억과의 관계를 추출하고 싶다
- **US-007**: 개발자로서 관계 그래프를 조회하고 시각화하여 기억 간 연결 구조를 이해하고 싶다
- **US-008**: 개발자로서 관계 추출의 정확도를 모니터링하고 신뢰도 임계값을 조정하고 싶다
- **US-009**: 개발자로서 대량의 기억(10,000개 이상)에서도 관계 추출 및 탐색이 빠르게 동작하기를 원한다

### 시스템 관리자 관점
- **US-010**: 시스템 관리자로서 관계 그래프의 성능을 모니터링하고 최적화하고 싶다
- **US-011**: 시스템 관리자로서 순환 참조나 잘못된 관계를 자동으로 감지하고 정리하고 싶다

## Functional Requirements

### 1. 데이터베이스 스키마 확장

1.1. **`memory_relation` 테이블 생성 (기존 `memory_link` 확장 또는 대체)**:
   ```sql
   CREATE TABLE IF NOT EXISTS memory_relation (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     source_id TEXT NOT NULL,
     target_id TEXT NOT NULL,
     relation_type TEXT NOT NULL, -- 확장 가능: CHECK 제약 제거, 애플리케이션 레벨 검증
     confidence REAL NOT NULL DEFAULT 0.7 CHECK (confidence >= 0.0 AND confidence <= 1.0),
     created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
     updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
     metadata TEXT, -- JSON: 추출 방법(rule/llm), 추출 시점 정보 등
     FOREIGN KEY (source_id) REFERENCES memory_item(id) ON DELETE CASCADE,
     FOREIGN KEY (target_id) REFERENCES memory_item(id) ON DELETE CASCADE,
     UNIQUE(source_id, target_id, relation_type)
   );
   ```
   - 기존 `memory_link` 테이블과의 호환성 고려: 마이그레이션 스크립트 필요
   - 관계 유형은 확장 가능하도록 CHECK 제약 제거, 애플리케이션 레벨에서 검증
   - 신뢰도(confidence) 필드 추가: 기본값 0.7, 0.0~1.0 범위
   - 메타데이터 필드: 추출 방법(rule/llm), 추출 시점, 관계 강화 학습 이력 등

1.2. **인덱스 생성**:
   ```sql
   CREATE INDEX idx_memory_relation_source ON memory_relation(source_id);
   CREATE INDEX idx_memory_relation_target ON memory_relation(target_id);
   CREATE INDEX idx_memory_relation_type ON memory_relation(relation_type);
   CREATE INDEX idx_memory_relation_confidence ON memory_relation(confidence);
   CREATE INDEX idx_memory_relation_source_type ON memory_relation(source_id, relation_type);
   CREATE INDEX idx_memory_relation_target_type ON memory_relation(target_id, relation_type);
   ```

1.3. **관계 유형 레지스트리 테이블 (계층 구조 지원)**:
   ```sql
   CREATE TABLE IF NOT EXISTS relation_type_registry (
     type_name TEXT PRIMARY KEY,
     category TEXT NOT NULL, -- 'Causal', 'Temporal', 'Structural', 'Semantic'
     description TEXT,
     applicable_types TEXT, -- JSON 배열: ['episodic', 'semantic'] 등
     default_confidence REAL DEFAULT 0.7,
     search_boost REAL DEFAULT 1.0, -- 검색 랭킹 가중치
     created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
   );
   ```
   - **계층 구조 관계 유형 등록**:
     - **Causal (인과 관계군)**:
       - `CAUSES`: 인과 관계 (episodic, semantic) - boost: 1.2
       - 향후 확장: `PREVENTS`, `ENABLES` 등
     - **Temporal (시간 관계군)**:
       - `FOLLOWS`: 시간적 순서 (episodic, procedural) - boost: 1.0
       - 향후 확장: `PRECEDES`, `OCCURS_WITH` 등
     - **Structural (구조 관계군)**:
       - `DEPENDS_ON`: 의존 관계 (semantic, procedural) - boost: 1.1
       - `BELONGS_TO`: 포함 관계 (semantic, episodic) - boost: 1.0
       - 향후 확장: `CONTAINS`, `PART_OF` 등
     - **Semantic (의미 관계군)**:
       - `CONTRASTS_WITH`: 대조 관계 (semantic, episodic) - boost: 0.9
       - `REFERENCES`: 참조 관계 (모든 타입) - boost: 0.8
       - 향후 확장: `SIMILAR_TO`, `EQUIVALENT_TO` 등
   - **관계군 기반 검색 지원**: `category` 필드를 활용하여 "Causal 관계군 전체"로 질의 가능

### 2. 관계 추출 엔진 구현

2.1. **`RelationExtractor` 서비스 클래스 생성** (`src/services/relation-extractor.ts`):
   - `extractRelations(newMemory: MemoryItem, existingMemories: MemoryItem[], options?: ExtractOptions): Promise<RelationCandidate[]>`
     - 새로운 기억이 저장될 때 호출
     - 하이브리드 방식: 규칙 기반 먼저 시도 → 신뢰도 낮으면 LLM fallback
     - 기억 타입별로 적합한 관계 유형 필터링
     - 반환: 관계 후보 목록 (source_id, target_id, relation_type, confidence, method)

2.2. **규칙 기반 추출 (`RuleBasedRelationExtractor`)**:
   - 키워드 패턴 매칭 (예: "때문에", "따라서" → CAUSES)
   - 시간 표현 분석 (예: "이후", "다음" → FOLLOWS)
   - 의존성 키워드 (예: "필요", "요구" → DEPENDS_ON)
   - 참조 표현 (예: "참고", "참조" → REFERENCES)
   - 대조 표현 (예: "반대로", "그러나" → CONTRASTS_WITH)
   - 포함 표현 (예: "포함", "속한" → BELONGS_TO)
   - 신뢰도 계산: 패턴 매칭 강도에 따라 0.5~0.8 범위

2.3. **LLM 기반 추출 (`LLMBasedRelationExtractor`)**:
   - 규칙 기반이 실패하거나 신뢰도가 낮은 경우(0.6 미만) LLM 호출
   - 프롬프트 템플릿:
     ```
     새로운 기억: {newMemory.content}
     기존 기억 목록: {existingMemories.map(m => m.content)}
     
     새로운 기억과 기존 기억들 간의 관계를 분석하여 다음 형식으로 반환:
     - 관계 유형: CAUSES | DEPENDS_ON | FOLLOWS | CONTRASTS_WITH | REFERENCES | BELONGS_TO
     - 대상 기억 ID: {memory_id}
     - 신뢰도: 0.0~1.0
     ```
   - 신뢰도 계산: LLM 응답의 확신도 + 컨텍스트 일치도
   - **비용 최적화 전략**:
     - **Embedding 기반 후보 제한**: cosine similarity 상위 N=30 이하만 LLM 비교 대상으로 선정
     - **LLM 호출 rate limit**: 초당 1회 이하 (토큰 버킷 알고리즘)
     - **LLM Prompt Compression**: context window 절약을 위해 기존 기억을 요약 처리 (최대 500 토큰)
     - **Cache TTL**: 동일 기억 쌍에 대한 7일 내 재요청 금지 (메모리 캐시 + DB 캐시)
     - **배치 처리**: 여러 기억의 관계 추출을 묶어서 한 번에 처리 (최대 10개)
     - **비용 모니터링**: LLM 호출 횟수 및 비용 추적 (로깅 및 알림)

2.4. **타입별 관계 유형 필터링**:
   - `working`: REFERENCES만 (임시적이므로)
   - `episodic`: CAUSES, FOLLOWS, CONTRASTS_WITH, REFERENCES, BELONGS_TO
   - `semantic`: DEPENDS_ON, CONTRASTS_WITH, REFERENCES, BELONGS_TO
   - `procedural`: DEPENDS_ON, FOLLOWS, REFERENCES

2.5. **성능 최적화**:
   - 기존 기억 후보 필터링: 벡터 유사도 상위 N개만 관계 추출 대상으로 선정 (기본: 50개, LLM 호출 시: 30개)
   - 비동기 배치 처리: 기억 저장 시 즉시 추출하지 않고 백그라운드 작업으로 처리 가능 (설정으로 즉시 처리 옵션 제공)
   - 캐싱: 동일한 기억 쌍에 대한 중복 추출 방지 (메모리 캐시 + DB 캐시, TTL: 7일)

2.6. **관계 추출 품질 검증 시스템**:
   - **테스트 데이터셋**: `relation_testset.json` (수동 라벨링된 샘플 **최소 300건 이상**)
     - 형식: `{source_id, target_id, expected_relation_type, expected_confidence_range}`
     - **샘플 분포**: 관계 유형별 최소 50건 이상 (통계적 안정성 확보)
     - 라벨링 가이드: `docs/relation-labeling-guide.md` 제공
   - **정확도 측정 프로세스**:
     - 자동 추출 결과 vs 라벨 데이터 비교
     - Precision, Recall, F1-Score 계산
     - 관계 유형별 정확도 분석 (각 유형별 최소 60% 이상)
   - **CI 통합**:
     - PR 리뷰 시 "Relation Extraction Report" 자동 생성
     - 정확도 임계값 미달 시 CI 실패 (기본: Precision 0.70, Recall 0.65, F1 0.68)
     - **유연성 옵션**: `allow_soft_fail=true` 플래그로 임시 통과 모드 제공 (경고만, CI는 통과)
   - **정기적 검증**: 주간 자동 검증 실행 및 리포트 생성

### 3. 관계 그래프 저장 및 관리

3.1. **`RelationGraph` 서비스 클래스 생성** (`src/services/relation-graph.ts`):
   - `addRelation(relation: MemoryRelation): Promise<void>`: 관계 추가
   - `getRelations(memoryId: string, relationType?: string, direction?: 'outgoing' | 'incoming' | 'both'): Promise<MemoryRelation[]>`
   - `getRelatedMemories(memoryId: string, hop: number, relationTypes?: string[]): Promise<MemoryItem[]>`
   - `removeRelation(sourceId: string, targetId: string, relationType: string): Promise<void>`
   - `updateConfidence(relationId: number, newConfidence: number): Promise<void>`

3.2. **대규모 데이터 최적화**:
   - 관계 그래프 탐색 시 BFS(Breadth-First Search) 최적화
   - 인덱스 활용한 빠른 조회
   - **캐싱 계층 구조**:
     - **L1 Cache (MemoryCache)**: in-memory 캐시, TTL 10분
       - 목적: 관계 추출 및 검색 시 빠른 조회
       - 저장: 자주 조회되는 관계 경로 및 관계 후보
     - **L2 Cache (PersistentCache)**: SQLite key-value 테이블, TTL 7일
       - 목적: 관계 추출 결과 영구 저장 및 재사용
       - 저장: 기억 쌍별 관계 추출 결과 (LLM 호출 결과 포함)
   - 배치 삽입: 여러 관계를 한 번에 삽입하여 트랜잭션 오버헤드 감소

3.3. **순환 참조 감지 및 처리**:
   - 관계 추가 시 DFS(Depth-First Search)로 순환 참조 검사
   - 순환 참조 발견 시:
     - 경고 로그 기록
     - 관계 추가는 허용하되, `metadata`에 순환 플래그 추가
     - 관계 강화 학습 시 순환 참조 패턴 분석

### 4. 관계 기반 검색 점수 통합

4.1. **검색 랭킹 공식 확장**:
   ```
   기존: S = α * relevance + β * recency + γ * importance + δ * usage - ε * duplication_penalty
   
   확장: S = α * relevance + β * recency + γ * importance + δ * usage + ζ * relation_weight - ε * duplication_penalty
   ```
   - **Config 기반 가중치 관리** (`config/ranking-weights.toml`):
     ```toml
     [ranking_weights]
     alpha = 0.45  # relevance
     beta  = 0.20  # recency
     gamma = 0.20  # importance
     delta = 0.10  # usage
     zeta  = 0.15  # relation_weight
     epsilon = 0.10 # duplication_penalty
     
     [relation_weights]
     max_relations = 5  # 정규화를 위한 최대 관계 수
     ```
   - **실험 로그 연동**: 가중치 변경 시 실험 ID와 함께 로깅하여 A/B 테스트 가능
   - `relation_weight` 계산:
     ```
     relation_weight = Σ(confidence_i * type_boost_i) / max_relations
     ```
     - `confidence_i`: 쿼리 기억과의 관계 신뢰도
     - `type_boost_i`: 관계 유형별 부스트 (레지스트리 테이블의 `search_boost` 값 사용)
     - `max_relations`: 정규화를 위한 최대 관계 수 (기본: 5, config로 조정 가능)

4.2. **`SearchRanking` 클래스 확장**:
   - `calculateRelationWeight(memoryId: string, queryMemoryId?: string): number` 메서드 추가
   - 관계 그래프에서 직접/간접 관계 조회
   - 관계 유형별 가중치 적용

4.3. **검색 엔진 통합**:
   - `HybridSearchEngine`에서 관계 가중치 계산 통합
   - 관계가 있는 기억에 부스트 점수 적용
   - 관계 정보를 검색 결과에 포함 (선택적)

### 5. 앵커 시스템 완전 통합

5.1. **관계 기반 hop 탐색**:
   - 기존 벡터 거리 기반 hop 대신 **그래프 상의 hop 관계** 사용
   - 1-hop: 직접 관계가 있는 기억
   - 2-hop: 1-hop 기억과 관계가 있는 기억
   - 3-hop: 2-hop 기억과 관계가 있는 기억
   - 벡터 유사도와 관계 그래프를 결합한 하이브리드 hop 계산

5.2. **`AnchorSearchService` 확장**:
   - **통합 시점**: `AnchorSearchService v2.1` 이상에서 `RelationGraph` 통합
   - `searchNHop(hop=1~2)` 메서드에 관계 그래프 기반 탐색 로직 추가
   - 관계 그래프와 벡터 유사도를 결합한 점수 계산
   - 관계가 있는 기억에 우선순위 부여
   - **의존성**: `RelationGraph` 서비스가 먼저 구현되어야 함

5.3. **앵커 기반 관계 탐색 API**:
   - `searchLocal` 도구에 `use_relations` 옵션 추가 (기본: true)
   - 관계 그래프를 활용한 의미적 확장 탐색
   - **버전 요구사항**: Anchor System v2.1+ 및 Relation Engine v1.0+ 필요

### 6. 관계 강화 학습

6.1. **`RelationRefinementService` 서비스 클래스 생성** (`src/services/relation-refinement.ts`):
   - 주기적 실행 (기본: 24시간마다)
   - 관계 신뢰도 재평가 및 갱신
   - 실패 기록, 사용자 피드백, 메타-기억 점수 반영

6.2. **신뢰도 갱신 알고리즘**:
   ```
   new_confidence = w1 * old_confidence + 
                   w2 * usage_score + 
                   w3 * feedback_score + 
                   w4 * meta_memory_score
   ```
   - `usage_score`: 관계가 활용된 빈도 (로그 스케일)
   - `feedback_score`: 사용자 피드백 (helpful/not_helpful)
   - `meta_memory_score`: 메타-기억의 관계 유효성 평가
   - 가중치: w1=0.4, w2=0.3, w3=0.2, w4=0.1

6.3. **관계 삭제 정책**:
   - 신뢰도가 임계값(기본: 0.3) 이하로 떨어지면 자동 삭제 후보
   - 사용자 확인 후 삭제 또는 소프트 삭제

### 7. 메타-기억 기본 통합

7.1. **실패 패턴 분석에 관계 정보 활용**:
   - 실패한 작업의 기억들 간 관계 그래프 분석
   - 반복적으로 실패가 발생하는 관계 경로 식별
   - 관계 유형별 실패 패턴 분석 (예: CAUSES 관계에서 실패가 자주 발생)

7.2. **`MetaMemoryService` 확장**:
   - 관계 그래프를 활용한 실패 원인 추적
   - 관계 기반 학습 루프 강화

### 8. 관계 그래프 시각화

8.1. **내부 디버깅용 텍스트 출력** (`RelationGraphVisualizer`):
   - `visualizeAsText(memoryId: string, maxDepth: number): string`
     - 목적: 개발자 디버깅 및 로그 모니터링
     - 형식:
       ```
       (정산 오류) ──CAUSES[0.85]──▶ (세금 계산 로직)
                        │
                        ▼
                  (배포 성공)
       ```
     - 각 엣지에 관계 유형과 신뢰도 표시
     - 노드의 중요도(importance_score)에 따라 표시 스타일 변경
   - `visualizeSubgraph(memoryIds: string[]): string`
     - 목적: 특정 메모리 집합의 관계 그래프 시각화
   - 로그 레벨: DEBUG 모드에서만 출력

8.2. **외부 API용 JSON 출력** (Phase 2):
   - `GET /api/relations/graph?memory_id={id}&depth={n}`: 관계 그래프 JSON 반환
   - 목적: 대시보드 및 UI 통합
   - 형식:
     ```json
     {
       "nodes": [
         {"id": "mem_123", "content": "정산 오류", "importance": 0.8},
         {"id": "mem_456", "content": "세금 계산 로직", "importance": 0.7}
       ],
       "edges": [
         {"source": "mem_123", "target": "mem_456", "type": "CAUSES", "confidence": 0.85}
       ]
     }
     ```
   - 향후 대시보드에서 D3.js 또는 vis.js로 시각화 활용

### 9. MCP Tool 인터페이스 (Phase 2)

9.1. **`memento.extract_relations` 도구** (수동 추출용):
   - 입력: `memory_id` (TEXT), `force` (BOOLEAN, 기본: false)
   - 출력: 추출된 관계 목록
   - 동작: 지정된 기억에 대한 관계를 수동으로 추출 (자동 추출 실패 시)

9.2. **`memento.get_relations` 도구**:
   - 입력: `memory_id` (TEXT), `relation_type` (TEXT, 선택), `category` (TEXT, 선택), `direction` ('outgoing' | 'incoming' | 'both', 기본: 'both')
   - 출력: 관계 목록
   - 동작: 지정된 기억의 관계 조회 (관계군(category) 기반 필터링 지원)

9.3. **`memento.add_relation` 도구** (수동 관계 추가):
   - 입력: `source_id` (TEXT), `target_id` (TEXT), `relation_type` (TEXT), `confidence` (REAL, 선택, 기본: 0.7)
   - 출력: 생성된 관계 ID
   - 동작: 수동으로 관계 추가

9.4. **`memento.remove_relation` 도구**:
   - 입력: `relation_id` (INTEGER) 또는 `source_id`, `target_id`, `relation_type`
   - 출력: 성공 여부
   - 동작: 관계 삭제

9.5. **`memento.visualize_relations` 도구**:
   - 입력: `memory_id` (TEXT), `max_depth` (INTEGER, 기본: 2), `format` ('text' | 'json', 기본: 'text')
   - 출력: 텍스트 기반 또는 JSON 형식 관계 그래프
   - 동작: 관계 그래프 시각화 (디버깅용 텍스트 또는 API용 JSON)

### 10. 엣지 케이스 처리

10.1. **순환 참조 감지 및 처리**:
   - 관계 추가 시 DFS로 순환 참조 검사
   - 순환 참조 발견 시 경고 로그 및 메타데이터 플래그
   - 관계 강화 학습 시 순환 패턴 분석

10.2. **대량 데이터 성능 최적화**:
   - 관계 추출 시 후보 필터링 (벡터 유사도 상위 N개만)
   - 관계 그래프 탐색 시 BFS 최적화 및 인덱스 활용
   - 배치 처리 및 캐싱 전략

10.3. **관계 갱신/삭제 정책**:
   - 기억 삭제 시 관련 관계 자동 삭제 (CASCADE)
   - 관계 강화 학습으로 신뢰도 낮은 관계 자동 삭제 후보
   - 사용자 확인 후 삭제 또는 소프트 삭제

10.4. **관계 중복 방지**:
   - UNIQUE 제약으로 동일한 (source_id, target_id, relation_type) 조합 중복 방지
   - 관계 추가 시 기존 관계 확인 및 업데이트 옵션

10.5. **임베딩 없음 처리**:
   - 관계 추출 시 임베딩이 없는 기억은 임베딩 생성 시도
   - 생성 실패 시 규칙 기반 추출만 수행

## Non-Goals (Out of Scope)

1. **복잡한 그래프 알고리즘**: Graph Neural Network (GNN) 또는 Graph Attention Network (GAT) 기반 관계 추론은 MVP 범위를 벗어남. 기본적인 BFS/DFS 탐색만 구현.

2. **실시간 관계 업데이트**: 모든 관계를 실시간으로 업데이트하는 것은 성능상 부담이 크므로, 배치 처리 및 주기적 갱신만 지원.

3. **관계 그래프 시각화 UI**: 복잡한 인터랙티브 그래프 시각화는 별도 기능으로 분리. MVP에서는 텍스트 기반 출력만 제공.

4. **다국어 관계 추출**: 초기에는 한국어 및 영어만 지원. 다른 언어는 향후 확장.

5. **관계 자동 수정**: 사용자가 명시적으로 요청하지 않는 한, 관계를 자동으로 수정하거나 삭제하지 않음. 신뢰도가 낮아도 삭제 후보로만 표시.

6. **크로스 에이전트 관계 공유**: 다른 agent_id의 기억 간 관계는 MVP에 포함되지 않음. 동일 agent_id 내에서만 관계 추출.

7. **관계 기반 자동 요약**: 관계 그래프를 기반으로 기억을 자동 요약하는 기능은 별도 기능으로 분리.

## Design Considerations

### 아키텍처 고려사항

1. **서비스 계층 분리**:
   - `RelationExtractor`: 관계 추출 담당
   - `RelationGraph`: 관계 그래프 저장 및 조회 담당
   - `RelationRefinementService`: 관계 강화 학습 담당
   - 각 서비스는 독립적으로 테스트 및 확장 가능

2. **기존 시스템 통합**:
   - `MemoryEmbeddingService`: 임베딩 기반 후보 필터링
   - `HybridSearchEngine`: 검색 랭킹에 관계 가중치 통합
   - `AnchorSearchService`: 관계 기반 hop 탐색 통합
   - `MetaMemoryService`: 실패 패턴 분석에 관계 정보 활용

3. **성능 최적화 전략**:
   - 관계 추출은 비동기 배치 처리로 분리
   - 관계 그래프 탐색은 인덱스 및 캐싱 활용
   - 대량 데이터 처리를 위한 배치 삽입 및 조회 최적화

### 데이터 모델 고려사항

1. **기존 `memory_link` 테이블과의 호환성**:
   - 기존 `memory_link` 데이터를 `memory_relation`으로 마이그레이션
   - 기존 관계 유형 매핑:
     - `cause_of` → `CAUSES`
     - `derived_from` → `DEPENDS_ON`
     - `duplicates` → (새로운 관계 유형으로 처리 또는 제거)
     - `contradicts` → `CONTRASTS_WITH`

2. **확장 가능한 관계 유형 시스템**:
   - 관계 유형은 하드코딩하지 않고 레지스트리 테이블 또는 설정 파일로 관리
   - 새로운 관계 유형 추가 시 코드 수정 최소화

## Technical Considerations

### 의존성

1. **기존 서비스 통합**:
   - `MemoryEmbeddingService`: 임베딩 생성 및 조회
   - `HybridSearchEngine`: 검색 랭킹 통합
   - `AnchorSearchService`: 관계 기반 hop 탐색
   - `MetaMemoryService`: 실패 패턴 분석

2. **외부 서비스**:
   - LLM API (OpenAI, Gemini 등): 관계 추출 fallback
   - 선택적: spaCy 또는 transformers 라이브러리 (규칙 기반 추출 강화)

3. **데이터베이스 마이그레이션**:
   - `memory_relation` 테이블 생성
   - 기존 `memory_link` 데이터 마이그레이션
   - 인덱스 생성 및 최적화

### 성능 고려사항

1. **관계 추출 성능**:
   - 벡터 유사도 기반 후보 필터링으로 추출 대상 축소
   - 비동기 배치 처리로 사용자 응답 시간에 영향 최소화
   - LLM 호출 최소화: 규칙 기반 우선, 신뢰도 낮을 때만 LLM 사용

2. **관계 그래프 탐색 성능**:
   - BFS 최적화 및 인덱스 활용
   - 관계 캐싱으로 자주 조회되는 경로 캐싱
   - 대량 데이터 처리를 위한 배치 조회

3. **대규모 데이터 처리**:
   - 10,000개 이상 기억에서도 관계 추출 및 탐색이 빠르게 동작
   - 인덱스 최적화 및 쿼리 최적화
   - 관계 그래프 탐색 시 깊이 제한 (기본: 3-hop)

### 확장성

1. **관계 유형 확장**:
   - 새로운 관계 유형 추가 시 코드 수정 최소화
   - 관계 유형 레지스트리 또는 설정 파일로 관리

2. **저장소 확장**:
   - 향후 Neo4j, RDF store 등으로 확장 가능하도록 인터페이스 추상화
   - 현재는 SQLite 기반 구현

3. **앵커 시스템 확장**:
   - 관계 그래프를 활용한 고급 hop 탐색 알고리즘 추가 가능
   - 관계 유형별 가중치 조정 가능

## Success Metrics

### Phase 1 (MVP) 목표

1. **관계 추출 정확도** (테스트셋 기반 측정):
   - 규칙 기반 추출의 Precision: **70% 이상**, Recall: **65% 이상**, F1: **68% 이상**
   - LLM fallback 포함 전체 정확도: Precision **85% 이상**, Recall **80% 이상**, F1 **82% 이상**
   - 관계 유형별 정확도 분석 (각 유형별 최소 60% 이상)
   - CI 통합: 정확도 임계값 미달 시 PR 리뷰 차단

2. **검색 품질 개선**:
   - 관계 기반 검색 결과의 관련성 점수가 기존 대비 **15% 이상 향상**
   - 관계가 있는 기억의 검색 순위 상승률 측정 (상위 10개 결과 중 관계 기억 비율)
   - 사용자 피드백 기반 검색 만족도 개선

3. **앵커 시스템 성능 개선** (1~2-hop):
   - 관계 기반 hop 탐색의 정확도가 벡터 거리 기반 대비 **20% 이상 향상**
   - 의미적으로 확장된 맥락 제공 성공률 측정 (관계 경로 발견률)

4. **성능 지표**:
   - 관계 추출 평균 시간: **500ms 이하** (규칙 기반), **2초 이하** (LLM 포함)
   - 관계 그래프 탐색 평균 시간: **100ms 이하** (1-hop), **200ms 이하** (2-hop)
   - 대량 데이터(10,000개 이상)에서도 성능 저하 **20% 이내**
   - LLM 호출 비용: 기억당 평균 **$0.001 이하** (OpenAI 기준)

5. **시스템 안정성**:
   - 순환 참조 감지율: **100%**
   - 관계 그래프 무결성 유지율: **99% 이상**
   - LLM 호출 실패율: **5% 이하** (재시도 포함)

### Phase 2 (확장 버전) 목표

6. **관계 강화 학습 효과**:
   - 관계 강화 학습으로 신뢰도 개선률: **10% 이상**
   - 자동 삭제된 저신뢰도 관계 비율: **5% 이하**

7. **메타-기억 통합 효과**:
   - 메타-기억의 실패 원인 분석 정확도 개선: **25% 이상 향상**
   - 관계 기반 실패 패턴 식별 성공률: **70% 이상**

8. **사용자 만족도**:
   - MCP Tool 사용 빈도 측정 (주간 활성 사용자 수)
   - 관계 그래프 시각화 API 호출 빈도
   - 사용자 피드백 점수 (helpful/not_helpful 비율)

## Open Questions

### 결정 필요 (Implementation Decision Required)

| ID | 항목 | 담당 | 우선순위 | 결정 시점 | 옵션 | 권장 |
|----|------|------|----------|-----------|------|------|
| D1 | 기존 `memory_link` 마이그레이션 전략 | Infra | ★★★★★ | Sprint 1 시작 전 | A: 자동 마이그레이션 (서버 시작 시)<br>B: 수동 마이그레이션 도구<br>C: 병행 운영 후 점진적 전환 | 옵션 A (롤백 가능) |
| D2 | 순환 참조 처리 정책 | Core | ★★★☆☆ | Phase 1 완료 후 | A: 허용하되 경고, 메타데이터 플래그<br>B: 자동으로 가장 약한 관계 제거<br>C: 사용자 확인 후 처리 | 옵션 A (유연성 확보) |
| D3 | 관계 추출 트리거 시점 | Core | ★★★★☆ | Phase 1 구현 중 | A: 배치 처리 (기본)<br>B: 즉시 처리 (설정 활성화)<br>C: 하이브리드 (중요도 기반) | 옵션 C (하이브리드) |
| D4 | 관계 추출 실패 처리 | Core | ★★★☆☆ | Phase 1 구현 중 | A: 무시, 로그 기록만<br>B: 사용자 알림 (중요 기억)<br>C: 재시도 큐에 추가 | 옵션 A (무시, 로그) |

### 실험 필요 (Requires A/B Testing or Data-Driven Decision)

| ID | 항목 | 담당 | 우선순위 | 결정 시점 | 초기값 | 실험 방법 | 측정 지표 |
|----|------|------|----------|-----------|--------|-----------|-----------|
| E1 | 관계 유형별 검색 가중치 | AI | ★★★★★ | Beta 단계 | CAUSES=1.2, DEPENDS_ON=1.1, FOLLOWS=1.0, CONTRASTS_WITH=0.9, REFERENCES=0.8 | A/B 테스트, 사용자 피드백 반영 | 검색 관련성 점수, 사용자 만족도 |
| E2 | 관계 강화 학습 주기 최적화 | AI | ★★★★☆ | Phase 2 | 24시간마다 | 사용량 기반 동적 조정 (활성 기억 수, 관계 변경 빈도) | 신뢰도 개선률, 학습 비용 |
| E3 | LLM 비용/성능 trade-off | AI | ★★★★★ | Phase 1 후반 | 후보 30개, 임계값 0.6 | 후보 수 (20/30/50), 임계값 (0.5/0.6/0.7), 프롬프트 압축률 | LLM 호출 비용, 정확도, 응답 시간 |
| E4 | 대규모 데이터 최적화 전략 | Infra | ★★★★☆ | Phase 1 후반 | 기본 인덱스, 배치 크기 50 | 인덱스 최적화, 샘플링 전략, 배치 처리 크기 조정 | 추출 시간, 탐색 시간, 메모리 사용량 |

## Pre-Setup Tasks (구현 전 필수 작업)

실제 구현을 시작하기 전에 다음 3가지 작업을 완료해야 합니다:

### 1. 테스트 데이터셋 준비

- **파일**: `tests/fixtures/relation_testset.json`
- **규모**: 최소 300건 이상 (관계 유형별 50건 이상)
- **형식**: 
  ```json
  [
    {
      "source_id": "mem_123",
      "target_id": "mem_456",
      "expected_relation_type": "CAUSES",
      "expected_confidence_range": [0.7, 0.9],
      "source_content": "...",
      "target_content": "..."
    }
  ]
  ```
- **라벨링 가이드**: `docs/relation-labeling-guide.md` 작성
  - 관계 유형별 판단 기준
  - 신뢰도 범위 설정 가이드
  - 라벨링 예시 및 주의사항

### 2. Config 파일 초기 배포

- **파일**: `config/ranking-weights.toml`
- **내용**: 기본 가중치 설정
  ```toml
  [ranking_weights]
  alpha = 0.45
  beta  = 0.20
  gamma = 0.20
  delta = 0.10
  zeta  = 0.15
  epsilon = 0.10
  
  [relation_weights]
  max_relations = 5
  ```
- **검증**: Config 파일 로드 및 파싱 테스트 작성

### 3. RelationGraph API 스펙 초안 정의

- **파일**: `docs/api/relation-graph-api.md`
- **내용**: 
  - 함수 시그니처 확정
  - 인터페이스 정의 (`IRelationGraph`)
  - 에러 처리 규칙
  - 성능 요구사항 (응답 시간, 처리량)
- **목적**: 구현 전 API 계약 확정으로 개발 일관성 보장

## 관련 문서 및 참고 자료

- [Memento-Goals.md](mdc:docs/ko/Memento-Goals.md) - 전체 목표 및 시스템 설계
- [Memento-M1-DetailSpecs.md](mdc:docs/ko/Memento-M1-DetailSpecs.md) - M1 단계 상세 설계
- [Search-Ranking-Memory-Decay-Formulas.md](mdc:docs/ko/Search-Ranking-Memory-Decay-Formulas.md) - 검색 랭킹 및 망각 수식
- [0006-prd-anchor-system.md](mdc:tasks/0006-prd-anchor-system.md) - 앵커 시스템 PRD
- [0002-prd-vector-based-memory-neighbor-search.md](mdc:tasks/0002-prd-vector-based-memory-neighbor-search.md) - 벡터 기반 메모리 이웃 검색 PRD

## 관련 논문 및 참고 자료

1. **Knowledge Graphs**: 관계 그래프 구조 및 탐색 알고리즘에 대한 일반적인 개념
2. **Relation Extraction**: NLP 기반 관계 추출 기법 (BERT, spaCy 등)
3. **Graph Neural Networks**: 향후 확장을 위한 GNN 기반 관계 추론 (Non-Goals에 포함)

