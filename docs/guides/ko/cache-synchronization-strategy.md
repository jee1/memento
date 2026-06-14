# CoreMemory 캐시 동기화 전략

CoreMemory는 에이전트가 핵심 정보에 빠르게 접근할 수 있도록 `always_load=true`로 표시된 항목들을 프로세스 메모리에 캐싱합니다. 이 문서는 현재 구현된 캐시 동기화 전략과 그 근거, 그리고 알려진 제한사항을 설명합니다.

## 현재 구현: 단일 서버 환경

Memento는 현재 단일 서버(단일 프로세스) 환경을 전제로 합니다. 이 환경에서 캐시와 데이터베이스는 같은 프로세스 내에서 관리되므로, 버전 필드를 비교하는 방식으로 캐시 무효화를 처리합니다.

```
Application Layer
      ↓
CoreMemoryService ──→ CoreMemoryCache (In-Memory)
      ↓
CoreMemoryRepo (SQLite)
```

서버가 시작될 때 `always_load=true`인 모든 항목을 캐시에 미리 로드합니다. 이후 `findByKey` 호출이 들어오면 캐시를 먼저 확인하고, 캐시에 없으면 DB에서 조회한 뒤 `always_load=true`이면 캐시에 추가합니다.

## 버전 기반 캐시 무효화

각 CoreMemory 레코드에는 단조 증가하는 `version` 필드가 있습니다. 레코드가 생성될 때 `version = 1`이 부여되고, 업데이트될 때마다 `version + 1`이 됩니다.

`findByKey`를 호출하면 다음 세 단계로 처리됩니다.

1. 캐시에서 항목을 조회합니다(CacheEntry: record, cachedAt, version).
2. DB에서 최신 레코드를 조회합니다.
3. 버전을 비교합니다. DB version이 캐시 version보다 크면 캐시를 무효화하고 최신 값을 다시 로드합니다. 버전이 같으면 캐시된 값을 그대로 반환합니다. DB version이 캐시 version보다 작으면 비정상 상태이므로 경고를 로그에 남기고 캐시된 값을 반환합니다.

이 방식은 DB 변경을 자동으로 감지하여 캐시를 갱신하므로, 추가적인 무효화 신호 없이도 일관성을 유지합니다.

## 명시적 무효화

`update`, `updateByKey`, `delete`, `deleteByKey`가 호출될 때는 DB 작업 직후 해당 항목의 캐시를 즉시 무효화합니다. `always_load=true`인 항목은 무효화 직후 DB에서 다시 로드됩니다.

이벤트 리스너를 통해 외부에서 캐시 무효화 이벤트를 감지할 수도 있습니다.

```typescript
cache.subscribeInvalidation({
  onInvalidate: (key, reason) => {
    // 특정 키가 무효화될 때 처리
  },
  onInvalidateAll: (reason) => {
    // 전체 캐시가 클리어될 때 처리
  }
});
```

## version=0 처리

`version=0`은 마이그레이션이 완료되지 않았거나 비정상 상태를 나타냅니다. 이 경우 항목은 항상 무효화 처리되며 경고 로그가 남습니다. 서버 초기화 시 `version=0`인 행이 없어야 한다는 검증이 수행됩니다.

```typescript
// 서버 초기화 검증 예시
const zeroVersionCount = db.prepare(`
  SELECT COUNT(*) as count FROM core_memory WHERE version = 0
`).get() as { count: number };

if (zeroVersionCount.count > 0) {
  throw new Error('CoreMemory 마이그레이션 검증 실패: version=0 행이 존재합니다');
}
```

마이그레이션 010이 이 `version` 컬럼과 관련 인덱스를 추가했습니다.

## 성능 특성

현재 구현의 캐시 조회는 JavaScript `Map`을 사용하므로 O(1)입니다. 그러나 버전 비교를 위해 매번 DB에 접근해야 한다는 오버헤드가 있습니다. 현재 실측 기준으로 캐시 조회와 무효화는 각각 0.1ms 미만이고, 버전 비교를 포함한 DB 조회는 1–5ms 수준입니다.

버전 비교 오버헤드를 줄이려면 버전만 담는 별도 경량 테이블을 분리하여 전체 레코드 조회 없이 버전만 확인하는 방식으로 개선할 수 있습니다.

## 분산 환경에서의 제한사항

현재 캐시는 단일 프로세스 내에서만 동작합니다. 복수의 서버 인스턴스가 동시에 실행되는 환경에서는, 서버 A의 업데이트가 서버 B의 캐시를 무효화하지 못하므로 데이터 불일치가 발생할 수 있습니다.

분산 환경을 지원하기 위한 접근 방식은 크게 세 가지입니다.

**Pub/Sub 메시지 큐** 방식은 DB 변경 시 메시지를 발행하고, 각 서버가 이를 구독하여 자신의 캐시를 무효화합니다. 실시간 동기화가 가능하지만 Redis나 RabbitMQ 같은 추가 인프라가 필요합니다.

**Change Data Capture(CDC)** 방식은 DB 변경 스트림을 직접 구독하여 캐시를 갱신합니다. DB 중심 아키텍처를 유지할 수 있지만 Debezium 같은 CDC 도구가 필요합니다.

**폴링 기반 동기화** 방식은 각 서버가 주기적으로 최신 버전을 조회하여 불일치를 감지합니다. 추가 인프라가 필요 없지만 실시간성이 낮고 DB 부하가 증가합니다.

현재 Memento는 단일 서버 환경을 기준으로 설계되어 있으므로, 분산 지원은 향후 요구가 생길 때 위 옵션 중 하나로 확장하는 방향을 고려할 수 있습니다.

## 참고 자료

- CoreMemory 서비스: `packages/memento-core/src/domains/memory/services/core-memory-service.ts`
- 캐시 서비스: `packages/memento-core/src/domains/memory/services/core-memory-cache-service.ts`
- 마이그레이션 010: `packages/memento-core/src/infrastructure/database/database/migration/migrations/010-add-core-memory-version.ts`
