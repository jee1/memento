## Relevant Files

### Phase 1: WAL 체크포인트 스케줄러 및 락 모니터
- `src/infrastructure/database/wal-checkpoint-scheduler.ts` - WAL 체크포인트 스케줄러 클래스 (주기적 체크포인트 실행)
- `src/infrastructure/database/wal-checkpoint-scheduler.spec.ts` - WAL 체크포인트 스케줄러 단위 테스트
- `src/database/database-lock-monitor.ts` - 데이터베이스 락 모니터 클래스 (락 감지 및 자동 해결)
- `src/database/database-lock-monitor.spec.ts` - 데이터베이스 락 모니터 단위 테스트
- `src/server/index.ts` - 서버 초기화 시 스케줄러 및 모니터 통합
- `src/server/bootstrap.ts` - 부트스트랩 함수에서 스케줄러 및 모니터 초기화

### Phase 2: CoreMemory 캐시 버전 관리 및 무효화
- `src/database/migrations/010-add-core-memory-version.sql` - core_memory 테이블에 version 컬럼 추가 마이그레이션 (SQL)
- `src/database/migrations/010-add-core-memory-version.ts` - core_memory 테이블에 version 컬럼 추가 마이그레이션 (TypeScript 구현체, Migration 인터페이스 구현)
- `src/domains/memory/repositories/core-memory-repository.interface.ts` - CoreMemoryRecord 인터페이스에 version 필드 추가
- `src/domains/memory/repositories/core-memory-repository.ts` - create/update 메서드에서 version 관리 로직 추가
- `src/domains/memory/repositories/core-memory-repository.spec.ts` - version 관리 로직 단위 테스트
- `src/domains/memory/services/core-memory-cache-service.ts` - 버전 기반 캐시 무효화 메커니즘 추가
- `src/domains/memory/services/core-memory-cache-service.spec.ts` - 버전 기반 캐시 무효화 테스트
- `src/domains/memory/services/core-memory-service.ts` - findByKey에서 버전 비교 및 자동 갱신 로직 추가
- `src/domains/memory/services/core-memory-service.spec.ts` - 버전 비교 및 자동 갱신 테스트
- `docs/ko/cache-synchronization-strategy.md` - 캐시 동기화 전략 문서

### Notes

- 단위 테스트는 각 파일과 동일한 디렉터리에 `*.spec.ts` 형식으로 작성됩니다.
- `npm test`로 모든 테스트를 실행할 수 있습니다.
- `npm test -- --coverage`로 테스트 커버리지를 확인할 수 있습니다 (목표: 80% 이상).
- `npm run lint`로 ESLint 검사를 실행할 수 있습니다.
- `npm run type-check`로 TypeScript 타입 체크를 실행할 수 있습니다.

### TDD (Test-Driven Development) 방법론 적용

모든 주요 작업은 **RED-GREEN-REFACTOR** 사이클을 따릅니다:

1. **RED**: 실패하는 테스트 작성 (Given/When/Then 형식)
   - Given: 테스트 전제 조건 설정
   - When: 테스트 대상 동작 실행
   - Then: 예상 결과 검증

2. **GREEN**: 테스트를 통과시키는 최소한의 코드 작성

3. **REFACTOR**: 코드 품질 개선 (클린코드 원칙 적용)

## Tasks

