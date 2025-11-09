# 0006-prd-anchor-system.md

## Introduction/Overview

앵커 시스템(Anchor System)은 Memento MCP 서버에 **국소적인 기억 검색(Local Memory Retrieval)** 메커니즘을 도입하는 기능입니다.

현재 Memento는 전역 검색(Global Search)을 통해 모든 메모리를 스캔하여 관련 기억을 찾지만, 이는 불필요한 메모리 스캔이 많고 맥락 집중력이 떨어지는 문제가 있습니다. 앵커 시스템은 "현재 내가 어디에 집중하고 있는가?"를 명확히 하여, **의미적으로 가까운 기억만 빠르게 탐색**하는 주의 집중 메커니즘(attention mechanism)을 제공합니다.

**핵심 문제**: 전역 검색은 정확도가 높지만, 대화나 작업 중 현재 맥락과 관련 없는 메모리까지 스캔하여 검색 속도가 느리고 노이즈가 많습니다. 따라서 효율적인 메모리 시스템은 현재 관심 주제(Context)를 나타내는 참조점(Anchor)을 중심으로 국소적인 검색을 수행하여 더 빠르고 일관된 맥락 기반 응답을 생성할 수 있어야 합니다.

**목표**: 3-Slot 구조(A/B/C)를 통해 다차원적인 맥락을 동시에 유지하고, 앵커를 중심으로 N-hop 제한 검색을 수행하여 검색 속도를 개선하고 불필요한 노이즈를 줄이며, 더 일관된 맥락 기반 응답을 생성합니다.

## Goals

1. **3-Slot 앵커 구조 구현**: 주요 맥락(A), 보조 맥락(B), 확장 맥락(C)을 동시에 관리하는 슬롯 시스템 구현
2. **국소 검색 알고리즘**: 앵커를 중심으로 N-hop 제한 내의 관련 기억만 우선 탐색하는 로직 구현
3. **자동 Fallback 메커니즘**: 국소 검색이 실패하거나 관련 기억이 부족할 경우 자동으로 전역 검색 수행
4. **자동 앵커 이동**: 검색 패턴(사용 빈도, 의미적 거리 등)에 따라 앵커가 자동으로 최적 위치로 이동
5. **MCP Tool 인터페이스**: `set_anchor`, `get_anchor`, `search_local`, `clear_anchor` 도구 제공
6. **멀티 클라이언트 지원**: agent_id별로 독립적인 앵커 상태 관리
7. **성능 개선**: 검색 속도 향상, 불필요한 메모리 스캔 감소, 맥락 집중력 향상
8. **시각화 지원**: 대시보드에서 각 앵커의 위치를 시각화하는 Anchor Map 제공 (MVP 포함)

## User Stories

### AI 에이전트 관점
- **US-001**: AI 에이전트로서 특정 대화 주제를 유지하면서 연관된 과거 기억만 빠르게 참조하고 싶다
- **US-002**: AI 에이전트로서 하나의 작업(예: 정산 로직 디버깅)을 지속하면서 주제를 벗어나지 않게 집중하고자 한다
- **US-003**: AI 에이전트로서 복잡한 문맥(예: "광고 정산 → 계약 변경 → 세금 계산")을 한 세션에서 다층적으로 관리하고 싶다
- **US-004**: AI 에이전트로서 검색 속도가 개선되어 더 빠른 응답을 받고 싶다
- **US-005**: AI 에이전트로서 불필요한 노이즈 없이 맥락에 집중된 검색 결과를 받고 싶다

### 개발자 관점
- **US-006**: 개발자로서 MCP 클라이언트를 통해 앵커를 설정하고 국소 검색을 수행하고 싶다
- **US-007**: 개발자로서 앵커 상태를 조회하고 관리할 수 있는 API를 사용하고 싶다
- **US-008**: 개발자로서 여러 클라이언트가 동시에 서로 다른 앵커를 사용할 수 있기를 원한다

### 시스템 관리자 관점
- **US-009**: 시스템 관리자로서 검색 성능이 개선되어 전체 시스템 부하가 감소하기를 원한다
- **US-010**: 시스템 관리자로서 앵커 시스템의 사용 패턴을 모니터링하고 최적화하고 싶다

## Functional Requirements

### 1. 데이터베이스 스키마 수정

