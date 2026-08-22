# 0012-prd-recall-auto-anchor-neighbors.md

## Introduction/Overview

이 PRD는 Memento MCP 서버의 `recall` 도구에 **자동 앵커 설정 및 이웃 기억 포함** 기능을 추가하는 것을 목표로 합니다.

현재 Memento는 앵커 시스템과 이웃 기억 기능을 제공하고 있으나, 사용자가 수동으로 호출해야 하기 때문에 실제로는 거의 사용되지 않고 있습니다. 또한 검색 후 관련 정보를 놓치거나 맥락 관리가 자동화되지 않아 비효율적인 문제가 있습니다.

이 기능이 도입되면 다음과 같은 문제가 해결됩니다:

* 앵커와 이웃 기억을 수동으로 호출할 필요 없이 자동으로 최적화된 검색 경험 제공
* 검색 후 관련 정보를 놓치지 않고 자동으로 맥락 확장
* 맥락 관리가 자동화되어 더 효율적인 검색 및 정보 활용

## Goals

1. **자동 앵커 설정**: `recall` 검색 시 가장 관련성 높은 기억을 자동으로 앵커로 설정하여 맥락 관리 자동화
2. **자동 이웃 기억 포함**: 검색 결과의 상위 항목에 대해 이웃 기억을 자동으로 포함하여 관련 정보 확장
3. **유연한 제어**: 옵션 파라미터를 통해 자동 처리 동작을 제어할 수 있도록 함
4. **하위 호환성 보장**: 기본값을 `false`로 설정하여 기존 `recall` 호출이 의도치 않게 상태를 변경하지 않도록 보장
5. **성능 최적화**: 이웃 기억 조회는 동기 처리하되, 실패해도 검색 결과는 정상 반환

## User Stories

### AI 에이전트 관점

- **US-001**: AI 에이전트로서 `recall` 검색 시 자동으로 맥락이 설정되어 이후 검색이 더 효율적이기를 원한다
- **US-002**: AI 에이전트로서 검색 결과의 상위 항목과 관련된 이웃 기억을 자동으로 받아 관련 정보를 놓치지 않고 싶다
- **US-003**: AI 에이전트로서 필요에 따라 자동 처리를 비활성화하고 싶다
- **US-004**: AI 에이전트로서 앵커 설정이나 이웃 기억 조회가 실패해도 검색 결과는 정상적으로 받고 싶다

### 시스템 관점

- **US-005**: 시스템 관리자로서 앵커와 이웃 기억의 사용 빈도가 증가하여 시스템 활용도가 향상되기를 원한다
- **US-006**: 시스템 관리자로서 검색 후 관련 정보 발견률이 향상되어 사용자 만족도가 높아지기를 원한다

## Functional Requirements

### 1. 파라미터 추가

#### 1.1. `auto_set_anchor` 파라미터
- **타입**: boolean
- **기본값**: `false` (하위 호환성 보장)
- **설명**: 가장 관련성 높은 기억(첫 번째 결과)을 슬롯 A에 자동으로 앵커로 설정
- **동작**:
  - `true`: 검색 결과가 있으면 가장 관련성 높은 기억을 슬롯 A에 앵커로 설정
  - `false`: 앵커를 자동으로 설정하지 않음 (기존 동작 유지)
- **앵커 설정 전략**:
  - 슬롯 A에 pinned 앵커가 있으면 → 앵커 설정 건너뜀 (보호 정책)
  - 슬롯 A에 일반 앵커가 있으면 → 슬롯 B로 이동
  - 슬롯 B에 앵커가 있으면 → 슬롯 C로 이동
  - 슬롯 C에 앵커가 있으면 → 제거
  - 새로운 기억을 슬롯 A에 설정
- **에러 처리**: 앵커 설정 실패 시 경고만 로그하고 검색 결과는 정상 반환

