# PRD: 데이터베이스 락 및 캐시 동기화 개선

## 문제 정의

### 1. SQLite 데이터베이스 락 위험
- **현재 상황**: `better-sqlite3`를 통해 직접 조작할 때, 동시성 처리가 제대로 되지 않으면 데이터베이스 락이 발생할 수 있음
- **현재 대응**: `index.ts`에서 세마포어를 통해 동시 처리를 제한(최대 20개)
- **문제점**: 
  - WAL(Write-Ahead Logging) 관리와 체크포인트 전략이 수동으로만 실행됨
  - `monitorDatabaseStatus()`가 초기화 시에만 실행됨
  - 주기적인 WAL 체크포인트가 없어 WAL 파일이 계속 증가할 수 있음

### 2. 캐시 동기화 문제
- **현재 상황**: `CoreMemoryService`에서 `always_load=true` 항목을 로컬 메모리 캐시에 저장
- **문제점**: 
  - 분산 서버 환경(M2+ 마일스톤)으로 전환될 경우 로컬 메모리 캐시와 DB 간의 데이터 불일치가 발생할 수 있음
  - 여러 서버 인스턴스가 각각 로컬 캐시를 가지면 동기화 문제 발생
  - 캐시 무효화 메커니즘이 부족함

## 해결 방안

### Phase 1: WAL 자동 체크포인트 스케줄러

#### 1.1 WAL 체크포인트 스케줄러 구현
- **목적**: 주기적으로 WAL 체크포인트를 실행하여 락 위험 감소
- **구현 위치**: `src/infrastructure/database/wal-checkpoint-scheduler.ts`

##### PRAGMA 설정 명시
- **현재 설정** (초기화 시 적용됨):
  - `journal_mode = WAL` (Write-Ahead Logging 모드)
  - `busy_timeout = 60000` (60초)
  - `synchronous = NORMAL` (성능과 안정성 균형)
  - `wal_autocheckpoint = 100` (WAL 페이지 100개마다 자동 체크포인트)
  - `journal_size_limit = 33554432` (32MB, WAL 파일 최대 크기)
- **스케줄러 동작**:
  - 주기적 체크포인트는 `wal_autocheckpoint`와 별도로 실행 (수동 체크포인트)
  - `wal_autocheckpoint`는 SQLite 내부 메커니즘이므로 유지

##### 체크포인트 모드 선택 기준
- **PASSIVE 모드** (기본):
  - 다른 연결이 읽기 중이면 체크포인트를 건너뜀
  - 성능 영향 최소화
  - 주기적 체크포인트에 사용
- **TRUNCATE 모드**:
  - WAL 파일을 완전히 제거 (디스크 공간 절약)
  - 락 감지 시 또는 WAL 파일 크기 임계치 초과 시 사용
- **FULL 모드**:
  - 모든 페이지를 메인 DB로 이동 후 WAL 파일 제거
  - 장기 트랜잭션이 없을 때만 사용
  - 서버 종료 시 또는 수동 요청 시 사용

##### 체크포인트 실행 방식
- **전용 커넥션 사용** (권장):
  - 메인 DB 연결과 분리된 전용 연결 생성
  - 장기 트랜잭션으로 인한 체크포인트 실패 방지
  - 체크포인트 중에도 메인 연결에서 작업 가능
- **동일 연결 사용** (대안):
  - 메인 연결에서 직접 체크포인트 실행
  - 장기 트랜잭션 중에는 체크포인트 실패 가능
  - 단일 연결 환경에서만 사용

##### 재시도 및 백오프 전략
- **체크포인트 실패 시**:
  - 최대 3회 재시도
  - 지수 백오프: 1초, 2초, 4초
  - 재시도 실패 시 다음 주기까지 대기
- **락 감지 시**:
  - 즉시 체크포인트 시도 (TRUNCATE 모드)
  - 실패 시 PASSIVE 모드로 재시도
  - 최대 3회 재시도 후 다음 주기까지 대기

##### 시작/종료 시점 (Idempotent)
- **start() 메서드**:
  - 이미 실행 중이면 무시 (idempotent)
  - `isRunning` 플래그로 중복 실행 방지
  - 타이머가 이미 설정되어 있으면 재설정하지 않음
- **stop() 메서드**:
  - 타이머 정리 및 리소스 해제
  - 여러 번 호출해도 안전 (idempotent)
  - 서버 종료 훅에서 반드시 호출

##### WAL 파일 크기 모니터링
- **모니터링 방법**:
  - WAL 파일 직접 크기 확인 (`.db-wal` 파일)
  - 파일 시스템 API를 통한 크기 조회 (읽기 전용, 락 유발 없음)
- **임계치 설정**:
  - 경고: 16MB (journal_size_limit의 50%)
  - 위험: 24MB (journal_size_limit의 75%)
  - 임계치 초과 시 TRUNCATE 모드 체크포인트 실행
- **알람 경로**:
  - 로거를 통한 경고 로그 출력
  - `PerformanceMonitor`를 통한 메트릭 수집
  - 필요 시 `ErrorLoggingService`를 통한 에러 로깅

