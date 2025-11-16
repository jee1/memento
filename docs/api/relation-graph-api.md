# RelationGraph API 스펙

## 개요

`RelationGraph` 서비스는 기억 간의 의미적 관계를 저장하고 관리하는 핵심 서비스입니다. 관계 그래프를 통해 기억 간의 인과, 의존, 시간, 맥락 관계를 추적하고, 검색 랭킹 및 앵커 시스템에 활용할 수 있습니다.

## 인터페이스 정의

### IRelationGraph

```typescript
interface IRelationGraph {
  /**
   * 관계를 그래프에 추가합니다.
   * @param relation 추가할 관계 정보
   * @throws {DuplicateRelationError} 동일한 관계가 이미 존재하는 경우
   * @throws {CircularReferenceWarning} 순환 참조가 감지된 경우 (경고만, 추가는 허용)
   * @throws {InvalidRelationError} 관계 정보가 유효하지 않은 경우
   */
  addRelation(relation: MemoryRelation): Promise<void>;

  /**
   * 특정 기억의 관계를 조회합니다.
   * @param memoryId 조회할 기억 ID
   * @param relationType 관계 유형 필터 (선택)
   * @param direction 관계 방향 ('outgoing' | 'incoming' | 'both', 기본: 'both')
   * @returns 관계 목록
   */
  getRelations(
    memoryId: string,
    relationType?: string,
    direction?: 'outgoing' | 'incoming' | 'both'
  ): Promise<MemoryRelation[]>;

  /**
   * N-hop 관계를 통해 연결된 기억들을 조회합니다 (BFS 기반).
   * @param memoryId 시작 기억 ID
   * @param hop 탐색 깊이 (1~3, 기본: 1)
   * @param relationTypes 필터링할 관계 유형 배열 (선택)
   * @returns 연결된 기억 목록
   */
  getRelatedMemories(
    memoryId: string,
    hop?: number,
    relationTypes?: string[]
  ): Promise<MemoryItem[]>;

  /**
   * 관계를 삭제합니다.
   * @param sourceId 소스 기억 ID
   * @param targetId 타겟 기억 ID
   * @param relationType 관계 유형
   * @throws {RelationNotFoundError} 관계가 존재하지 않는 경우
   */
  removeRelation(
    sourceId: string,
    targetId: string,
    relationType: string
  ): Promise<void>;

  /**
   * 관계의 신뢰도를 업데이트합니다.
   * @param relationId 관계 ID
   * @param newConfidence 새로운 신뢰도 (0.0~1.0)
   * @throws {InvalidConfidenceError} 신뢰도가 범위를 벗어난 경우
   * @throws {RelationNotFoundError} 관계가 존재하지 않는 경우
   */
  updateConfidence(relationId: number, newConfidence: number): Promise<void>;

  /**
   * 여러 관계를 한 번에 추가합니다 (배치 삽입).
   * @param relations 추가할 관계 배열
   * @returns 성공적으로 추가된 관계 수
   */
  addRelationsBatch(relations: MemoryRelation[]): Promise<number>;
}
```

### MemoryRelation

```typescript
interface MemoryRelation {
  id?: number; // 자동 생성 (추가 시)
  source_id: string; // 소스 기억 ID
  target_id: string; // 타겟 기억 ID
  relation_type: string; // 관계 유형 (CAUSES, DEPENDS_ON, FOLLOWS, CONTRASTS_WITH, REFERENCES, BELONGS_TO)
  confidence: number; // 신뢰도 (0.0~1.0, 기본: 0.7)
  created_at?: string; // 생성 시각 (자동 생성)
  updated_at?: string; // 수정 시각 (자동 생성)
  metadata?: RelationMetadata; // 메타데이터 (JSON)
}

interface RelationMetadata {
  extraction_method?: 'rule' | 'llm'; // 추출 방법
  extraction_timestamp?: string; // 추출 시점
  cyclic?: boolean; // 순환 참조 플래그
  refinement_history?: Array<{
    timestamp: string;
    old_confidence: number;
    new_confidence: number;
    reason: string;
  }>; // 관계 강화 학습 이력
}
```

### RelationDirection

```typescript
type RelationDirection = 'outgoing' | 'incoming' | 'both';
```

## 함수 시그니처 상세

### addRelation

**목적**: 단일 관계를 그래프에 추가합니다.

**파라미터**:
- `relation: MemoryRelation` - 추가할 관계 정보

**반환값**: `Promise<void>`

**동작**:
1. 입력 검증 (source_id, target_id, relation_type, confidence 범위)
2. UNIQUE 제약 검증 (동일한 (source_id, target_id, relation_type) 조합 중복 확인)
3. 순환 참조 감지 (DFS 기반, 선택적)
4. 데이터베이스에 삽입
5. L1/L2 캐시 무효화