#### 1.2. `include_neighbors` 파라미터
- **타입**: boolean
- **기본값**: `false` (성능 고려)
- **설명**: 검색 결과의 상위 항목에 대해 이웃 기억을 자동으로 포함
- **동작**:
  - `true`: `neighbors_limit`에 지정된 개수만큼의 상위 결과에 대해 이웃 기억 조회 및 포함
  - `false`: 이웃 기억을 포함하지 않음 (기존 동작 유지)
- **성능**: 응답에 포함되는 동기 처리이지만, 내부적으로는 병렬 실행 (모든 이웃 기억 조회를 동시에 수행하여 응답 시간 최소화)
- **에러 처리**: 이웃 기억 조회 실패 시 해당 항목의 `neighbors` 필드를 빈 배열로 설정하고 경고만 로그

#### 1.3. `neighbors_limit` 파라미터
- **타입**: number
- **기본값**: `3`
- **설명**: 이웃 기억을 포함할 상위 결과의 개수 (각 결과당 이웃 개수는 `neighbors_per_item`으로 제어)
- **범위**: 1 이상, 10 이하 (검색 결과 개수보다 작으면 검색 결과 개수로 제한)
- **동작**: 상위 N개 결과에 대해서만 이웃 기억 조회 및 포함

#### 1.4. `neighbors_per_item` 파라미터
- **타입**: number
- **기본값**: `5`
- **설명**: 각 검색 결과 항목당 조회할 이웃 기억의 최대 개수
- **범위**: 1 이상, 50 이하
- **동작**: `neighbors_limit`에 지정된 각 상위 결과에 대해 최대 N개의 이웃 기억 조회

#### 1.5. `neighbors_similarity_threshold` 파라미터
- **타입**: number
- **기본값**: `0.8`
- **설명**: 이웃 기억 조회 시 유사도 임계값 (이 값 이상인 기억만 반환)
- **범위**: 0.0 이상, 1.0 이하
- **동작**: 벡터 유사도가 임계값 이상인 기억만 이웃으로 포함

### 2. 자동 앵커 설정 로직

#### 2.1. 앵커 설정 조건
- `auto_set_anchor`가 `true`이고
- 검색 결과가 1개 이상 있을 때
- 가장 관련성 높은 기억(첫 번째 결과)을 슬롯 A에 앵커로 설정

#### 2.2. 기존 앵커 처리 및 보호 정책
- **보호 정책**: 
  - 슬롯 A에 pinned 앵커가 있으면 앵커 설정을 건너뜀 (수동 고정 앵커 보호)
  - 슬롯 B/C에 pinned 앵커가 있어도 회전 규칙에 따라 이동/제거됨
  - **전제**: 슬롯 A만 pinned 앵커 보호 대상이며, B/C의 pinned 앵커는 보호되지 않음
  - **권장 사항**: 슬롯 B/C에는 pinned 앵커를 두지 않는 것을 권장 (자동 회전 시 손실될 수 있음)

- **슬롯 회전 규칙**:
  - 슬롯 A에 일반 앵커가 있으면 → 슬롯 B로 이동 (B에 pinned가 있어도 덮어씀)
  - 슬롯 B에 앵커가 있으면 → 슬롯 C로 이동 (C에 pinned가 있어도 덮어씀)
  - 슬롯 C에 앵커가 있으면 → 제거 (pinned 여부와 관계없이 제거)
  - 새로운 기억을 슬롯 A에 설정