#### 1.2 데이터베이스 락 모니터링 강화
- **목적**: 데이터베이스 락을 주기적으로 모니터링하고 자동으로 해결
- **구현 위치**: `src/infrastructure/database/database-lock-monitor.ts`

##### 락 감지 방법
- **IMMEDIATE 트랜잭션 시도** (주요 방법):
  - `BEGIN IMMEDIATE TRANSACTION` 시도
  - `SQLITE_BUSY` 에러 발생 시 락 상태로 판단
  - 즉시 `ROLLBACK` 실행하여 락 해제
  - 관측만 수행하며 실제 체크포인트를 유발하지 않음
- **단순 상태 확인 쿼리** (보조 방법):
  - `SELECT COUNT(*) FROM sqlite_master` 실행
  - 읽기 전용 작업이므로 락을 유발하지 않음
  - `SQLITE_BUSY` 에러 발생 시 락 상태로 판단
- **busy_timeout 초과 통계**:
  - `SQLITE_BUSY` 에러 발생 횟수 추적
  - 시간당 발생 횟수 모니터링
  - 임계치 초과 시 경고
- **주의사항**:
  - `PRAGMA wal_checkpoint(PASSIVE)`는 실제 체크포인트를 시도하므로 모니터링 전용으로는 사용하지 않음
  - 관측과 행위를 분리하여 모니터링만 수행

##### 락 지속 시간 추적 및 경고
- **추적 방법**:
  - 락 감지 시점 기록
  - 주기적 확인 시 지속 시간 계산
  - 최대 지속 시간 기록
- **임계값 설정**:
  - 경고: 5초 이상 지속
  - 위험: 30초 이상 지속
  - 치명적: 60초 이상 지속 (busy_timeout과 동일)
- **경고 동작**:
  - 경고: 로그 출력
  - 위험: 로그 출력 + 체크포인트 시도
  - 치명적: 로그 출력 + 체크포인트 시도 + 에러 로깅

##### 로깅 및 메트릭 설계
- **로깅**:
  - 락 감지 시: `warn` 레벨
  - 락 해제 시: `info` 레벨
  - 락 지속 시간: `warn` 또는 `error` 레벨 (임계값에 따라)
- **메트릭 수집**:
  - 락 발생 횟수 (카운터)
  - 락 지속 시간 (히스토그램)
  - 체크포인트 성공/실패 횟수 (카운터)
  - WAL 파일 크기 (게이지)
- **메트릭 전달**:
  - `PerformanceMonitor`를 통한 메트릭 수집
  - 필요 시 외부 모니터링 시스템 연동

#### 1.3 서버 초기화 시 통합
- **목적**: WAL 체크포인트 스케줄러와 락 모니터를 서버 초기화 시 시작
- **구현 위치**: `src/server/index.ts`, `src/server/bootstrap.ts`
- **기능**:
  - 서버 시작 시 스케줄러 시작
  - 서버 종료 시 스케줄러 정리

### Phase 2: CoreMemoryService 캐시 동기화 개선

#### 2.1 캐시 버전 관리 추가
- **목적**: 캐시 항목의 버전을 관리하여 무효화 판단
- **구현 위치**: `src/domains/memory/services/core-memory-cache-service.ts`

##### updated_at 기반 버전의 한계 인정
- **문제점**:
  - 동일 초 단위 업데이트 시 버전 충돌 가능
  - Clock Skew로 인한 시간 불일치
  - DB와 캐시의 동시 업데이트 시 선후관계 보장 어려움
- **해결 방안**: 단조 증가하는 `version` 컬럼 추가

##### 단조 증가 version 컬럼 추가
- **스키마 변경**:
  ```sql
  ALTER TABLE core_memory ADD COLUMN version INTEGER NOT NULL DEFAULT 0;
  CREATE INDEX idx_core_memory_version ON core_memory(version);
  ```
- **마이그레이션 절차**:
  1. **스키마 마이그레이션**:
     - 마이그레이션 파일 생성: `src/infrastructure/database/migrations/add_core_memory_version.sql`
     - 기존 행에 version 값 설정:
       ```sql
       -- 기존 행에 version = 1 설정 (초기값)
       UPDATE core_memory SET version = 1 WHERE version = 0;
       ```
     - **안전장치**: 마이그레이션 완료 확인
       ```sql
       -- 마이그레이션 완료 확인: version=0인 행이 없어야 함
       SELECT COUNT(*) as zero_version_count FROM core_memory WHERE version = 0;
       -- 결과가 0이 아니면 마이그레이션 실패로 간주
       ```
  2. **애플리케이션 레벨 버전 증가**:
     - `CoreMemoryRepository`의 `create()` 메서드: `version = 1` 설정
     - `CoreMemoryRepository`의 `update()` 메서드: `version = version + 1` 설정
     - 트리거 대신 애플리케이션 레벨에서 관리 (더 명확하고 디버깅 용이)
  3. **트리거 기반 변경 로그** (선택사항, 분산 환경용):
     ```sql
     CREATE TABLE IF NOT EXISTS core_memory_change_log (
       core_id TEXT NOT NULL,
       old_version INTEGER,
       new_version INTEGER,
       changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
       FOREIGN KEY (core_id) REFERENCES core_memory(core_id)
     );
     
     CREATE TRIGGER IF NOT EXISTS core_memory_version_log
     AFTER UPDATE OF version ON core_memory
     FOR EACH ROW
     WHEN OLD.version != NEW.version
     BEGIN
       INSERT INTO core_memory_change_log (core_id, old_version, new_version)
       VALUES (NEW.core_id, OLD.version, NEW.version);
     END;
     ```
     - 변경 이력을 추적하여 분산 환경에서 동기화에 활용 가능
     - 트리거는 선택사항이며, 애플리케이션 레벨 버전 관리가 우선