1.1. **`anchor` 테이블 생성 (기본 저장소)**:
   ```sql
   CREATE TABLE IF NOT EXISTS anchor (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     agent_id TEXT NOT NULL,
     slot TEXT CHECK (slot IN ('A', 'B', 'C')) NOT NULL,
     memory_id TEXT, -- NULL 허용 (메모리 삭제 시 SET NULL 적용)
     created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
     updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
     FOREIGN KEY (memory_id) REFERENCES memory_item(id) ON DELETE SET NULL,
     UNIQUE(agent_id, slot)
   );
   ```
   - 이 테이블은 앵커 상태의 **기본 저장소**로 사용
   - 여러 에이전트가 동일한 메모리를 서로 다른 슬롯에 앵커로 설정 가능
   - **제약 조건**:
     - `UNIQUE(agent_id, slot)`: 한 에이전트는 각 슬롯(A/B/C)에 하나의 앵커만 설정 가능
     - **주의**: 이 제약은 (agent_id, slot) 조합만 보장하므로, 한 에이전트가 동일한 `memory_id`를 여러 슬롯에 설정하는 것을 데이터베이스 레벨에서 방지하지 못함
     - 따라서 애플리케이션 레벨(`setAnchor` 메서드)에서 동일 `memory_id`의 중복 설정을 검증하고 방지해야 함
   - 메모리 삭제 시 `memory_id`는 NULL로 설정되며, 해당 슬롯은 자동으로 비활성화

1.2. **인덱스 생성**:
   - `CREATE INDEX idx_anchor_agent_slot ON anchor(agent_id, slot)`
   - `CREATE INDEX idx_anchor_memory_id ON anchor(memory_id) WHERE memory_id IS NOT NULL`
   - `CREATE INDEX idx_anchor_agent_memory ON anchor(agent_id, memory_id) WHERE memory_id IS NOT NULL`

1.3. **메모리 캐시 전략**:
   - `AnchorManager`는 성능 최적화를 위해 메모리 캐시에 앵커 상태를 캐싱
   - 캐시는 `anchor` 테이블의 읽기 전용 복사본으로 관리
   - 앵커 설정/변경 시 캐시와 DB를 동기화
   - 서버 재시작 시 `anchor` 테이블에서 캐시 복원 (선택적)

### 2. AnchorManager 서비스 구현

2.1. `src/services/anchor-manager.ts` 파일 생성

2.2. `AnchorManager` 클래스 구현:
   - `cache: Map<string, {A: string | null, B: string | null, C: string | null}>`: agent_id별 슬롯 상태 관리 (메모리 캐시, 성능 최적화용)
   - `setAnchor(agentId: string, memoryId: string, slot: 'A' | 'B' | 'C'): Promise<void>`: 앵커 설정 (DB + 캐시 동기화)
     - **검증**: 동일 `agent_id`가 동일 `memory_id`를 다른 슬롯에 이미 설정했는지 확인 (중복 방지)
     - 기존 슬롯에 다른 메모리가 설정되어 있으면 자동으로 교체
   - `getAnchor(agentId: string, slot?: 'A' | 'B' | 'C'): Promise<AnchorInfo | AnchorInfo[] | null>`: 앵커 조회 (캐시 우선, 없으면 DB 조회)
   - `clearAnchor(agentId: string, slot?: 'A' | 'B' | 'C'): Promise<void>`: 앵커 제거 (DB + 캐시 동기화)
   - `searchLocal(db: Database, agentId: string, slot: 'A' | 'B' | 'C', query?: string, hopLimit?: number, options?: SearchOptions): Promise<SearchResult>`: 국소 검색 (query는 선택적)
   - `autoShiftAnchor(agentId: string, slot: 'A' | 'B' | 'C'): Promise<void>`: 자동 앵커 이동
   - `restoreCacheFromDB(db: Database): Promise<void>`: 서버 재시작 시 DB에서 캐시 복원 (선택적)

2.3. 슬롯별 홉 예산 및 벡터 스코프:
   - **Slot A (주요 맥락)**: hop_limit = 1, vector_threshold = 0.8
   - **Slot B (보조 맥락)**: hop_limit = 2, vector_threshold = 0.6
   - **Slot C (확장 맥락)**: hop_limit = 3, vector_threshold = 0.4