- **구현 가이드**:
  - **정책**: 슬롯 B/C의 pinned 앵커는 **항상 덮어씀** (스킵 옵션 없음)
    - 이유: 슬롯 회전 규칙의 일관성을 유지하기 위해
    - 대안: 슬롯 A에 pinned 앵커를 두면 보호됨
  - **검증**: 슬롯 B/C에 pinned 앵커가 있는지 확인 (경고 로그용)
  - **로그**: 슬롯 B/C의 pinned 앵커를 덮어쓸 때 경고 레벨 로그 기록
    ```typescript
    // 슬롯 B 확인
    const slotBAnchor = await anchorManager.getAnchor(agent_id, 'B');
    if (slotBAnchor && slotBAnchor.pinned) {
      logger.warn('Pinned anchor in slot B will be overwritten', {
        agent_id,
        old_memory_id: slotBAnchor.memory_id,
        new_memory_id: topMemory.id
      });
    }
    
    // 슬롯 C 확인
    const slotCAnchor = await anchorManager.getAnchor(agent_id, 'C');
    if (slotCAnchor && slotCAnchor.pinned) {
      logger.warn('Pinned anchor in slot C will be overwritten', {
        agent_id,
        old_memory_id: slotCAnchor.memory_id
      });
    }
    ```
  - **경고 정책**: 
    - 슬롯 B/C의 pinned 앵커를 덮어쓸 때 경고 로그만 기록 (에러로 처리하지 않음)
    - 사용자가 의도적으로 B/C에 pinned를 두었다면, 자동 회전 시 손실될 수 있음을 로그로 알림
    - 운영 시 혼선 방지를 위해 로그에 명확히 기록
    - **스킵 옵션 없음**: 슬롯 B/C의 pinned 앵커가 있어도 회전 규칙에 따라 무조건 덮어씀

- **주의사항**: 
  - 슬롯 A의 pinned 앵커만 보호되므로 자동 설정이 건너뛰어지며, 이 경우 메타데이터에 `anchor_set_skipped: true, anchor_set_skipped_reason: "pinned_anchor_protected"` 포함
  - 슬롯 B/C의 pinned 앵커는 보호되지 않으므로 회전 규칙에 따라 이동/제거될 수 있음
  - 슬롯 B/C의 pinned 앵커가 덮어써질 때는 경고 로그를 기록하여 운영 시 추적 가능

#### 2.3. 에러 처리
- 앵커 설정 실패 시:
  - 에러를 로그에 기록 (경고 레벨)
  - 검색 결과는 정상 반환
  - 응답 메타데이터에 `anchor_set_error: true` 포함

#### 2.4. 응답 메타데이터 스키마
- **앵커 설정 성공 시** (non-null, 필수):
  ```typescript
  {
    metadata: {
      anchor_set: {
        memory_id: string;
        slot: "A";
        agent_id: string;
      };
      anchor_set_error?: never;
      anchor_set_skipped?: never;
    }
  }
  ```
- **앵커 설정 실패 시**:
  ```typescript
  {
    metadata: {
      anchor_set: null;
      anchor_set_error: true;
      anchor_set_skipped?: never;
    }
  }
  ```
- **앵커 설정 건너뜀 (pinned 보호)**:
  ```typescript
  {
    metadata: {
      anchor_set: null;
      anchor_set_skipped: true;
      anchor_set_skipped_reason: "pinned_anchor_protected";
      anchor_set_error?: never;
    }
  }
  ```
- **앵커 설정 비활성화**:
  ```typescript
  {
    metadata: {
      anchor_set: null;
      anchor_set_error?: never;
      anchor_set_skipped?: never;
    }
  }
  ```

### 3. 자동 이웃 기억 포함 로직

#### 3.1. 이웃 기억 포함 조건
- `include_neighbors`가 `true`이고
- 검색 결과가 1개 이상 있을 때
- 상위 `neighbors_limit`개 결과에 대해 이웃 기억 조회

#### 3.2. 이웃 기억 조회
- 각 상위 결과에 대해 `MemoryNeighborService.getNeighbors()` 호출
- 파라미터:
  - `limit`: `neighbors_per_item` 파라미터 값 (기본값: 5)
  - `similarity_threshold`: `neighbors_similarity_threshold` 파라미터 값 (기본값: 0.8)
- 동기 처리 (응답 시간에 포함)
- 타임아웃: 각 이웃 기억 조회당 최대 2초 (타임아웃 시 해당 항목의 `neighbors`를 빈 배열로 설정)