- [x] 1.0 WAL 체크포인트 스케줄러 구현
  - [x] 1.1 CheckpointMode enum 및 CheckpointResult interface 정의 (PASSIVE, TRUNCATE, FULL 모드)
  - [x] 1.2 WalCheckpointSchedulerConfig 인터페이스 정의 (intervalMs, walSizeWarningThreshold, walSizeDangerThreshold, useDedicatedConnection, maxRetries, retryBackoffMs)
  - [x] 1.3 WalCheckpointScheduler 클래스 기본 구조 구현 (constructor, start, stop 메서드)
  - [x] 1.4 executeCheckpoint 메서드 구현 (better-sqlite3 pragma 호출, 결과 파싱)
  - [x] 1.5 재시도 및 지수 백오프 로직 구현 (busy=1 처리, 최대 3회 재시도)
  - [x] 1.6 WAL 파일 크기 모니터링 구현 (getWalFileSize 메서드, fs.statSync 사용)
  - [x] 1.7 전용 커넥션 관리 로직 구현 (useDedicatedConnection 옵션, 커넥션 생성/종료)
  - [x] 1.8 동시 실행 방지 로직 구현 (checkpointInProgress 플래그)
  - [x] 1.9 WAL 크기 임계치 기반 TRUNCATE 모드 자동 전환 로직 구현
  - [x] 1.10 PerformanceMonitor 메트릭 수집 통합 (wal_checkpoint_duration, wal_file_size)
  - [x] 1.11 idempotent 동작 보장 (start/stop 중복 호출 처리)
  - [x] 1.12 단위 테스트 작성 (주기적 체크포인트, 재시도, WAL 크기 모니터링, idempotent 동작)

- [ ] 2.0 데이터베이스 락 모니터 구현
  - [ ] 2.1 LockStatus 및 DatabaseLockMonitorConfig 인터페이스 정의
  - [ ] 2.2 DatabaseLockMonitor 클래스 기본 구조 구현 (constructor, start, stop 메서드)
  - [ ] 2.3 IMMEDIATE 트랜잭션 기반 락 감지 로직 구현 (BEGIN IMMEDIATE TRANSACTION 시도, SQLITE_BUSY 에러 처리)
  - [ ] 2.4 단순 상태 확인 쿼리 기반 락 감지 로직 구현 (SELECT COUNT(*) FROM sqlite_master, 보조 방법)
  - [ ] 2.5 락 지속 시간 추적 로직 구현 (lockStartTime 기록, duration 계산)
  - [ ] 2.6 임계값 기반 경고 및 조치 로직 구현 (warning: 5초, danger: 30초, critical: 60초)
  - [ ] 2.7 락 감지 시 체크포인트 스케줄러 연동 (checkpointScheduler.checkpointNow 호출)
  - [ ] 2.8 PerformanceMonitor 메트릭 수집 통합 (database_lock_duration, database_lock_count)
  - [ ] 2.9 busy_timeout 초과 통계 추적 (busyCount 증가, 시간당 발생 횟수 모니터링)
  - [ ] 2.10 idempotent 동작 보장 (start/stop 중복 호출 처리)
  - [ ] 2.11 단위 테스트 작성 (락 감지, 임계값 기반 경고, 메트릭 수집, idempotent 동작)

- [ ] 3.0 서버 초기화 통합
  - [ ] 3.1 bootstrap.ts에서 WalCheckpointScheduler 인스턴스 생성 (환경 변수 기반 설정 로드)
  - [ ] 3.2 bootstrap.ts에서 DatabaseLockMonitor 인스턴스 생성 (환경 변수 기반 설정 로드)
  - [ ] 3.3 ServerServices 인터페이스에 스케줄러 및 모니터 필드 추가
  - [ ] 3.4 initializeServices 함수에서 스케줄러 및 모니터 초기화 및 start() 호출
  - [ ] 3.5 서버 종료 훅에서 스케줄러 및 모니터 stop() 호출 (process.on('SIGINT'), process.on('SIGTERM'))
  - [ ] 3.6 환경 변수 설정 추가 (WAL_CHECKPOINT_INTERVAL_MS, LOCK_MONITOR_INTERVAL_MS 등)
  - [ ] 3.7 기존 monitorDatabaseStatus 함수 제거 또는 스케줄러로 대체
  - [ ] 3.8 통합 테스트 작성 (서버 시작 시 스케줄러 시작, 서버 종료 시 정리)

