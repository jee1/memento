# CoreMemory 캐시 동기화 전략

## 개요

Memento MCP Server의 CoreMemory는 `always_load=true`인 항목들을 메모리에 캐싱하여 빠른 조회 성능을 제공합니다. 이 문서는 현재 구현된 캐시 동기화 전략과 향후 개선 방향을 설명합니다.

## 목차

1. [현재 구현 (단일 서버 환경)](#현재-구현-단일-서버-환경)
2. [버전 기반 캐시 무효화](#버전-기반-캐시-무효화)
3. [캐시 무효화 전략](#캐시-무효화-전략)
4. [향후 개선 방향](#향후-개선-방향)
5. [성능 고려사항](#성능-고려사항)

## 현재 구현 (단일 서버 환경)

### 아키텍처

```
┌─────────────────┐
│  Application    │
│     Layer       │
└────────┬────────┘
         │
         ▼
┌─────────────────┐      ┌──────────────────┐
│ CoreMemoryService│─────▶│ CoreMemoryCache   │
│                 │      │    (In-Memory)    │
└────────┬────────┘      └──────────────────┘
         │
         ▼
┌─────────────────┐
│ CoreMemoryRepo  │
│   (SQLite)      │
└─────────────────┘
```

### 동작 방식

1. **캐시 저장**
   - `always_load=true`인 CoreMemory 항목만 캐시에 저장
   - 서버 시작 시 자동으로 로드
   - `create` 시 `always_load=true`이면 즉시 캐시에 추가

2. **캐시 조회**
   - `findByKey` 호출 시 캐시에서 먼저 조회
   - 캐시에 없으면 DB에서 조회 후 `always_load=true`이면 캐시에 추가

3. **버전 관리**
   - 각 레코드에 `version` 필드 (단조 증가)
   - `create` 시: `version = 1`
   - `update` 시: `version = version + 1`

### 버전 기반 캐시 무효화

#### 동작 원리

```typescript
// findByKey 호출 시
1. 캐시에서 조회 (CacheEntry: record, cachedAt, version)
2. DB에서 최신 레코드 조회
3. 버전 비교:
   - DB version > Cache version → 캐시 무효화 및 재로드
   - DB version = Cache version → 캐시된 값 반환
   - DB version < Cache version → 캐시된 값 반환 (비정상 상태, 로그 기록)
```

#### 장점

- **자동 동기화**: DB 변경 시 자동으로 캐시 갱신
- **성능 최적화**: 버전이 같으면 DB 조회 없이 캐시 반환
- **데이터 일관성**: 항상 최신 데이터 보장

#### 제한사항

- **단일 서버 환경 전용**: 현재는 단일 프로세스 내에서만 동작
- **DB 조회 오버헤드**: 버전 비교를 위해 매번 DB 조회 필요 (향후 개선 가능)

## 캐시 무효화 전략

### 1. 자동 무효화 (버전 비교)

**트리거**: `findByKey` 호출 시

```typescript
// CoreMemoryService.findByKey
- 캐시에 항목이 있는 경우
- DB에서 최신 버전 조회
- 버전 불일치 시 자동 무효화 및 재로드
```

### 2. 명시적 무효화 (업데이트/삭제)

**트리거**: `update`, `updateByKey`, `delete`, `deleteByKey` 호출 시

```typescript
// CoreMemoryService.update
- 레코드 업데이트 후
- 캐시 무효화 (invalidate)
- always_load=true이면 재로드
```

### 3. 이벤트 리스너

**용도**: 캐시 무효화 이벤트를 외부에서 감지

```typescript
interface CacheInvalidationListener {
  onInvalidate(key: string, reason?: string): void;
  onInvalidateAll(reason?: string): void;
}

// 사용 예시
cache.subscribeInvalidation({
  onInvalidate: (key, reason) => {
    console.log(`Cache invalidated: ${key}, reason: ${reason}`);
  },
  onInvalidateAll: (reason) => {
    console.log(`Cache cleared: ${reason}`);
  }
});
```

### 4. version=0 처리

**상황**: 마이그레이션 미완료 또는 비정상 상태

- `version=0`인 항목은 항상 무효화
- 경고 로그 출력
- 마이그레이션 완료 검증에서 `version=0` 행이 없어야 함

## 향후 개선 방향

### 1. 분산 환경 지원 (M2/M3)

#### 문제점

현재 구현은 단일 서버 환경에서만 동작합니다. 여러 서버 인스턴스가 동시에 실행되는 경우:

- 서버 A에서 업데이트 → 서버 B의 캐시는 무효화되지 않음
- 데이터 불일치 발생 가능

#### 해결 방안

**옵션 1: Pub/Sub 메시지 큐**

```
서버 A: UPDATE → DB 변경 → Pub/Sub 메시지 발행
서버 B: Pub/Sub 메시지 수신 → 캐시 무효화
```

- **장점**: 실시간 동기화, 확장성 좋음
- **단점**: 인프라 복잡도 증가 (Redis, RabbitMQ 등 필요)

**옵션 2: DB 변경 피드 (Change Data Capture)**

```
DB 변경 → CDC 스트림 → 각 서버가 구독 → 캐시 무효화
```

- **장점**: DB 중심 아키텍처 유지
- **단점**: CDC 도구 필요 (Debezium 등)

**옵션 3: 폴링 기반 동기화**

```
각 서버: 주기적으로 최신 버전 조회 → 버전 불일치 시 무효화
```

- **장점**: 추가 인프라 불필요
- **단점**: 실시간성이 낮음, DB 부하 증가

#### 권장 방안

**M2 (Team)**: Pub/Sub 기반 (Redis Pub/Sub)
- Redis는 이미 다른 용도로 사용 가능
- 실시간 동기화 보장
- 구현 복잡도 중간

**M3 (Organization)**: DB 변경 피드 (Debezium + Kafka)
- 대규모 환경에 적합
- 높은 처리량
- 구현 복잡도 높음

### 2. 외부 캐시 도입 (Redis)

#### 현재 구조

```
Application → In-Memory Cache → SQLite DB
```

#### 개선 구조

```
Application → Redis Cache → SQLite DB
```

#### 장점

- **공유 캐시**: 여러 서버 인스턴스가 동일한 캐시 공유
- **영속성**: 서버 재시작 시에도 캐시 유지 가능
- **성능**: 네트워크 지연 있지만 메모리보다 빠름
- **확장성**: Redis Cluster로 수평 확장 가능

#### 고려사항

- **네트워크 지연**: 로컬 메모리보다 느림
- **인프라 비용**: Redis 서버 운영 필요
- **복잡도**: 캐시 서버 관리 필요

### 3. 캐시 전략 개선

#### 현재: Write-Through

```
Write → DB 업데이트 → 캐시 무효화 → 재로드
```

#### 개선: Write-Back (Lazy Write)

```
Write → 캐시 업데이트 → 비동기로 DB 쓰기
```

- **장점**: 쓰기 성능 향상
- **단점**: 데이터 손실 위험, 복잡도 증가

#### 개선: Cache-Aside (권장)

```
Read: 캐시 확인 → 없으면 DB 조회 → 캐시 저장
Write: DB 업데이트 → 캐시 무효화
```

- 현재 구현과 유사하지만 더 명확한 전략

### 4. 버전 비교 최적화

#### 현재: 매번 DB 조회

```typescript
// 매번 DB 조회
const dbRecord = await repository.findByKey(agent_id, key);
if (dbRecord.version > cachedEntry.version) {
  // 무효화
}
```

#### 개선: 버전 테이블 분리

```sql
CREATE TABLE core_memory_version (
  agent_id TEXT,
  key TEXT,
  version INTEGER,
  updated_at TIMESTAMP,
  PRIMARY KEY (agent_id, key)
);
```

- 버전만 조회하여 오버헤드 감소
- 전체 레코드 조회는 무효화 시에만 수행

## 성능 고려사항

### 현재 성능 특성

- **캐시 히트율**: `always_load=true` 항목은 항상 캐시에 있음
- **조회 성능**: O(1) Map 조회
- **버전 비교 오버헤드**: 매번 DB 조회 필요 (개선 여지)

### 벤치마크 (참고)

- **캐시 조회**: < 0.1ms
- **DB 조회 (버전 비교 포함)**: 1-5ms
- **캐시 무효화**: < 0.1ms

### 최적화 권장사항

1. **버전 비교 최적화**: 버전 테이블 분리 또는 인덱스 최적화
2. **배치 조회**: 여러 키를 한 번에 조회하는 API 추가
3. **캐시 워밍업**: 서버 시작 시 모든 `always_load=true` 항목 미리 로드

## 마이그레이션

### 버전 필드 추가 (Migration 010)

```sql
ALTER TABLE core_memory ADD COLUMN version INTEGER NOT NULL DEFAULT 0;
UPDATE core_memory SET version = 1 WHERE version = 0;
CREATE INDEX idx_core_memory_version ON core_memory(version);
```

### 검증

서버 초기화 시 `version=0`인 행이 없음을 검증:

```typescript
const zeroVersionCount = db.prepare(`
  SELECT COUNT(*) as count FROM core_memory WHERE version = 0
`).get() as { count: number };

if (zeroVersionCount.count > 0) {
  throw new Error('Migration validation failed');
}
```

## 참고 자료

- [CoreMemory Service 구현](../src/domains/memory/services/core-memory-service.ts)
- [Cache Service 구현](../src/domains/memory/services/core-memory-cache-service.ts)
- [Migration 010](../src/infrastructure/database/database/migration/migrations/010-add-core-memory-version.ts)