#### 3.3. 응답 형식
- 각 검색 결과 항목에 `neighbors` 필드 추가:
  ```json
  {
    "items": [
      {
        "id": "mem_12345",
        "content": "...",
        "neighbors": [
          {
            "id": "mem_67890",
            "content": "...",
            "similarity": 0.85
          }
        ]
      }
    ]
  }
  ```
- 이웃 기억이 없는 경우: `neighbors: []`
- 이웃 기억 조회 실패 시: `neighbors: []` (에러 로그만 기록)

#### 3.4. 에러 처리
- 이웃 기억 조회 실패 시:
  - 해당 항목의 `neighbors` 필드를 빈 배열로 설정
  - 에러를 로그에 기록 (경고 레벨)
  - 다른 항목의 이웃 기억 조회는 계속 진행

### 4. 스키마 확장

#### 4.1. RecallSchema 확장
- `auto_set_anchor`: `z.boolean().optional().default(false)`
- `include_neighbors`: `z.boolean().optional().default(false)`
- `neighbors_limit`: `z.number().min(1).max(10).optional().default(3)`
- `neighbors_per_item`: `z.number().min(1).max(50).optional().default(5)`
- `neighbors_similarity_threshold`: `z.number().min(0).max(1).optional().default(0.8)`

#### 4.2. 입력 스키마 설명 추가
- 각 파라미터에 대한 명확한 설명 추가
- 기본값 명시

### 5. 하위 호환성

#### 5.1. 기본값 전략 (하위 호환성 보장)
- **기본값**: `auto_set_anchor: false`, `include_neighbors: false`
- **목적**: 기존 `recall` 호출이 의도치 않게 상태를 변경하지 않도록 보장
- **기존 동작 유지**: 기본값으로 기존 동작과 동일하게 동작

#### 5.2. 하위 호환성 시나리오

##### 시나리오 1: 읽기 전용 사용자
- **상황**: 읽기 전용으로 `recall`만 사용하는 사용자
- **영향**: 기본값(`false`)으로 인해 앵커나 이웃 기억이 자동 처리되지 않음
- **결과**: 기존 동작과 동일, 상태 변경 없음

##### 시나리오 2: 기존 클라이언트
- **상황**: 새로운 파라미터를 인식하지 못하는 기존 클라이언트
- **영향**: 기본값(`false`)으로 인해 자동 처리되지 않음
- **결과**: 기존 동작과 동일, 호환성 유지

##### 시나리오 3: 명시적 opt-in
- **상황**: 자동 처리를 원하는 사용자
- **동작**: `auto_set_anchor: true`, `include_neighbors: true` 명시적으로 설정
- **결과**: 자동 앵커 설정 및 이웃 기억 포함

#### 5.3. Opt-out 가이드
기존 동작을 유지하려면 (기본값이므로 별도 설정 불필요):
```typescript
// 자동 처리 없음 (기본값)
await mcp_memento_recall({
  query: "검색어"
});

// 또는 명시적으로 비활성화
await mcp_memento_recall({
  query: "검색어",
  auto_set_anchor: false,
  include_neighbors: false
});
```

자동 처리를 원하면:
```typescript
await mcp_memento_recall({
  query: "검색어",
  auto_set_anchor: true,
  include_neighbors: true,
  neighbors_limit: 3
});
```

#### 5.4. 응답 형식 호환성
- 기존 응답 구조 유지
- 새로운 필드(`neighbors`, `metadata.anchor_set`)는 선택적
- 기존 클라이언트는 새로운 필드를 무시해도 정상 동작
- `metadata.anchor_set`이 `null`이면 기존 클라이언트는 무시 가능

## Non-Goals (Out of Scope)