- **버전 관리 전략**:
  - INSERT 시: `version = 1` (애플리케이션 레벨)
  - UPDATE 시: `version = version + 1` (애플리케이션 레벨)
  - 단조 증가 보장: 항상 증가만 하므로 비교 가능
  - 캐시 저장 시: 실제 `version` 컬럼 값 사용
- **안전장치**:
  - **마이그레이션 완료 전 초기화 실패**: 마이그레이션이 완료되지 않았으면 서버 시작 시 에러 발생
  - **0 버전 금지**: 운영 환경에서는 version=0인 항목이 캐시에 들어오면 경고 로그 출력
  - **버전 비교 시 0 처리**: 캐시에 version=0인 항목이 있으면 항상 무효화 (마이그레이션 미완료로 간주)
  - **마이그레이션 검증**: 서버 시작 시 `SELECT COUNT(*) FROM core_memory WHERE version = 0` 실행하여 0이 아니면 에러

##### 초기 always_load 로딩 시점 및 무효화 경로
- **초기 로딩 시점**:
  - 서버 시작 시 `initializeDatabase()`에서 실행
  - `CoreMemoryService.findAlwaysLoad()` 호출
  - DB에서 조회 후 캐시에 로드
- **무효화 경로**:
  1. **업데이트 시**: `update()` 메서드에서 캐시 무효화
  2. **삭제 시**: `delete()` 메서드에서 캐시 무효화
  3. **버전 불일치 시**: `findByKey()`에서 DB 조회 시 버전 비교 후 무효화
  4. **수동 무효화**: `reloadCache()` 메서드로 전체 재로드
- **오래된 스냅샷 방지**:
  - `findByKey()` 호출 시 항상 버전 비교
  - 버전 불일치 시 자동 갱신
  - 주기적 검증 (선택사항): 백그라운드 작업으로 주기적으로 검증

#### 2.2 캐시 무효화 메커니즘 개선
- **목적**: 분산 환경에서도 동작할 수 있는 캐시 무효화 메커니즘
- **구현 위치**: `src/domains/memory/services/core-memory-service.ts`

##### 이벤트 리스너 추가 (단일 서버 환경)
- **인터페이스 확장**:
  ```typescript
  interface CacheInvalidationListener {
    onInvalidate(key: string): void;
    onInvalidateAll(): void;
  }
  ```
- **기능**:
  - 캐시 무효화 시 리스너에게 알림
  - 단일 서버 환경에서 내부 동기화에 활용

##### 분산 환경 대비 전략
- **현재 단계 (M1)**: 단일 서버 환경 가정
  - 로컬 메모리 캐시만 사용
  - 이벤트 리스너는 내부 동기화용
- **향후 단계 (M2+)**: 분산 환경 전환 시
  - **Pub/Sub 채널** (예: Redis Pub/Sub):
    - `core_memory:invalidate:{agent_id}:{key}` 채널
    - `core_memory:invalidate:all` 채널
    - 변경 시 Pub/Sub으로 브로드캐스트
    - 다른 노드에서 수신 후 로컬 캐시 무효화
  - **DB 변경 피드** (대안):
    - `core_memory_change_log` 테이블 기반
    - 주기적으로 변경 로그 조회
    - 변경된 항목만 캐시 무효화
  - **재시도 및 멱등 설계**:
    - 무효화 이벤트에 고유 ID 부여
    - 중복 수신 시 무시 (멱등성 보장)
    - 전송 실패 시 재시도 (지수 백오프)
  - **네트워크 분단 시 처리**:
    - 이벤트 유실 가능성 인정
    - `findByKey()` 호출 시 항상 버전 비교 (최종 방어선)
    - 주기적 전체 검증으로 불일치 복구

##### 인터페이스 확장
- **현재 인터페이스**:
  ```typescript
  interface CoreMemoryCache {
    set(key: string, value: CoreMemoryRecord): void;
    get(key: string): CoreMemoryRecord | undefined;
    delete(key: string): void;
    getAll(): CoreMemoryRecord[];
    clear(): void;
    size(): number;
  }
  ```
- **확장 인터페이스** (분산 환경 대비):
  ```typescript
  interface DistributedCacheInvalidation {
    invalidateByVersion(key: string, version: number): boolean;
    subscribeInvalidation(listener: CacheInvalidationListener): void;
    publishInvalidation(key: string, version: number): Promise<void>;
  }
  ```