2.4. 저장 전략 및 동기화:
   - **기본 저장소**: `anchor` 테이블 (영구 저장)
   - **성능 최적화**: 메모리 캐시 (빠른 읽기 접근)
   - **동기화 규칙**: 
     - 앵커 설정/변경 시: DB에 먼저 저장 → 캐시 업데이트
     - 앵커 조회 시: 캐시 우선 → 없으면 DB 조회 → 캐시 업데이트
     - 서버 재시작 시: 선택적으로 DB에서 캐시 복원 (기본: 비활성화, 필요시 활성화)

### 3. 국소 검색 알고리즘 구현

3.1. **N-hop 제한 검색**:
   - 앵커 메모리의 임베딩 벡터를 기준으로 cosine distance 기반 유사도 계산
   - 슬롯별 벡터 스코프(threshold) 내의 메모리만 후보로 선정
   - 후보 메모리들 중에서 앵커와의 의미적 거리가 N-hop 이내인 것만 최종 결과로 반환
   - **쿼리 없이 검색**: `query` 파라미터가 제공되지 않으면 앵커 주변의 모든 관련 메모리를 hop 제한 내에서 반환
   - **쿼리 기반 검색**: `query`가 제공되면 앵커 주변에서 쿼리와 관련된 메모리만 필터링하여 반환

3.2. **Hop 계산 방법**:
   - 1-hop: 앵커와 직접적으로 유사한 메모리 (cosine similarity > threshold)
   - 2-hop: 1-hop 메모리와 유사한 메모리
   - 3-hop: 2-hop 메모리와 유사한 메모리
   - 기존 `memory_link` 테이블의 관계 정보도 활용 가능

3.3. **Fallback 메커니즘**:
   - **Fallback 조건**: `query` 파라미터가 제공된 경우에만 fallback 수행
     - 국소 검색 결과가 `min_results` (기본값: 3) 미만이거나 관련성이 낮은 경우
     - 자동으로 기존 전역 검색(`hybridSearchEngine.search`) 수행
     - 결과에 "fallback: true" 플래그 추가
   - **Fallback 없음**: `query`가 제공되지 않은 경우 (앵커 기반 리콜)
     - 앵커 주변의 모든 관련 메모리를 hop 제한 내에서 반환
     - 결과가 없어도 fallback하지 않음 (앵커 주변에 관련 메모리가 없다는 정보 자체가 유용)

3.4. **검색 결과 랭킹**:
   - 앵커와의 거리(hop)가 가까울수록 높은 점수
   - 기존 검색 랭킹 공식과 결합하여 최종 점수 계산
   - 앵커 근처 메모리는 추가 부스트 점수 적용

### 4. 자동 앵커 이동 (Auto Re-anchoring)

4.1. **이동 조건**:
   - 특정 메모리가 일정 기간 동안 자주 검색되는 경우
   - 현재 앵커보다 검색 쿼리와 의미적으로 더 가까운 메모리가 발견된 경우
   - 사용 빈도와 의미적 거리를 종합한 점수가 임계값을 초과하는 경우

4.2. **이동 알고리즘**:
   - 주기적으로(또는 검색 후) 앵커 주변의 메모리 사용 패턴 분석
   - 더 적합한 메모리를 발견하면 자동으로 앵커 이동
   - 이동 이력은 로그에 기록 (디버깅 및 모니터링용)

4.3. **이동 전략**:
   - 점진적 이동: 기존 앵커를 B나 C로 이동하고 새로운 메모리를 A에 설정
   - 급격한 이동: 현재 앵커를 완전히 교체
   - 이동 임계값은 설정 가능 (기본값: 0.7)

### 5. MCP Tool 인터페이스

5.1. **`memento.set_anchor`** 도구:
   - 입력: `memory_id` (TEXT), `slot` ('A' | 'B' | 'C'), `agent_id` (TEXT, 선택)
   - 출력: 성공 여부 및 설정된 앵커 정보
   - 동작: 지정된 메모리를 해당 슬롯의 앵커로 설정
   - **검증 규칙**:
     - 메모리가 존재하지 않거나 삭제된 경우 에러 반환
     - 동일한 `agent_id`가 동일한 `memory_id`를 다른 슬롯에 이미 설정한 경우 에러 반환 (중복 방지)
     - 기존 슬롯에 다른 메모리가 설정되어 있으면 자동으로 교체
   - 에러 처리: 위 검증 실패 시 명확한 에러 메시지 반환