1. **비동기 이웃 기억 조회**: 이웃 기억 조회는 동기 처리 (성능 최적화는 Phase 2에서 고려)
2. **다중 슬롯 자동 설정**: 슬롯 A만 자동 설정 (B, C는 수동 설정)
3. **이웃 기억 캐싱**: 이웃 기억 결과 캐싱은 Phase 2에서 고려
4. **앵커 자동 이동**: 검색 패턴 기반 앵커 자동 이동은 별도 기능 (0006 PRD 참조)
5. **성능 모니터링**: 자동 처리 성능 모니터링은 Phase 2에서 고려

## Design Considerations

### API 설계
- 기존 `recall` 도구의 파라미터 구조 유지
- 새로운 파라미터는 모두 선택적(optional)으로 추가
- 기본값을 `false`로 설정하여 하위 호환성 보장 (opt-in 방식)

### 성능 고려사항
- 이웃 기억 조회는 동기 처리하되, 실패해도 검색 결과는 정상 반환
- `neighbors_limit`을 통해 조회할 항목 수를 제한하여 성능 영향 최소화
- 앵커 설정은 빠른 작업이므로 성능 영향 최소

### 에러 처리 전략
- 앵커 설정 또는 이웃 기억 조회 실패 시:
  - 에러를 로그에 기록 (경고 레벨)
  - 검색 결과는 정상 반환
  - 사용자에게는 투명하게 처리

## Technical Considerations

### 구현 위치
- 파일: `src/domains/memory/recall/recall-tool.ts`
- 수정 사항:
  1. `RecallSchema`에 새 파라미터 추가
  2. `handle` 메서드에서 자동 앵커 설정 로직 추가
  3. `handle` 메서드에서 이웃 기억 포함 로직 추가
  4. 응답 형식에 `anchor_set` 메타데이터 추가

### 의존성
- `AnchorManager`: 앵커 설정 및 관리
- `MemoryNeighborService`: 이웃 기억 조회
- `getVectorSearchEngine()`: 벡터 검색 엔진 (이웃 기억 조회용)

### 성능 영향

#### 성능 가정 근거
- **벡터 검색 쿼리 시간**: sqlite-vec 기반 벡터 검색은 평균 30-100ms 소요 (데이터베이스 크기 및 인덱스 상태에 따라 변동)
- **이웃 기억 조회**: 각 항목당 1회의 벡터 검색 쿼리 + 메모리 조회 쿼리
- **응답 크기**: 각 이웃 기억당 평균 500 bytes (메모리 ID, content, similarity 등)
- **앵커 설정**: 단일 DB 업데이트 쿼리 (약 1-5ms)

#### 예상 응답 시간 증가
- **기본 설정** (`neighbors_limit: 3`, `neighbors_per_item: 5`):
  - 최선의 경우: 3개 × 30ms = 약 90ms
  - 평균적인 경우: 3개 × 50ms = 약 150ms
  - 최악의 경우: 3개 × 100ms = 약 300ms
  - 응답 크기 증가: 3개 × 5개 × 500 bytes = 약 7.5KB
- **최악의 경우** (`neighbors_limit: 10`, `neighbors_per_item: 50`):
  - 최악의 경우 (병렬 처리): max(100ms) = 약 100ms (병렬 처리 시)
  - 응답 크기 증가: 10개 × 50개 × 500 bytes = 약 250KB
  - **쿼리 비용**: `neighbors_limit`번의 이웃 기억 조회 호출 (각 조회에서 최대 `neighbors_per_item`개 반환)
    - 실제 쿼리 수: 10번 (각 조회에서 최대 50개 이웃 기억 반환)
    - 총 반환 가능한 이웃 기억 수: 최대 10 × 50 = 500개 (실제로는 유사도 임계값으로 필터링되어 더 적을 수 있음)

#### 성능 가드 및 구현 방식