#### 2.3 캐시 동기화 전략 문서화
- **목적**: 분산 환경에서의 캐시 동기화 전략 명확화
- **구현 위치**: `docs/ko/cache-synchronization-strategy.md`
- **내용**:
  - 현재 단일 서버 환경에서의 캐시 동작
  - 분산 환경으로 전환 시 고려사항
  - 캐시 무효화 전략
  - 향후 개선 방향 (Redis 등 외부 캐시 도입)

## 구현 세부사항

### WAL 체크포인트 스케줄러

```typescript
// src/infrastructure/database/wal-checkpoint-scheduler.ts
export enum CheckpointMode {
  PASSIVE = 'PASSIVE',
  TRUNCATE = 'TRUNCATE',
  FULL = 'FULL'
}

export interface CheckpointResult {
  mode: CheckpointMode;
  success: boolean;
  log: number; // WAL 파일의 페이지 수
  checkpointed: number; // 체크포인트된 페이지 수
  busy: number; // 락 상태 (1: 락, 0: 정상)
  error?: Error;
}

export interface WalCheckpointSchedulerConfig {
  intervalMs: number; // 기본: 5분
  walSizeWarningThreshold: number; // 기본: 16MB
  walSizeDangerThreshold: number; // 기본: 24MB
  useDedicatedConnection: boolean; // 기본: true
  maxRetries: number; // 기본: 3
  retryBackoffMs: number; // 기본: 1000
}

export class WalCheckpointScheduler {
  private intervalId: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;
  private dedicatedConnection: Database.Database | null = null;
  private lastCheckpointTime: number = 0;
  private checkpointInProgress: boolean = false; // 동시 실행 방지 플래그
  
  constructor(
    private mainDb: Database.Database,
    private config: WalCheckpointSchedulerConfig,
    private logger?: Logger,
    private performanceMonitor?: PerformanceMonitor
  ) {}
  
  /**
   * 스케줄러 시작 (idempotent)
   */
  start(): void {
    if (this.isRunning) {
      this.logger?.warn('WAL 체크포인트 스케줄러가 이미 실행 중입니다');
      return;
    }
    
    this.isRunning = true;
    
    // 전용 커넥션 생성 (필요 시)
    if (this.config.useDedicatedConnection) {
      this.dedicatedConnection = new Database(this.mainDb.name);
      this.dedicatedConnection.pragma('journal_mode = WAL');
    }
    
    // 주기적 체크포인트 시작
    this.scheduleCheckpoint();
    
    this.logger?.info('WAL 체크포인트 스케줄러 시작됨', {
      intervalMs: this.config.intervalMs,
      useDedicatedConnection: this.config.useDedicatedConnection
    });
  }
  
  /**
   * 스케줄러 중지 (idempotent, 비동기)
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }
    
    // 타이머 정리
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    
    // 최종 FULL 체크포인트 실행 (await로 완료 대기)
    try {
      await this.checkpoint(CheckpointMode.FULL);
    } catch (error) {
      this.logger?.warn('종료 시 체크포인트 실패', { error });
    }
    
    // 전용 커넥션 종료 (체크포인트 완료 후)
    if (this.dedicatedConnection) {
      this.dedicatedConnection.close();
      this.dedicatedConnection = null;
    }
    
    this.isRunning = false;
    this.logger?.info('WAL 체크포인트 스케줄러 중지됨');
  }
  
  /**
   * 주기적 체크포인트 스케줄링
   * 동시 실행 방지: checkpointInProgress 플래그로 중첩 실행 방지
   */
  private scheduleCheckpoint(): void {
    this.intervalId = setInterval(async () => {
      // 이미 체크포인트가 진행 중이면 스킵
      if (this.checkpointInProgress) {
        this.logger?.warn('체크포인트가 이미 진행 중입니다. 이번 주기는 스킵합니다.');
        return;
      }
      
      try {
        await this.checkpoint(CheckpointMode.PASSIVE);
      } catch (error) {
        this.logger?.error('주기적 체크포인트 실패', { error });
      }
    }, this.config.intervalMs);
  }
  
  /**
   * 즉시 체크포인트 실행
   */
  async checkpointNow(mode: CheckpointMode = CheckpointMode.TRUNCATE): Promise<CheckpointResult> {
    return this.checkpoint(mode);
  }
  
  /**
   * 체크포인트 실행 (재시도 로직 포함)
   * busy=1인 경우도 실패로 간주하여 재시도 수행
   */
  private async checkpoint(mode: CheckpointMode): Promise<CheckpointResult> {
    // 동시 실행 방지
    if (this.checkpointInProgress) {
      throw new Error('체크포인트가 이미 진행 중입니다');
    }
    
    this.checkpointInProgress = true;
    const db = this.config.useDedicatedConnection && this.dedicatedConnection
      ? this.dedicatedConnection
      : this.mainDb;
    
    let lastError: Error | undefined;
    const checkpointStartTime = Date.now(); // 실제 체크포인트 실행 시간 측정용
    
    try {
      for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
        try {
          const result = this.executeCheckpoint(db, mode);
          
          // busy=1이면 실패로 간주하고 재시도
          if (result.busy === 1 || !result.success) {
            lastError = new Error(`체크포인트 실패: busy=${result.busy}, success=${result.success}`);
            
            if (attempt < this.config.maxRetries) {
              const backoffMs = this.config.retryBackoffMs * Math.pow(2, attempt - 1);
              this.logger?.warn(`체크포인트 실패 (busy=${result.busy}), ${backoffMs}ms 후 재시도`, { attempt, result });
              await this.sleep(backoffMs);
              continue; // 재시도
            } else {
              // 최대 재시도 횟수 초과
              return {
                mode,
                success: false,
                log: result.log || 0,
                checkpointed: result.checkpointed || 0,
                busy: result.busy || 1,
                error: lastError
              };
            }
          }
          
          // 성공한 경우에만 WAL 파일 크기 확인 및 메트릭 수집
          const walSize = await this.getWalFileSize();
          
          // WAL 크기가 위험 임계치를 넘으면 TRUNCATE 모드로 재시도 (루프 내에서 처리)
          if (walSize > this.config.walSizeDangerThreshold && mode !== CheckpointMode.TRUNCATE) {
            this.logger?.warn('WAL 파일 크기 위험, TRUNCATE 모드로 재시도', { walSize, threshold: this.config.walSizeDangerThreshold });
            // TRUNCATE 모드로 재시도 (내부 루프로 처리)
            const truncateResult = this.executeCheckpoint(db, CheckpointMode.TRUNCATE);
            if (truncateResult.success && truncateResult.busy === 0) {
              // TRUNCATE 성공 시에만 메트릭 수집 및 반환
              const duration = Date.now() - checkpointStartTime; // 실제 실행 시간 측정
              if (this.performanceMonitor) {
                this.performanceMonitor.recordMetric('wal_checkpoint_duration', duration);
                this.performanceMonitor.recordMetric('wal_file_size', await this.getWalFileSize());
              }
              this.lastCheckpointTime = Date.now();
              return truncateResult;
            }
            // TRUNCATE 실패 시 원래 결과 사용 (성공했으므로)
          } else if (walSize > this.config.walSizeWarningThreshold) {
            this.logger?.warn('WAL 파일 크기 경고', { walSize, threshold: this.config.walSizeWarningThreshold });
          }
          
          // 성공 시에만 메트릭 수집 (실제 실행 시간 측정)
          const duration = Date.now() - checkpointStartTime;
          if (this.performanceMonitor) {
            this.performanceMonitor.recordMetric('wal_checkpoint_duration', duration);
            this.performanceMonitor.recordMetric('wal_file_size', walSize);
          }
          
          // 첫 체크포인트 시 lastCheckpointTime 설정
          if (this.lastCheckpointTime === 0) {
            this.lastCheckpointTime = Date.now();
          } else {
            this.lastCheckpointTime = Date.now();
          }
          
          return result;
        } catch (error) {
          lastError = error as Error;
          
          if (attempt < this.config.maxRetries) {
            const backoffMs = this.config.retryBackoffMs * Math.pow(2, attempt - 1);
            this.logger?.warn(`체크포인트 실패, ${backoffMs}ms 후 재시도`, { attempt, error });
            await this.sleep(backoffMs);
          }
        }
      }
      
      // 모든 재시도 실패
      return {
        mode,
        success: false,
        log: 0,
        checkpointed: 0,
        busy: 1,
        error: lastError
      };
    } finally {
      this.checkpointInProgress = false;
    }
  }
  
  /**
   * 체크포인트 실행 (실제 SQL 실행)
   * better-sqlite3의 pragma는 { simple: true } 옵션 없이 호출 시 배열을 반환할 수 있음
   */
  private executeCheckpoint(db: Database.Database, mode: CheckpointMode): CheckpointResult {
    // better-sqlite3의 pragma는 객체를 반환하지만, 안전하게 처리
    const result = db.pragma(`wal_checkpoint(${mode})`, { simple: true }) as any;
    
    // 결과가 배열인 경우 첫 번째 요소 사용
    const checkpointData = Array.isArray(result) ? result[0] : result;
    
    return {
      mode,
      success: checkpointData?.busy === 0,
      log: checkpointData?.log || 0,
      checkpointed: checkpointData?.checkpointed || 0,
      busy: checkpointData?.busy || 0
    };
  }
  
  /**
   * WAL 파일 크기 조회
   */
  private async getWalFileSize(): Promise<number> {
    // .db-wal 파일 크기 확인
    const walPath = `${this.mainDb.name}-wal`;
    try {
      const fs = await import('fs');
      const stats = fs.statSync(walPath);
      return stats.size;
    } catch (error) {
      return 0;
    }
  }
  
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
```