**에러 처리**:
- `DuplicateRelationError`: 동일한 관계가 이미 존재
- `InvalidRelationError`: 필수 필드 누락 또는 값이 유효하지 않음
- `CircularReferenceWarning`: 순환 참조 감지 (경고만, 추가는 허용)

**성능 요구사항**:
- 평균 응답 시간: **50ms 이하**
- 순환 참조 검사 포함 시: **200ms 이하**

### getRelations

**목적**: 특정 기억의 관계를 조회합니다.

**파라미터**:
- `memoryId: string` - 조회할 기억 ID
- `relationType?: string` - 관계 유형 필터 (선택)
- `direction?: RelationDirection` - 관계 방향 (기본: 'both')

**반환값**: `Promise<MemoryRelation[]>`

**동작**:
1. L1 캐시 확인 (TTL 10분)
2. 캐시 미스 시 데이터베이스 조회
3. 인덱스 활용 (source_id, target_id, relation_type)
4. 결과를 L1 캐시에 저장

**에러 처리**:
- `MemoryNotFoundError`: 기억이 존재하지 않는 경우 (빈 배열 반환)

**성능 요구사항**:
- 캐시 히트 시: **5ms 이하**
- 캐시 미스 시: **30ms 이하**

### getRelatedMemories

**목적**: N-hop 관계를 통해 연결된 기억들을 조회합니다.

**파라미터**:
- `memoryId: string` - 시작 기억 ID
- `hop?: number` - 탐색 깊이 (1~3, 기본: 1)
- `relationTypes?: string[]` - 필터링할 관계 유형 배열 (선택)

**반환값**: `Promise<MemoryItem[]>`

**동작**:
1. BFS 기반 그래프 탐색
2. 각 hop 레벨에서 관계 조회
3. 중복 제거 (동일 기억이 여러 경로로 발견되는 경우)
4. 결과 정렬 (신뢰도 내림차순)

**에러 처리**:
- `InvalidHopError`: hop 값이 1~3 범위를 벗어남
- `MemoryNotFoundError`: 시작 기억이 존재하지 않음

**성능 요구사항**:
- 1-hop: **100ms 이하**
- 2-hop: **200ms 이하**
- 3-hop: **500ms 이하**

### removeRelation

**목적**: 관계를 그래프에서 삭제합니다.

**파라미터**:
- `sourceId: string` - 소스 기억 ID
- `targetId: string` - 타겟 기억 ID
- `relationType: string` - 관계 유형

**반환값**: `Promise<void>`

**동작**:
1. 관계 존재 확인
2. 데이터베이스에서 삭제 (CASCADE 처리)
3. L1/L2 캐시 무효화

**에러 처리**:
- `RelationNotFoundError`: 관계가 존재하지 않음

**성능 요구사항**:
- 평균 응답 시간: **30ms 이하**

### updateConfidence

**목적**: 관계의 신뢰도를 업데이트합니다.

**파라미터**:
- `relationId: number` - 관계 ID
- `newConfidence: number` - 새로운 신뢰도 (0.0~1.0)

**반환값**: `Promise<void>`

**동작**:
1. 신뢰도 범위 검증 (0.0~1.0)
2. 관계 존재 확인
3. 데이터베이스 업데이트
4. metadata.refinement_history에 이력 추가
5. L1 캐시 무효화

**에러 처리**:
- `InvalidConfidenceError`: 신뢰도가 범위를 벗어남
- `RelationNotFoundError`: 관계가 존재하지 않음

**성능 요구사항**:
- 평균 응답 시간: **40ms 이하**

### addRelationsBatch

**목적**: 여러 관계를 한 번에 추가합니다 (배치 삽입 최적화).

**파라미터**:
- `relations: MemoryRelation[]` - 추가할 관계 배열

**반환값**: `Promise<number>` - 성공적으로 추가된 관계 수

**동작**:
1. 입력 배열 검증
2. 트랜잭션 시작
3. 배치 삽입 (SQLite의 INSERT OR IGNORE 활용)
4. 중복 관계는 무시하고 성공한 관계만 카운트
5. 트랜잭션 커밋
6. L1/L2 캐시 무효화

**에러 처리**:
- `InvalidBatchError`: 배치 배열이 비어있거나 유효하지 않음
- 부분 실패 시: 성공한 관계 수만 반환 (에러는 로깅만)

**성능 요구사항**:
- 10개 관계: **100ms 이하**
- 50개 관계: **300ms 이하**
- 100개 관계: **500ms 이하**

## 에러 타입 정의