##### 타임아웃 정책
- **개별 조회 타임아웃**: 각 이웃 기억 조회당 최대 2초 (타임아웃 시 해당 항목의 `neighbors`를 빈 배열로 설정)
- **전체 요청 타임아웃**: 병렬 처리이므로 전체 지연 상한은 개별 조회 타임아웃 + 오버헤드
  - **전체 타임아웃 값**: 2.5초 (개별 조회 타임아웃 2초 + 오버헤드 0.5초)
  - 병렬 처리 시 모든 조회가 동시에 실행되므로, 가장 느린 조회가 2초를 초과하지 않으면 전체도 2초 내 완료
  - 오버헤드는 Promise.all() 처리 및 결과 병합 시간 포함

##### 구현 방식
- **병렬 처리 (최종 선택)**: 모든 이웃 기억 조회를 `Promise.all()`로 병렬 처리하여 응답 시간 최소화
  - 장점: 최악의 경우에도 `max(개별 조회 시간)`으로 제한 (약 2초)
  - 단점: 동시 쿼리 수가 많아질 수 있음 (최대 `neighbors_limit`개)
  - 선택 이유: 직렬 처리 시 최악의 경우 20초까지 늘어날 수 있어 병렬 처리가 필수적
- **타임아웃 구현**:
  ```typescript
  // 각 조회에 개별 타임아웃 적용
  const neighborPromises = topResults.map((item, index) => {
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Timeout')), 2000)
    );
    
    return Promise.race([
      neighborService.getNeighbors(item.id, options),
      timeoutPromise
    ]).then(result => ({ index, neighbors: result.neighbors }))
      .catch(() => ({ index, neighbors: [] })); // 타임아웃 시 빈 배열
  });
  
  // 전체 요청 타임아웃 (부분 성공 유지)
  let timeoutId: NodeJS.Timeout | null = null;
  const timeoutPromise = new Promise<Array<{ index: number; neighbors: any[] }>>((resolve) => {
    timeoutId = setTimeout(() => {
      // 타임아웃 시 현재까지 완료된 결과만 반환
      Promise.allSettled(neighborPromises).then(results => {
        resolve(results.map((r, idx) => 
          r.status === 'fulfilled' 
            ? r.value 
            : { index: idx, neighbors: [] } // 원래 인덱스 유지
        ));
      });
    }, 2500); // 전체 타임아웃: 2.5초
  });
  
  try {
    const allNeighbors = await Promise.race([
      Promise.all(neighborPromises),
      timeoutPromise
    ]);
    
    // 타임아웃 취소
    if (timeoutId) clearTimeout(timeoutId);
    
    // 결과를 원래 순서로 정렬
    const sortedNeighbors = allNeighbors
      .sort((a, b) => a.index - b.index)
      .map(r => r.neighbors);
    
    return sortedNeighbors;
  } catch (error) {
    // 타임아웃 취소
    if (timeoutId) clearTimeout(timeoutId);
    // 타임아웃 시에도 부분 완료 결과는 반환됨 (timeoutPromise에서 처리)
    throw error;
  }
  ```
- **타임아웃 시 미완료 조회 처리**:
  - 타임아웃 도달 시: 완료된 조회 결과만 반환하고, 미완료 조회는 취소하지 않음
  - **주의사항**: Promise 취소는 JavaScript에서 직접 지원하지 않으므로, 미완료 조회는 백그라운드에서 계속 실행될 수 있음
  - **영향**: 응답은 타임아웃 내에 반환되지만, 백그라운드에서 DB 쿼리가 계속 실행될 수 있어 리소스 사용에 주의 필요
  - **권장**: 타임아웃이 자주 발생하는 경우 `neighbors_limit` 또는 `neighbors_per_item`을 줄이는 것을 고려
- **부분 성공 처리 정책**:
  - 전체 타임아웃 도달 시: 완료된 조회 결과는 유지하고, 미완료 항목만 빈 배열로 설정
  - 개별 조회 타임아웃 시: 해당 항목만 빈 배열로 설정하고 다른 항목은 계속 진행
  - 장점: 일부 조회가 실패해도 성공한 결과는 반환하여 사용자 경험 향상