5.2. **`memento.get_anchor`** 도구:
   - 입력: `slot` ('A' | 'B' | 'C', 선택), `agent_id` (TEXT, 선택)
   - 출력: 현재 설정된 앵커 정보 (모든 슬롯 또는 특정 슬롯)
   - 동작: agent_id별 앵커 상태 조회
   - 기본값: agent_id가 없으면 현재 세션의 agent_id 사용

5.3. **`memento.search_local`** 도구:
   - 입력: `slot` ('A' | 'B' | 'C'), `query` (TEXT, 선택), `hop_limit` (INTEGER, 선택), `limit` (INTEGER, 선택), `agent_id` (TEXT, 선택)
   - 출력: 국소 검색 결과 (기존 `recall`과 동일한 형식)
   - 동작: 
     - 지정된 슬롯의 앵커를 기준으로 국소 검색 수행
     - `query`가 제공되지 않으면 앵커 주변의 모든 관련 메모리를 hop 제한 내에서 반환 (앵커 기반 리콜)
     - `query`가 제공되면 앵커 주변에서 쿼리와 관련된 메모리만 필터링하여 반환
   - **Fallback 규칙** (3.3절과 일치):
     - `query`가 제공된 경우: 국소 검색 결과가 `min_results` (기본값: 3) 미만이거나 관련성이 낮으면 자동으로 전역 검색 수행
     - `query`가 없는 경우: Fallback 없음 (앵커 주변 결과만 반환, 결과가 없어도 fallback하지 않음)

5.4. **`memento.clear_anchor`** 도구:
   - 입력: `slot` ('A' | 'B' | 'C', 선택), `agent_id` (TEXT, 선택)
   - 출력: 성공 여부
   - 동작: 지정된 슬롯(또는 모든 슬롯)의 앵커 제거
   - 기본값: slot이 없으면 모든 슬롯 제거

5.5. **`memento.restore_anchors`** 도구 (선택적):
   - 입력: `agent_id` (TEXT, 선택)
   - 출력: 복원된 앵커 정보
   - 동작: 데이터베이스의 `anchor` 테이블에서 앵커 상태를 읽어 메모리 캐시에 복원
   - 용도: 서버 재시작 후 캐시 복원이 필요한 경우 수동으로 호출

### 6. Edge Cases 처리

6.1. **앵커 메모리 삭제 시**:
   - 앵커로 설정된 메모리가 삭제되면 `anchor` 테이블의 `memory_id`가 자동으로 NULL로 설정됨 (ON DELETE SET NULL)
   - 캐시에서도 해당 슬롯을 자동으로 null 처리
   - 가장 가까운 유사 메모리를 자동으로 새 앵커로 설정하는 옵션 제공 (설정 가능, 기본: 비활성화)

6.2. **멀티 클라이언트 지원**:
   - 각 agent_id별로 독립적인 앵커 상태 관리
   - agent_id가 제공되지 않으면 현재 세션의 agent_id 사용
   - 동시에 여러 클라이언트가 서로 다른 앵커를 설정해도 충돌 없음

6.3. **앵커 없이 search_local 호출**:
   - 해당 슬롯에 앵커가 없으면 (`memory_id`가 NULL인 경우):
     - `query`가 제공된 경우: 자동으로 전역 검색으로 fallback
     - `query`가 없는 경우: 에러 반환 (앵커 기반 리콜은 앵커가 필수)
   - 경고 메시지 로그 기록

6.4. **검색 결과 부족**:
   - **Fallback 조건** (3.3절, 5.3절과 일치):
     - `query`가 제공된 경우에만: 국소 검색 결과가 `min_results` (기본값: 3) 미만이거나 관련성이 낮으면 자동으로 전역 검색으로 fallback
     - `query`가 없는 경우 (앵커 기반 리콜): Fallback 없음, 앵커 주변 결과만 반환 (결과가 없어도 fallback하지 않음)
   - 결과에 "local_results_count" 및 "fallback_used" 필드 포함 (fallback이 수행된 경우에만 "fallback_used: true")

6.5. **임베딩 없음**:
   - 앵커 메모리에 임베딩이 없으면 임베딩 생성 시도
   - 생성 실패 시 에러 반환

### 7. UI/시각화 (Anchor Map)