### 데이터베이스 락 모니터

```typescript
// src/infrastructure/database/database-lock-monitor.ts
export interface LockStatus {
  isLocked: boolean;
  lockDuration: number; // 밀리초
  detectionMethod: 'wal_checkpoint' | 'immediate_transaction' | 'busy_timeout';
  busyCount: number; // busy_timeout 초과 횟수
}

export interface DatabaseLockMonitorConfig {
  intervalMs: number; // 기본: 1분
  warningThresholdMs: number; // 기본: 5초
  dangerThresholdMs: number; // 기본: 30초
  criticalThresholdMs: number; // 기본: 60초
}

export class DatabaseLockMonitor {
  private intervalId: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;
  private lockStartTime: number | null = null;
  private busyCount: number = 0;
  
  constructor(
    private db: Database.Database,
    private config: DatabaseLockMonitorConfig,
    private logger?: Logger,
    private performanceMonitor?: PerformanceMonitor,
    private checkpointScheduler?: WalCheckpointScheduler
  ) {}
  
  /**
   * 모니터 시작 (idempotent)
   */
  start(): void {
    if (this.isRunning) {
      this.logger?.warn('데이터베이스 락 모니터가 이미 실행 중입니다');
      return;
    }
    
    this.isRunning = true;
    this.monitor();
    
    this.logger?.info('데이터베이스 락 모니터 시작됨', {
      intervalMs: this.config.intervalMs
    });
  }
  
  /**
   * 모니터 중지 (idempotent)
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }
    
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    
    this.isRunning = false;
    this.lockStartTime = null;
    this.busyCount = 0;
    
    this.logger?.info('데이터베이스 락 모니터 중지됨');
  }
  
  /**
   * 주기적 모니터링
   */
  private monitor(): void {
    this.intervalId = setInterval(async () => {
      try {
        const status = await this.checkLockStatus();
        this.handleLockStatus(status);
      } catch (error) {
        this.logger?.error('락 모니터링 실패', { error });
      }
    }, this.config.intervalMs);
  }
  
  /**
   * 락 상태 확인
   * 주의: PRAGMA wal_checkpoint(PASSIVE)는 실제 체크포인트를 시도하므로,
   * 모니터링만을 위해서는 IMMEDIATE 트랜잭션 시도 방법을 우선 사용
   */
  private async checkLockStatus(): Promise<LockStatus> {
    // 방법 1: IMMEDIATE 트랜잭션 시도 (관측만 수행, 실제 체크포인트 유발 없음)
    try {
      this.db.prepare('BEGIN IMMEDIATE TRANSACTION').run();
      this.db.prepare('ROLLBACK').run();
      // 트랜잭션 성공 = 락 없음
    } catch (error: any) {
      if (error.code === 'SQLITE_BUSY') {
        this.busyCount++;
        return {
          isLocked: true,
          lockDuration: this.lockStartTime ? Date.now() - this.lockStartTime : 0,
          detectionMethod: 'immediate_transaction',
          busyCount: this.busyCount
        };
      }
      // 다른 에러는 락이 아닐 수 있음
    }
    
    // 방법 2: 단순 상태 확인 쿼리 (읽기 전용, 락 유발 없음)
    // sqlite_master 테이블 조회는 읽기 작업이므로 락을 유발하지 않음
    try {
      this.db.prepare('SELECT COUNT(*) FROM sqlite_master').get();
    } catch (error: any) {
      if (error.code === 'SQLITE_BUSY') {
        this.busyCount++;
        return {
          isLocked: true,
          lockDuration: this.lockStartTime ? Date.now() - this.lockStartTime : 0,
          detectionMethod: 'busy_timeout',
          busyCount: this.busyCount
        };
      }
    }
    
    // 락이 해제됨
    if (this.lockStartTime) {
      const duration = Date.now() - this.lockStartTime;
      this.logger?.info('데이터베이스 락 해제됨', { duration });
      this.lockStartTime = null;
      this.busyCount = 0;
    }
    
    return {
      isLocked: false,
      lockDuration: 0,
      detectionMethod: 'immediate_transaction',
      busyCount: 0
    };
  }
  
  /**
   * 락 상태 처리
   */
  private async handleLockStatus(status: LockStatus): Promise<void> {
    if (!status.isLocked) {
      return;
    }
    
    // 락 시작 시간 기록
    if (!this.lockStartTime) {
      this.lockStartTime = Date.now();
    }
    
    const duration = status.lockDuration;
    
    // 메트릭 수집
    if (this.performanceMonitor) {
      this.performanceMonitor.recordMetric('database_lock_duration', duration);
      this.performanceMonitor.incrementCounter('database_lock_count');
    }
    
    // 임계값 기반 경고 및 조치
    if (duration >= this.config.criticalThresholdMs) {
      this.logger?.error('데이터베이스 락 치명적', { duration, status });
      // 체크포인트 시도
      if (this.checkpointScheduler) {
        await this.checkpointScheduler.checkpointNow();
      }
    } else if (duration >= this.config.dangerThresholdMs) {
      this.logger?.warn('데이터베이스 락 위험', { duration, status });
      // 체크포인트 시도
      if (this.checkpointScheduler) {
        await this.checkpointScheduler.checkpointNow();
      }
    } else if (duration >= this.config.warningThresholdMs) {
      this.logger?.warn('데이터베이스 락 경고', { duration, status });
    }
  }
}
```