##### 응답 크기 가드
- **최대 응답 크기**: `neighbors_limit × neighbors_per_item × 평균 이웃 크기`
  - 기본 설정: 3 × 5 × 500 bytes = 약 7.5KB (허용 가능)
  - 최악의 경우: 10 × 50 × 500 bytes = 약 250KB (허용 가능하나 주의 필요)
- **권장 설정**: 
  - 일반적인 사용: `neighbors_limit: 3`, `neighbors_per_item: 5` (약 150ms 추가, 7.5KB 증가)
  - 성능이 중요한 경우: `include_neighbors: false` 또는 `neighbors_limit: 1`
  - 대용량 응답이 우려되는 경우: `neighbors_per_item: 10` 이하로 제한

##### neighbors_per_item 최대값 근거
- **최대값 50 설정 근거**:
  - 일반적인 사용: 5개면 충분 (관련 기억의 대표적인 샘플)
  - 고급 사용: 10-20개면 대부분의 관련 기억 포함
  - 최대 50개: 매우 상세한 분석이 필요한 경우를 위한 상한선
  - 성능 고려: 각 조회에서 최대 50개를 반환하지만, 실제로는 유사도 임계값으로 필터링되어 더 적을 수 있음
- **응답 크기 제한**: 250KB는 MCP 프로토콜에서 허용 가능한 범위 (일반적으로 1MB 이하)

### 테스트 전략
- 단위 테스트: 각 로직별 테스트
- 통합 테스트: 전체 워크플로우 테스트
- E2E 테스트: 실제 MCP 도구 호출 테스트
- 성능 테스트: 이웃 기억 조회 성능 측정

## Success Metrics

1. **사용 빈도 증가**: 앵커와 이웃 기억의 사용 빈도가 기존 대비 50% 이상 증가
2. **정보 발견률 향상**: 검색 후 관련 정보 발견률이 기존 대비 30% 이상 향상
3. **사용자 만족도 향상**: 검색 결과의 관련성 및 완전성에 대한 사용자 만족도 향상
4. **성능 영향 최소화**: 평균 응답 시간 증가가 500ms 이하로 유지

## Open Questions

1. **슬롯 회전 전략**: 기존 앵커를 B/C로 이동할 때, 기존 B/C의 앵커는 어떻게 처리할지? 
   - **결정**: 슬롯 C에 앵커가 있으면 제거 (PRD에 명시)
   - **이유**: 슬롯은 3개뿐이므로 순환 구조 유지

2. **이웃 기억 개수**: `neighbors_limit`의 최대값은 몇 개로 제한할지?
   - **결정**: 최대 10개로 제한 (PRD에 명시)
   - **이유**: 성능 고려 및 응답 크기 제한

3. **성능 임계값**: 이웃 기억 조회로 인한 응답 시간 증가가 어느 정도까지 허용 가능한지?
   - **결정**: 각 이웃 기억 조회당 최대 2초 타임아웃 (PRD에 명시)
   - **이유**: 최악의 경우에도 응답 시간을 예측 가능하게 유지

4. **캐싱 전략**: 이웃 기억 결과를 캐싱할지 여부
   - **상태**: Phase 2에서 고려 (Non-Goals에 명시)

5. **모니터링**: 자동 처리 성공/실패율을 모니터링할지 여부
   - **상태**: Phase 2에서 고려 (Non-Goals에 명시)

## Related Documents

- [0006-prd-anchor-system.md](./0006-prd-anchor-system.md): 앵커 시스템 PRD
- [0002-prd-vector-based-memory-neighbor-search.md](./0002-prd-vector-based-memory-neighbor-search.md): 이웃 기억 검색 PRD
- [GitHub Issue #40](https://github.com/jee1/memento/issues/40): 원본 이슈 (예상)