7.1. **대시보드 통합**:
   - HTTP 서버의 대시보드에 Anchor Map 섹션 추가
   - 각 슬롯(A/B/C)의 현재 앵커 위치를 시각화

7.2. **시각화 요소**:
   - 앵커 메모리를 중심으로 한 네트워크 그래프
   - 슬롯별 색상 구분 (A: 빨강, B: 노랑, C: 파랑)
   - Hop 거리에 따른 원형 레이어 표시
   - 관련 메모리 간 연결선 표시

7.3. **인터랙션**:
   - 앵커 클릭 시 해당 메모리 상세 정보 표시
   - 앵커 변경 버튼 제공
   - 검색 결과 하이라이트

### 8. 성능 최적화

8.1. **캐싱 전략**:
   - 앵커 상태는 메모리 캐시에 저장하여 빠른 접근
   - 앵커 주변 메모리 인덱스 캐싱 (선택적)

8.2. **인덱스 활용**:
   - 벡터 유사도 검색 시 기존 `memory_embedding` 테이블 및 벡터 인덱스 활용
   - `memory_link` 테이블의 관계 정보를 활용한 hop 계산 최적화

8.3. **배치 처리**:
   - 자동 앵커 이동은 배치 작업으로 주기적 실행 (기본: 5분마다)
   - 실시간 이동은 설정으로 비활성화 가능

## Non-Goals (Out of Scope)

1. **복잡한 학습 기반 앵커 전환**: 머신러닝 모델을 사용한 자동 앵커 전환은 MVP 범위를 벗어남. 기본적인 사용 빈도와 의미적 거리 기반 이동만 구현.

2. **앵커 히스토리 추적**: 앵커 변경 이력을 데이터베이스에 저장하는 기능은 MVP에 포함되지 않음. 로그 레벨에서만 기록.

3. **앵커 기반 메모리 클러스터링**: 앵커를 중심으로 메모리를 자동으로 클러스터링하는 기능은 별도 기능으로 분리.

4. **크로스 에이전트 앵커 공유**: 다른 agent_id의 앵커를 참조하거나 공유하는 기능은 MVP에 포함되지 않음.

5. **앵커 기반 자동 요약**: 앵커 주변 메모리를 자동으로 요약하는 기능은 별도 기능으로 분리.

## Design Considerations

### UI/UX 요구사항

1. **Anchor Map 시각화**:
   - 대시보드에 인터랙티브한 네트워크 그래프 제공
   - D3.js 또는 vis.js 같은 라이브러리 활용 고려
   - 반응형 디자인으로 모바일에서도 접근 가능

2. **MCP Tool 사용성**:
   - 도구 파라미터는 직관적이고 간단하게 설계
   - 에러 메시지는 명확하고 해결 방법 제시
   - 기본값을 적절히 설정하여 최소한의 파라미터로도 사용 가능

### 아키텍처 고려사항

1. **서비스 계층 분리**:
   - `AnchorManager`는 독립적인 서비스로 구현
   - 기존 `HybridSearchEngine`와 통합하여 사용
   - `ToolContext`에 `anchorManager` 서비스 추가

2. **캐시 전략**:
   - 기본적으로 메모리 캐시 사용 (빠른 접근)
   - 필요시 수동으로 DB에 영구 저장
   - 서버 재시작 시 캐시 초기화 (선택적 DB 복원)

## Technical Considerations

### 의존성

1. **기존 서비스 통합**:
   - `HybridSearchEngine`: 국소 검색 실패 시 fallback으로 사용
   - `MemoryEmbeddingService`: 앵커 메모리의 임베딩 생성 및 조회
   - `DatabaseUtils`: 데이터베이스 쿼리 실행

2. **벡터 검색**:
   - 기존 벡터 검색 인프라(sqlite-vss 또는 pgvector) 활용
   - Cosine distance 기반 유사도 계산

3. **데이터베이스 마이그레이션**:
   - 새로운 `anchor` 테이블 생성 (마이그레이션 스크립트 필요)
   - 기존 데이터와의 호환성 유지 (기존 메모리에는 영향 없음)

### 성능 고려사항

1. **검색 성능**:
   - 국소 검색은 전역 검색보다 빠르게 수행되어야 함
   - 벡터 유사도 검색 최적화 (인덱스 활용)
   - Hop 계산은 메모리 링크 정보를 활용하여 최적화