### 캐시 버전 관리

```typescript
// src/domains/memory/services/core-memory-cache-service.ts
interface CacheEntry {
  record: CoreMemoryRecord;
  cachedAt: number; // 캐시된 시간
  version: number; // version 컬럼 값 (단조 증가)
}

export class CoreMemoryCacheService implements CoreMemoryCache {
  private cache: Map<string, CacheEntry> = new Map();
  private invalidationListeners: Set<CacheInvalidationListener> = new Set();
  
  get(key: string): CoreMemoryRecord | undefined {
    const entry = this.cache.get(key);
    return entry?.record;
  }
  
  getWithVersion(key: string): { record: CoreMemoryRecord; version: number } | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    return { record: entry.record, version: entry.version };
  }
  
  set(key: string, value: CoreMemoryRecord): void {
    // version 컬럼 값 사용
    // 안전장치: 마이그레이션 완료 전에는 version이 0일 수 있으므로 검증 필요
    const version = value.version ?? 0;
    
    // 마이그레이션 실패/부분 적용 시 0 버전이 들어오면 경고
    // 실제 운영 환경에서는 마이그레이션 완료 후에만 캐시 사용해야 함
    if (version === 0) {
      // 개발/테스트 환경에서는 허용하되 경고 로그
      // 운영 환경에서는 마이그레이션 완료를 전제로 하므로 0 버전은 예외 처리
      console.warn(`캐시에 version=0인 항목이 저장되었습니다. 마이그레이션이 완료되지 않았을 수 있습니다.`, { key });
    }
    
    this.cache.set(key, {
      record: value,
      cachedAt: Date.now(),
      version: version
    });
  }
  
  /**
   * 버전 비교 시 0 버전 처리
   * 마이그레이션 완료 전에는 버전 비교가 무력화될 수 있으므로 주의
   */
  invalidateByVersion(key: string, dbVersion: number): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;
    
    // 안전장치: 캐시 버전이 0이면 항상 무효화 (마이그레이션 미완료로 간주)
    if (entry.version === 0) {
      this.cache.delete(key);
      return true;
    }
    
    // 버전 비교 (단조 증가하므로 단순 비교 가능)
    if (entry.version < dbVersion) {
      this.cache.delete(key);
      // 리스너에게 알림
      this.invalidationListeners.forEach(listener => {
        try {
          listener.onInvalidate(key);
        } catch (error) {
          // 리스너 에러는 무시
        }
      });
      return true;
    }
    return false;
  }
  
  invalidate(key: string): void {
    if (this.cache.delete(key)) {
      // 리스너에게 알림
      this.invalidationListeners.forEach(listener => {
        try {
          listener.onInvalidate(key);
        } catch (error) {
          // 리스너 에러는 무시
        }
      });
    }
  }
  
  clear(): void {
    this.cache.clear();
    // 리스너에게 알림
    this.invalidationListeners.forEach(listener => {
      try {
        listener.onInvalidateAll();
      } catch (error) {
        // 리스너 에러는 무시
      }
    });
  }
  
  subscribeInvalidation(listener: CacheInvalidationListener): void {
    this.invalidationListeners.add(listener);
  }
  
  unsubscribeInvalidation(listener: CacheInvalidationListener): void {
    this.invalidationListeners.delete(listener);
  }
}
```