```typescript
class RelationGraphError extends Error {
  constructor(message: string, public code: string) {
    super(message);
    this.name = 'RelationGraphError';
  }
}

class DuplicateRelationError extends RelationGraphError {
  constructor(sourceId: string, targetId: string, relationType: string) {
    super(
      `관계가 이미 존재합니다: ${sourceId} -> ${targetId} (${relationType})`,
      'DUPLICATE_RELATION'
    );
    this.name = 'DuplicateRelationError';
  }
}

class InvalidRelationError extends RelationGraphError {
  constructor(message: string) {
    super(message, 'INVALID_RELATION');
    this.name = 'InvalidRelationError';
  }
}

class CircularReferenceWarning extends RelationGraphError {
  constructor(path: string[]) {
    super(
      `순환 참조가 감지되었습니다: ${path.join(' -> ')}`,
      'CIRCULAR_REFERENCE'
    );
    this.name = 'CircularReferenceWarning';
  }
}

class RelationNotFoundError extends RelationGraphError {
  constructor(sourceId: string, targetId: string, relationType: string) {
    super(
      `관계를 찾을 수 없습니다: ${sourceId} -> ${targetId} (${relationType})`,
      'RELATION_NOT_FOUND'
    );
    this.name = 'RelationNotFoundError';
  }
}

class InvalidConfidenceError extends RelationGraphError {
  constructor(confidence: number) {
    super(
      `신뢰도는 0.0~1.0 범위여야 합니다. 현재 값: ${confidence}`,
      'INVALID_CONFIDENCE'
    );
    this.name = 'InvalidConfidenceError';
  }
}

class InvalidHopError extends RelationGraphError {
  constructor(hop: number) {
    super(
      `hop 값은 1~3 범위여야 합니다. 현재 값: ${hop}`,
      'INVALID_HOP'
    );
    this.name = 'InvalidHopError';
  }
}

class MemoryNotFoundError extends RelationGraphError {
  constructor(memoryId: string) {
    super(`기억을 찾을 수 없습니다: ${memoryId}`, 'MEMORY_NOT_FOUND');
    this.name = 'MemoryNotFoundError';
  }
}

class InvalidBatchError extends RelationGraphError {
  constructor(message: string) {
    super(message, 'INVALID_BATCH');
    this.name = 'InvalidBatchError';
  }
}
```

## 성능 요구사항 요약

| 작업 | 평균 응답 시간 | 최대 응답 시간 | 처리량 |
|------|---------------|---------------|--------|
| `addRelation` | 50ms | 200ms | 100 req/s |
| `getRelations` (캐시 히트) | 5ms | 10ms | 1000 req/s |
| `getRelations` (캐시 미스) | 30ms | 100ms | 500 req/s |
| `getRelatedMemories` (1-hop) | 100ms | 200ms | 50 req/s |
| `getRelatedMemories` (2-hop) | 200ms | 400ms | 30 req/s |
| `getRelatedMemories` (3-hop) | 500ms | 1000ms | 10 req/s |
| `removeRelation` | 30ms | 100ms | 200 req/s |
| `updateConfidence` | 40ms | 150ms | 150 req/s |
| `addRelationsBatch` (10개) | 100ms | 200ms | 50 req/s |
| `addRelationsBatch` (50개) | 300ms | 600ms | 20 req/s |
| `addRelationsBatch` (100개) | 500ms | 1000ms | 10 req/s |

## 캐싱 전략

### L1 Cache (MemoryCache)
- **TTL**: 10분
- **저장소**: In-memory Map
- **용도**: 자주 조회되는 관계 경로
- **무효화**: 관계 추가/삭제/수정 시

### L2 Cache (PersistentCache)
- **TTL**: 7일
- **저장소**: SQLite key-value 테이블
- **용도**: 관계 추출 결과 영구 저장
- **무효화**: 관계 강화 학습 시 또는 수동 무효화

## 순환 참조 처리

1. **감지**: DFS 기반 순환 참조 검사
2. **처리**: 경고 로그 기록 + metadata.cyclic 플래그 추가
3. **허용**: 순환 참조가 있어도 관계 추가는 허용 (유연성 확보)
4. **분석**: 관계 강화 학습 시 순환 패턴 분석

## 트랜잭션 처리

- **단일 작업**: 자동 커밋
- **배치 작업**: 명시적 트랜잭션 사용
- **롤백**: 에러 발생 시 자동 롤백
- **격리 수준**: SQLite 기본 (SERIALIZABLE)

## 확장성 고려사항

- **대규모 데이터**: 10,000개 이상 기억에서도 성능 유지
- **인덱스 최적화**: 복합 인덱스 활용
- **배치 처리**: 대량 관계 추가 시 배치 API 사용 권장
- **캐싱**: 자주 조회되는 관계는 캐시 활용

## 버전 관리

- **현재 버전**: 1.0.0
- **호환성**: 하위 호환성 유지 (필수)
- **변경 사항**: BREAKING CHANGE는 메이저 버전 업그레이드

## 참고 사항

- 관계 유형은 확장 가능하도록 설계 (레지스트리 테이블 기반)
- 기존 `memory_link` 테이블과의 호환성 고려 (마이그레이션 지원)
- 관계 강화 학습은 Phase 2에서 구현 예정