2. **메모리 사용량**:
   - 앵커 상태는 메모리 캐시에 저장되므로 메모리 사용량 모니터링 필요
   - 대량의 agent_id가 있는 경우 캐시 크기 제한 고려

3. **동시성**:
   - 여러 클라이언트가 동시에 앵커를 설정해도 충돌 없이 처리
   - agent_id별로 독립적 관리로 동시성 문제 최소화

### 확장성

1. **슬롯 확장**:
   - 현재는 3개 슬롯(A/B/C)만 지원하지만, 향후 확장 가능하도록 설계
   - 슬롯 개수는 설정으로 변경 가능하도록 고려

2. **Hop 제한 확장**:
   - 슬롯별 hop_limit는 설정으로 변경 가능
   - 동적 조정 기능 (향후 고려)

## Success Metrics

1. **검색 속도 개선**:
   - 국소 검색의 평균 검색 시간이 전역 검색 대비 **30% 이상 감소**
   - P95 검색 시간 개선 측정

2. **검색 정확도 개선**:
   - 앵커 기반 검색 결과의 관련성 점수가 전역 검색 대비 **10% 이상 향상**
   - 사용자 피드백 기반 정확도 측정

3. **불필요한 메모리 스캔 감소**:
   - 국소 검색 시 스캔되는 메모리 수가 전역 검색 대비 **50% 이상 감소**
   - 데이터베이스 쿼리 수 감소 측정

4. **시스템 부하 감소**:
   - 전체 검색 쿼리의 CPU 사용량 **20% 이상 감소**
   - 데이터베이스 I/O 감소 측정

5. **사용자 만족도**:
   - MCP Tool 사용 빈도 측정
   - 앵커 시스템 활용률 추적

## Open Questions

1. **Hop 계산 최적화**: 메모리 링크 정보를 활용한 hop 계산의 정확도와 성능 균형은 어떻게 맞출 것인가?

2. **자동 이동 임계값**: 자동 앵커 이동의 임계값은 어떤 기준으로 설정할 것인가? 사용자 피드백을 통해 조정이 필요한가?

3. **Fallback 전략**: 국소 검색 실패 시 전역 검색으로 fallback하는 조건(최소 결과 수, 관련성 점수 등)을 어떻게 최적화할 것인가?

4. **캐시 복원**: 서버 재시작 시 DB에 저장된 앵커를 자동으로 복원할 것인가, 아니면 수동 복원만 지원할 것인가?

5. **슬롯 우선순위**: 여러 슬롯에 앵커가 설정된 경우, 검색 시 어떤 슬롯을 우선적으로 사용할 것인가? (기본: A > B > C)

6. **임베딩 제공자 호환성**: 다양한 임베딩 제공자(OpenAI, TF-IDF 등)와의 호환성은 어떻게 보장할 것인가?

7. **앵커 만료 정책**: 앵커가 오랫동안 사용되지 않으면 자동으로 만료시킬 것인가? 만료 시간은 어떻게 설정할 것인가?

## 관련 문서 및 참고 자료

- [Memento-Goals.md](mdc:docs/Memento-Goals.md) - 전체 목표 및 시스템 설계
- [Memento-M1-DetailSpecs.md](mdc:docs/Memento-M1-DetailSpecs.md) - M1 단계 상세 설계
- [Search-Ranking-Memory-Decay-Formulas.md](mdc:docs/Search-Ranking-Memory-Decay-Formulas.md) - 검색 랭킹 및 망각 수식
- [0002-prd-vector-based-memory-neighbor-search.md](mdc:tasks/0002-prd-vector-based-memory-neighbor-search.md) - 벡터 기반 메모리 이웃 검색 PRD

## 관련 논문

1. **Using Hindsight to Anchor Past Knowledge in Continual Learning** (Chaudhry et al., 2021)
   - "anchor points" 개념 도입, 과거 지식 유지 및 탐색에 대한 영감 제공

2. **Unsupervised Dense Retrieval Training with Web Anchors** (Xie et al., 2023)
   - 앵커를 중심으로 검색 범위를 조정하는 개념적 아이디어 제공

3. **Pretraining with hierarchical memories: separating long‑tail and common knowledge** (2025)
   - 계층적 메모리 구조 및 hop 개념에 대한 구조적 단서 제공