## 테스트 전략

### 단위 테스트
- WAL 체크포인트 스케줄러 테스트
  - 주기적 체크포인트 실행 확인
  - 체크포인트 모드 선택 로직 테스트
  - 재시도 및 백오프 전략 테스트
  - idempotent 동작 확인 (start/stop 중복 호출)
- 데이터베이스 락 모니터 테스트
  - 락 감지 로직 테스트
  - 임계값 기반 경고 테스트
  - 메트릭 수집 테스트
- 캐시 버전 관리 테스트
  - version 컬럼 기반 버전 비교 테스트
  - 동일 초 업데이트 시나리오 테스트
  - 버전 불일치 시 자동 갱신 테스트
- 캐시 무효화 메커니즘 테스트
  - 이벤트 리스너 동작 테스트
  - 특정 키 무효화 테스트
  - 전체 캐시 무효화 테스트

### 통합 테스트
- 서버 초기화 시 스케줄러 시작 테스트
  - 스케줄러 자동 시작 확인
  - 중복 시작 방지 확인
- 서버 종료 시 스케줄러 정리 테스트
  - 종료 훅에서 stop() 호출 확인
  - 타이머 정리 확인
- 동시성 테스트 (세마포어와 함께)
  - 세마포어 제한 내에서 동시 요청 처리
  - WAL 체크포인트 중 트랜잭션 처리

### 실제 락 시나리오 테스트
- **멀티프로세스/멀티스레드 동시 쓰기**:
  - 여러 프로세스에서 동시에 쓰기 작업 수행
  - 락 발생 및 해제 확인
  - 데이터 일관성 확인
- **WAL 체크포인트 중 장기 트랜잭션**:
  - 장기 트랜잭션 실행 중 체크포인트 시도
  - PASSIVE 모드에서 체크포인트 건너뛰기 확인
  - 트랜잭션 완료 후 체크포인트 성공 확인