- [ ] 4.0 CoreMemory 캐시 버전 관리 및 무효화 개선
  - [ ] 4.1 마이그레이션 파일 생성 (src/database/migrations/010-add-core-memory-version.sql, src/database/migrations/010-add-core-memory-version.ts)
  - [ ] 4.2 마이그레이션 SQL 작성 (ALTER TABLE core_memory ADD COLUMN version INTEGER NOT NULL DEFAULT 0)
  - [ ] 4.3 마이그레이션 SQL 작성 (CREATE INDEX idx_core_memory_version ON core_memory(version))
  - [ ] 4.4 마이그레이션 SQL 작성 (기존 행에 version = 1 설정)
  - [ ] 4.5 마이그레이션 완료 검증 SQL 작성 (SELECT COUNT(*) FROM core_memory WHERE version = 0)
  - [ ] 4.6 마이그레이션 TypeScript 구현체 작성 (Migration 인터페이스 구현, up/down 메서드, validateBefore/validateAfter 메서드)
  - [ ] 4.7 CoreMemoryRecord 인터페이스에 version 필드 추가 (number 타입)
  - [ ] 4.8 CoreMemoryRepository 구현체에서 create 메서드에 version = 1 설정 로직 추가
  - [ ] 4.9 CoreMemoryRepository 구현체에서 update 메서드에 version = version + 1 설정 로직 추가
  - [ ] 4.10 CoreMemoryCacheService에 CacheEntry 인터페이스 추가 (record, cachedAt, version 필드)
  - [ ] 4.11 CoreMemoryCacheService의 set 메서드에서 version 저장 로직 추가 (version=0 경고 로그)
  - [ ] 4.12 CoreMemoryCacheService에 getWithVersion 메서드 추가
  - [ ] 4.13 CoreMemoryCacheService에 invalidateByVersion 메서드 추가 (버전 비교, version=0 처리)
  - [ ] 4.14 CacheInvalidationListener 인터페이스 정의 (onInvalidate, onInvalidateAll)
  - [ ] 4.15 CoreMemoryCacheService에 이벤트 리스너 메커니즘 추가 (subscribeInvalidation, unsubscribeInvalidation)
  - [ ] 4.16 CoreMemoryCacheService의 invalidate/clear 메서드에서 리스너 알림 로직 추가
  - [ ] 4.17 CoreMemoryService의 findByKey 메서드에서 버전 비교 및 자동 갱신 로직 추가 (DB 조회 시 버전 비교, 불일치 시 캐시 무효화 및 재로드)
  - [ ] 4.18 CoreMemoryService의 update/delete 메서드에서 캐시 무효화 로직 추가
  - [ ] 4.19 서버 초기화 시 마이그레이션 완료 검증 로직 추가 (version=0인 행이 없어야 함)
  - [ ] 4.20 단위 테스트 작성 (version 관리, 버전 비교, 캐시 무효화, 이벤트 리스너)

- [ ] 5.0 문서화 및 테스트
  - [ ] 5.1 캐시 동기화 전략 문서 작성 (docs/ko/cache-synchronization-strategy.md)
  - [ ] 5.2 문서에 현재 단일 서버 환경에서의 캐시 동작 설명 추가
  - [ ] 5.3 문서에 분산 환경으로 전환 시 고려사항 추가 (Pub/Sub, DB 변경 피드)
  - [ ] 5.4 문서에 캐시 무효화 전략 설명 추가
  - [ ] 5.5 문서에 향후 개선 방향 추가 (Redis 등 외부 캐시 도입)
  - [ ] 5.6 통합 테스트 작성 (스케줄러와 모니터 통합, 캐시 버전 관리 통합)
  - [ ] 5.7 실제 락 시나리오 테스트 작성 (멀티프로세스 동시 쓰기, 장기 트랜잭션)
  - [ ] 5.8 성능 테스트 작성 (WAL 체크포인트 오버헤드, 락 모니터링 오버헤드, 캐시 동기화 성능)