- **busy_timeout 상황**:
  - busy_timeout 초과 시나리오 재현
  - 재시도 로직 동작 확인
  - 에러 처리 확인

### 분산 캐시 테스트 (향후)
- **이벤트 순서 뒤바뀜**:
  - 이벤트 순서가 뒤바뀌어 도착하는 시나리오
  - 버전 비교를 통한 최신 상태 보장 확인
- **중복 수신**:
  - 동일 이벤트 중복 수신 시나리오
  - 멱등성 보장 확인
- **이벤트 유실**:
  - 네트워크 분단으로 인한 이벤트 유실 시나리오
  - `findByKey()` 호출 시 버전 비교로 복구 확인
  - 주기적 검증으로 불일치 복구 확인

### 성능 테스트
- WAL 체크포인트 오버헤드 측정
  - 체크포인트 실행 시간 측정
  - I/O 블로킹 시간 측정
  - 주기별 오버헤드 비교
- 락 모니터링 오버헤드 측정
  - 모니터링 주기별 CPU 사용량 측정
  - 락 감지 로직 오버헤드 측정
- 캐시 동기화 성능 측정
  - 버전 비교 오버헤드 측정
  - 캐시 무효화 및 재로드 시간 측정

## 마일스톤

### M1: WAL 체크포인트 스케줄러 구현
- [ ] WAL 체크포인트 스케줄러 클래스 구현
- [ ] 데이터베이스 락 모니터 구현
- [ ] 서버 초기화 시 통합
- [ ] 단위 테스트 작성
- [ ] 통합 테스트 작성

### M2: 캐시 동기화 개선
- [ ] 캐시 버전 관리 추가
- [ ] 캐시 무효화 메커니즘 개선
- [ ] 캐시 동기화 전략 문서화
- [ ] 단위 테스트 작성
- [ ] 통합 테스트 작성

### M3: 검증 및 최적화
- [ ] 성능 테스트 실행
- [ ] 오버헤드 측정 및 최적화
- [ ] 문서화 완료
- [ ] 코드 리뷰 및 개선

## 운영 및 기본값 검토

### 주기 기본값 근거
- **WAL 체크포인트 주기 (5분)**:
  - 근거: 일반적인 워크로드에서 WAL 파일이 16MB 이하로 유지되도록 설정
  - 소형 워크로드: 10분으로 증가 가능 (환경 변수 `WAL_CHECKPOINT_INTERVAL_MS`)
  - 대형 워크로드: 3분으로 감소 가능
  - 튜닝 가이드:
    - WAL 파일이 자주 16MB를 초과하면 주기 단축
    - 체크포인트 오버헤드가 높으면 주기 연장
- **락 모니터링 주기 (1분)**:
  - 근거: 락이 30초 이상 지속되기 전에 감지하여 조치
  - 소형 워크로드: 2분으로 증가 가능 (환경 변수 `LOCK_MONITOR_INTERVAL_MS`)
  - 대형 워크로드: 30초로 감소 가능
  - 튜닝 가이드:
    - 락이 자주 발생하면 주기 단축
    - 모니터링 오버헤드가 높으면 주기 연장

### 환경별 튜닝 가이드
- **소형 워크로드** (개인용, 낮은 트래픽):
  - WAL 체크포인트: 10분
  - 락 모니터링: 2분
  - WAL 파일 크기 임계치: 24MB (경고), 30MB (위험)
- **중형 워크로드** (팀용, 중간 트래픽):
  - WAL 체크포인트: 5분 (기본값)
  - 락 모니터링: 1분 (기본값)
  - WAL 파일 크기 임계치: 16MB (경고), 24MB (위험)
- **대형 워크로드** (엔터프라이즈, 높은 트래픽):
  - WAL 체크포인트: 3분
  - 락 모니터링: 30초
  - WAL 파일 크기 임계치: 12MB (경고), 18MB (위험)
  - 전용 체크포인트 커넥션 필수

### 종료 훅에서 리소스 정리
- **서버 종료 시 필수 정리 작업**:
  1. WAL 체크포인트 스케줄러 `stop()` 호출
  2. 데이터베이스 락 모니터 `stop()` 호출
  3. 타이머 정리 확인 (`clearInterval` 호출)
  4. 전용 체크포인트 커넥션 종료
  5. 최종 WAL 체크포인트 실행 (FULL 모드)
- **정리 실패 시 대응**:
  - 종료 훅에서 예외 발생 시에도 정리 작업 완료 보장
  - 타임아웃 설정 (예: 5초) 후 강제 종료
  - 정리 실패 시 로그 기록

### 참고사항

- WAL 체크포인트는 I/O 작업이므로 너무 자주 실행하면 성능에 영향을 줄 수 있음
- 락 모니터링도 주기적으로 실행되므로 오버헤드를 고려해야 함
- 분산 환경으로 전환 시 Redis 등 외부 캐시를 고려해야 함
- 현재는 단일 서버 환경을 가정하지만, 향후 확장성을 고려한 설계 필요
- 모든 주기 및 임계값은 환경 변수로 설정 가능하도록 구현

