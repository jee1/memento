# PRD: CoreMemoryRepository 데이터베이스 인터페이스 추상화

## 1. Introduction/Overview

현재 `CoreMemoryRepository`는 `better-sqlite3` 라이브러리에 직접 의존하고 있어, 도메인 계층과 인프라 계층 간의 결합도가 높습니다. 이는 향후 PostgreSQL로의 마이그레이션을 고려할 때 아키텍처적 문제가 됩니다.

이 작업은 **의존성 역전 원칙(Dependency Inversion Principle)**을 적용하여 데이터베이스 인터페이스를 추상화하고, 도메인 계층이 인프라 계층의 구체적인 구현에 의존하지 않도록 개선합니다. 

**목표**: CoreMemoryRepository를 시작으로 데이터베이스 추상화 패턴을 검증하고, 이후 다른 Repository들로 단계적으로 확장할 수 있는 기반을 마련합니다.

**⚠️ 중요 범위 확인**: 
- **CoreMemory 계열만 비동기 시그니처로 변경**: CoreMemoryRepository, CoreMemoryService, CoreMemory 관련 테스트가 비동기 API로 업데이트됨
- **나머지는 기존 인터페이스 유지**: `Vector*Repository`, 기존 `DatabaseConnection` 인터페이스는 변경하지 않음
- **완료 조건**: CoreMemory 계열의 서비스/테스트 전부 업데이트 완료가 필수

## 2. Goals

1. **의존성 역전**: CoreMemoryRepository가 데이터베이스 인터페이스에 의존하도록 변경
2. **계층 분리**: 도메인 계층과 인프라 계층의 명확한 분리
3. **확장성 확보**: 향후 PostgreSQL 마이그레이션을 위한 아키텍처 준비
4. **패턴 검증**: 다른 Repository들로 확장 가능한 추상화 패턴 수립
5. **호환성 유지**: 기존 코드의 동작을 유지하면서 점진적 개선

## 3. User Stories

### 3.1 개발자 관점

**As a** 백엔드 개발자  
**I want** CoreMemoryRepository가 데이터베이스 인터페이스에 의존하도록 변경  
**So that** 향후 PostgreSQL로 마이그레이션할 때 도메인 로직을 변경하지 않고도 인프라만 교체할 수 있습니다.

**As a** 아키텍트  
**I want** 데이터베이스 추상화 패턴을 CoreMemoryRepository에서 검증  
**So that** 다른 Repository들에도 동일한 패턴을 적용할 수 있습니다.

**As a** 테스트 작성자  
**I want** Mock 기반 단위 테스트를 작성할 수 있도록 인터페이스 제공  
**So that** 데이터베이스 없이도 서비스 계층의 비즈니스 로직을 테스트할 수 있습니다.

### 3.2 시스템 관점

**As a** 시스템  
**I want** 데이터베이스 구현체를 런타임에 선택할 수 있도록 인터페이스 제공  
**So that** 환경 변수에 따라 SQLite 또는 PostgreSQL을 선택적으로 사용할 수 있습니다.

## 4. Functional Requirements

### 4.1 인터페이스 정의

**FR-1**: CoreMemoryRepository 인터페이스 정의
- 위치: `src/domains/memory/repositories/core-memory-repository.interface.ts` (또는 기존 파일에 인터페이스 추가)
- 모든 공개 메서드를 인터페이스로 정의
- 메서드 시그니처: `create`, `findById`, `findByKey`, `findByAgentId`, `findAlwaysLoad`, `update`, `updateByKey`, `delete`, `deleteByKey`, `deleteByAgentId`, `findAll`, `count`

**FR-2**: CoreMemory 전용 데이터베이스 연결 인터페이스 정의 및 비동기화
- **중요**: 기존 `DatabaseConnection` 인터페이스는 `Vector*Repository` 등 다른 소비자가 사용 중이므로 변경하지 않음
- CoreMemory 전용 인터페이스 생성: `CoreMemoryDatabaseConnection`, `CoreMemoryPreparedStatement`
- 위치: `src/domains/memory/repositories/core-memory-database.interface.ts` (신규 파일)
- PostgreSQL(비동기)과의 호환성을 위해 인터페이스를 비동기화
- `CoreMemoryDatabaseConnection` 및 `CoreMemoryPreparedStatement` 인터페이스의 모든 메서드를 Promise 반환으로 변경
- SQLite 구현체는 동기 API를 Promise로 래핑하는 어댑터 패턴 적용
- SQL 저수준 작업은 비동기 `CoreMemoryDatabaseConnection` 인터페이스를 통해 수행

**FR-3**: Repository 메서드 레벨 인터페이스 제공
- 도메인/서비스 계층은 Repository 메서드 레벨 인터페이스에 의존
- 인프라 계층은 SQL 저수준 인터페이스(`CoreMemoryDatabaseConnection`)에 의존

### 4.2 구현체 분리

**FR-4**: SQLite 구현체 생성
- 위치: `src/infrastructure/database/repositories/core-memory-repository-sqlite.impl.ts`
- `CoreMemoryRepository` 인터페이스 구현
- `CoreMemoryDatabaseConnection` 인터페이스를 통해 SQLite 작업 수행
- 기존 `CoreMemoryRepository` 클래스의 로직을 구현체로 이동

**FR-5**: 기존 CoreMemoryRepository 리팩토링
- `CoreMemoryRepository` 클래스를 인터페이스로 변경하거나 별도 인터페이스 파일로 분리
- 구현체는 `CoreMemoryRepositorySqliteImpl`로 명명
- 기존 클래스는 deprecated 처리하거나 즉시 제거 (호출부 업데이트 후)

### 4.3 의존성 주입

**FR-6**: Factory 패턴 도입 및 환경 변수 기반 선택
- 위치: `src/infrastructure/database/factories/core-memory-repository.factory.ts`
- 환경 변수 `DB_TYPE`으로 데이터베이스 타입 선택
  - 값: `'sqlite'` (기본값), `'postgres'` (향후 지원)
  - 기본값: `'sqlite'` (환경 변수 미설정 시)
  - 미지원 타입 입력 시: 에러 발생 및 명확한 에러 메시지 제공
- 데이터베이스 타입에 따라 적절한 구현체 반환
- 초기에는 SQLite 구현체만 반환 (PostgreSQL은 향후 추가)

**FR-7**: 호출부 업데이트
- `CoreMemoryService`가 인터페이스에 의존하도록 변경
- `src/infrastructure/database/sqlite/init.ts`에서 Factory를 통해 Repository 생성
- `src/domains/memory/remember/remember-tool.ts`, `recall-tool.ts` 등 호출부 업데이트

### 4.4 타입 정의

**FR-8**: 타입 정의 유지
- `CoreMemoryRecord`, `CreateCoreMemoryInput`, `UpdateCoreMemoryInput` 인터페이스 유지
- 인터페이스 파일에 포함하거나 별도 타입 파일로 관리

## 5. Non-Goals (Out of Scope)

**NG-1**: 다른 Repository 추상화
- CoreMemoryRepository만 대상으로 함
- EpisodicMemoryRepository, SemanticMemoryRepository 등은 향후 작업
- **중요**: `VectorSearchRepository`, `VectorIndexRepository`, `VectorPerformanceRepository`는 이번 작업 범위에 포함하지 않음
  - 이들은 `Database.Database`를 직접 사용하며, 기존 `DatabaseConnection` 인터페이스를 사용하지 않음
  - 향후 별도 마이그레이션 작업으로 진행

**NG-2**: 기존 `DatabaseConnection` 인터페이스 변경
- `src/shared/interfaces/database.interface.ts`의 기존 인터페이스는 변경하지 않음
- `Vector*Repository` 인터페이스와 기존 `DatabaseConnection`이 다른 모듈에서 사용 중
- CoreMemory는 별도 인터페이스(`CoreMemoryDatabaseConnection`) 사용

**NG-3**: PostgreSQL 구현
- 이번 작업에서는 SQLite 구현체만 제공
- PostgreSQL 구현은 후속 작업에서 진행

**NG-4**: 성능 최적화
- 현재 성능을 유지하는 수준
- 성능 개선은 별도 작업으로 진행

**NG-5**: 데이터베이스 마이그레이션 로직
- 스키마 마이그레이션은 기존 시스템 유지
- 인터페이스 추상화만 수행

**NG-6**: 트랜잭션 관리 개선
- 기존 트랜잭션 처리 방식 유지
- 트랜잭션 추상화는 향후 고려

## 6. Design Considerations

### 6.1 아키텍처 계층 구조

```
┌─────────────────────────────────────┐
│   Domain/Service Layer              │
│   (CoreMemoryService)               │
│   └─> CoreMemoryRepository (I/F)   │
└─────────────────────────────────────┘
              ▲
              │ implements
┌─────────────────────────────────────┐
│   Infrastructure Layer               │
│   CoreMemoryRepositorySqliteImpl    │
│   └─> CoreMemoryDatabaseConnection (I/F) │
└─────────────────────────────────────┘
              ▲
              │ uses/depends on
┌─────────────────────────────────────┐
│   SQLite Implementation              │
│   (sqlite-core-memory-adapter)       │
└─────────────────────────────────────┘
```

### 6.2 인터페이스 설계 원칙

- **저수준 인터페이스**: `CoreMemoryDatabaseConnection`, `CoreMemoryPreparedStatement` (SQL-ish 포트, **비동기**)
  - 모든 메서드가 Promise 반환
  - PostgreSQL(비동기)과 SQLite(동기→비동기 어댑터) 모두 지원
  - **중요**: 기존 `DatabaseConnection` 인터페이스와 별도로 존재 (다른 모듈 영향 방지)
- **고수준 인터페이스**: `CoreMemoryRepository` (도메인 용어 수준 포트, **비동기**)
  - 모든 메서드가 Promise 반환
- **인프라 계층**: 저수준 인터페이스(`CoreMemoryDatabaseConnection`)를 사용/의존
- **도메인/서비스 계층**: 고수준 인터페이스(`CoreMemoryRepository`)를 사용/의존

### 6.3 파일 구조 제안

```
src/
├── domains/
│   └── memory/
│       └── repositories/
│           ├── core-memory-repository.interface.ts      (인터페이스 + 타입 정의)
│           └── core-memory-database.interface.ts        (CoreMemory 전용 DB 인터페이스)
├── infrastructure/
│   └── database/
│       ├── adapters/
│       │   └── sqlite-core-memory-adapter.ts            (SQLite → 비동기 인터페이스 어댑터)
│       ├── repositories/
│       │   └── core-memory-repository-sqlite.impl.ts
│       └── factories/
│           └── core-memory-repository.factory.ts
└── shared/
    └── interfaces/
        └── database.interface.ts  (기존 파일 유지 - 변경 없음)
```

**중요**: `src/shared/interfaces/database.interface.ts`는 변경하지 않음
- `Vector*Repository` 인터페이스와 기존 `DatabaseConnection` 인터페이스가 공존
- CoreMemory는 별도 인터페이스 사용으로 다른 모듈에 영향 없음

### 6.4 기존 코드와의 호환성

- 기존 `CoreMemoryRepository` 클래스는 단계적으로 제거
- 호출부를 모두 업데이트한 후 기존 클래스 제거
- 또는 기존 클래스를 구현체로 리팩토링하여 호환성 유지

## 7. Technical Considerations

### 7.1 CoreMemory 전용 인터페이스 생성

- **중요**: 기존 `src/shared/interfaces/database.interface.ts`는 변경하지 않음
  - `Vector*Repository` 인터페이스와 기존 `DatabaseConnection`이 다른 모듈에서 사용 중
  - 변경 시 영향 범위가 너무 큼
- CoreMemory 전용 인터페이스 생성: `CoreMemoryDatabaseConnection`, `CoreMemoryPreparedStatement`
- 인터페이스를 비동기화하여 PostgreSQL 호환성 확보
  - `CoreMemoryPreparedStatement.all()`, `get()`, `run()` → Promise 반환
  - `CoreMemoryDatabaseConnection.prepare()`, `exec()` → Promise 반환
- 필요시 인터페이스 확장 (예: 트랜잭션 메서드 추가)

### 7.2 SQLite 어댑터 구현

- `better-sqlite3`의 `Database` 객체를 비동기 `CoreMemoryDatabaseConnection` 인터페이스로 래핑
- 동기 API(`prepare`, `run`, `get`, `all`)를 Promise로 래핑
- 어댑터 패턴 적용하여 기존 SQLite 코드 재사용
- 위치: `src/infrastructure/database/adapters/sqlite-core-memory-adapter.ts`

#### 7.2.1 비동기 어댑터 정책

**에러 전달 방식**:
- 동기 API에서 발생한 에러는 `Promise.reject()`로 전달
- `try-catch`로 동기 에러를 잡아 `reject`로 변환
- 예: `Promise.reject(error)` 또는 `Promise.resolve().then(() => { throw error })`

**자원 해제**:
- `PreparedStatement`는 SQLite의 자동 관리에 의존 (명시적 종료 불필요)
- `DatabaseConnection.close()`는 Promise로 래핑하여 비동기 처리
- 어댑터가 소유하는 리소스는 명시적으로 해제하지 않음 (원본 `Database` 객체가 관리)

**이벤트 루프 블로킹**:
- SQLite 동기 API는 블로킹 호출이지만, Node.js 이벤트 루프에 직접적인 영향은 제한적
- `Promise.resolve()`로 즉시 래핑하여 비동기 시그니처 제공
- 대량 작업 시 `setImmediate()` 또는 `process.nextTick()` 활용 고려 (선택사항)
- 성능 회귀 테스트로 오버헤드 측정 및 허용 범위 확인 (5% 이내)

### 7.3 의존성 주입 전략

- Factory 패턴을 통한 구현체 선택
- 환경 변수 `DB_TYPE` 기반 선택 (기본값: `'sqlite'`)
- 미지원 타입 입력 시 명확한 에러 메시지와 함께 실패 처리
- 향후 PostgreSQL 추가 시에도 동일한 Factory 인터페이스 유지

### 7.4 타입 안정성

- TypeScript 인터페이스를 통한 타입 안정성 보장
- 제네릭 타입 활용 고려 (필요시)

### 7.5 에러 처리

- 기존 에러 처리 방식 유지
- 데이터베이스별 에러 타입은 공통 인터페이스로 추상화

## 8. Success Metrics

### 8.1 코드 품질 지표

- **결합도 감소**: CoreMemoryRepository가 `better-sqlite3`에 직접 의존하지 않음
- **인터페이스 분리**: 도메인 계층과 인프라 계층의 명확한 분리
- **재사용성**: 다른 Repository에도 적용 가능한 패턴 수립

### 8.2 기능적 지표

- **기능 회귀 없음**: 기존 테스트 모두 통과
  - `npm test` 실행 시 모든 테스트 통과
  - `npm run test:ci` 실행 시 CI 환경에서도 통과
- **성능 유지**: 기존 성능 수준 유지 (회귀 테스트)
- **브레이킹 체인지**: CoreMemory 계열만 비동기 시그니처로 변경
  - `CoreMemoryRepository`의 모든 메서드가 Promise 반환
  - `CoreMemoryService`의 모든 메서드가 Promise 반환 (이미 비동기)
  - CoreMemory 관련 테스트 전부 비동기 시그니처로 업데이트 완료가 완료 조건
  - Vector*Repository 등 다른 모듈은 기존 인터페이스 유지 (변경 없음)

### 8.3 아키텍처 지표

- **확장성**: PostgreSQL 구현체 추가 시 도메인 로직 변경 불필요
- **테스트 용이성**: Mock 기반 단위 테스트 작성 가능
- **유지보수성**: 데이터베이스 변경 시 영향 범위 최소화

## 9. Testing Strategy

### 9.1 기존 테스트 유지

- `src/domains/memory/repositories/__tests__/core-memory-repository.spec.ts` 유지
- 구현체 변경 후에도 동일한 테스트로 검증
- **테스트 실행**: `npm test` 또는 `npm run test:ci`

### 9.2 인터페이스 계약 테스트

- 위치: `src/domains/memory/repositories/__tests__/core-memory-repository.contract.spec.ts` (신규 생성)
- 인터페이스의 모든 메서드가 올바르게 구현되었는지 검증
- 인터페이스 계약을 검증하는 공통 테스트 유틸리티 함수 제공
- **테스트 실행**: `npm test src/domains/memory/repositories/__tests__/core-memory-repository.contract.spec.ts`

### 9.3 Mock 기반 단위 테스트

- `CoreMemoryService` 테스트에서 Mock Repository 사용
- 위치: `src/domains/memory/services/__tests__/core-memory-service.spec.ts` (기존 파일 수정)
- 데이터베이스 없이 서비스 로직 테스트 가능
- **테스트 실행**: `npm test src/domains/memory/services/__tests__/core-memory-service.spec.ts`

### 9.4 통합 테스트

- 실제 SQLite 데이터베이스를 사용한 통합 테스트 유지
- `src/infrastructure/database/sqlite/core-memory-auto-load.integration.spec.ts` 유지
- **테스트 실행**: `npm test src/infrastructure/database/sqlite/core-memory-auto-load.integration.spec.ts`

### 9.5 성능 회귀 테스트

- 기존 성능 벤치마크와 비교하여 성능 저하 없음 확인
- 비동기화로 인한 오버헤드 측정 및 허용 범위 내 확인

### 9.6 Factory 테스트

- 위치: `src/infrastructure/database/factories/__tests__/core-memory-repository.factory.spec.ts` (신규 생성)
- 환경 변수에 따른 구현체 선택 검증
- 미지원 타입 입력 시 에러 처리 검증
- **테스트 실행**: `npm test src/infrastructure/database/factories/__tests__/core-memory-repository.factory.spec.ts`

### 9.7 테스트 커맨드 현실성 확인

- **기본 테스트**: `npm test` (존재 확인됨: `vitest --run`)
- **CI 테스트**: `npm run test:ci` (존재 확인됨: `vitest --run --reporter=basic`)
- **특정 테스트 실행**: `npm test [파일 경로]` (Vitest 기본 기능)
- 모든 테스트 커맨드는 실제 `package.json`에 정의된 스크립트 사용

## 10. Implementation Plan

### Phase 1: 인터페이스 정의 및 타입 분리
1. `CoreMemoryRepository` 인터페이스 정의
2. 타입 정의 파일 분리 (선택사항)
3. 기존 인터페이스 파일 구조 결정

### Phase 2: CoreMemory 전용 인터페이스 생성 및 SQLite 구현체 생성

#### 2.1 CoreMemory 전용 인터페이스 생성
1. `src/domains/memory/repositories/core-memory-database.interface.ts` 생성
   - `CoreMemoryPreparedStatement` 인터페이스 정의 (비동기)
     - `all(...params: any[]): Promise<any[]>`
     - `get(...params: any[]): Promise<any>`
     - `run(...params: any[]): Promise<{ changes: number; lastInsertRowid: number }>`
   - `CoreMemoryDatabaseConnection` 인터페이스 정의 (비동기)
     - `prepare(sql: string): Promise<CoreMemoryPreparedStatement>`
     - `exec(sql: string): Promise<void>`
     - `close(): Promise<void>`
     - `isOpen(): Promise<boolean>`
   - **중요**: 기존 `src/shared/interfaces/database.interface.ts`는 변경하지 않음

#### 2.2 SQLite 어댑터 구현
1. `src/infrastructure/database/adapters/sqlite-core-memory-adapter.ts` 생성
   - `better-sqlite3`의 `Database` 객체를 비동기 `CoreMemoryDatabaseConnection` 인터페이스로 래핑
   - 동기 API를 Promise로 래핑
   - 에러 전달: `try-catch`로 동기 에러를 잡아 `Promise.reject()`로 변환
   - 자원 해제: SQLite의 자동 관리에 의존 (명시적 종료 불필요)
   - 이벤트 루프 블로킹: `Promise.resolve()`로 즉시 래핑 (성능 회귀 테스트로 검증)

#### 2.3 SQLite 구현체 생성
1. `CoreMemoryRepositorySqliteImpl` 구현
   - 위치: `src/infrastructure/database/repositories/core-memory-repository-sqlite.impl.ts`
   - 비동기 `CoreMemoryRepository` 인터페이스 구현
   - 비동기 `CoreMemoryDatabaseConnection` 인터페이스를 사용하여 SQLite 작업 수행
   - 기존 `CoreMemoryRepository` 클래스의 로직을 구현체로 이동 (비동기화 적용)

### Phase 3: Factory 패턴 도입 및 환경 변수 지원

#### 3.1 Factory 구현
1. `CoreMemoryRepositoryFactory` 구현
   - 위치: `src/infrastructure/database/factories/core-memory-repository.factory.ts`
   - 환경 변수 `DB_TYPE` 읽기 (기본값: `'sqlite'`)
   - 미지원 타입 입력 시 명확한 에러 메시지와 함께 실패 처리

#### 3.2 구현체 선택 로직
1. `DB_TYPE === 'sqlite'` → `CoreMemoryRepositorySqliteImpl` 반환
2. `DB_TYPE === 'postgres'` → 향후 `CoreMemoryRepositoryPostgresImpl` 반환 (현재는 에러)
3. 미지원 타입 → `Error` 발생: `"Unsupported database type: ${dbType}. Supported types: 'sqlite', 'postgres'"`

#### 3.3 Factory 테스트 작성
1. `src/infrastructure/database/factories/__tests__/core-memory-repository.factory.spec.ts` 생성
   - 환경 변수에 따른 구현체 선택 테스트
   - 미지원 타입 에러 처리 테스트

### Phase 4: 호출부 업데이트 및 기존 클래스 제거

#### 4.1 호출부 업데이트 범위

**CoreMemory 관련 호출부만 업데이트** (Vector*Repository는 제외):
1. `CoreMemoryService` 업데이트 (인터페이스 의존으로 변경)
2. `src/infrastructure/database/sqlite/init.ts` 업데이트 (Factory 사용)
3. 도구(Tool) 파일들 업데이트:
   - `src/domains/memory/remember/remember-tool.ts`
   - `src/domains/memory/recall/recall-tool.ts`
4. 테스트 파일 업데이트:
   - `src/domains/memory/repositories/__tests__/core-memory-repository.spec.ts`
   - `src/domains/memory/services/__tests__/core-memory-service.spec.ts`
   - `src/infrastructure/database/sqlite/core-memory-auto-load.integration.spec.ts`

**제외 대상** (이번 작업 범위 아님):
- `VectorSearchRepository`, `VectorIndexRepository`, `VectorPerformanceRepository` 관련 코드
- `src/domains/search/` 디렉토리의 모든 파일
- `src/shared/interfaces/database.interface.ts` (기존 파일 유지)

#### 4.2 호출부 전환 체크리스트
- [ ] `CoreMemoryService`가 인터페이스에 의존하도록 변경
- [ ] `src/infrastructure/database/sqlite/init.ts`에서 Factory 사용
- [ ] `remember-tool.ts`에서 Factory 사용
- [ ] `recall-tool.ts`에서 Factory 사용
- [ ] 모든 CoreMemory 관련 테스트 파일에서 Factory 사용
- [ ] `grep -r "new CoreMemoryRepository"` 실행하여 직접 인스턴스화 확인
- [ ] 모든 직접 인스턴스화를 Factory 호출로 변경
- [ ] `grep -r "CoreMemoryRepository"` 실행하여 누락된 호출부 확인
- [ ] Vector*Repository 관련 코드는 변경하지 않았는지 확인

#### 4.3 기존 클래스 제거
- **완료 조건**: 위 체크리스트의 모든 항목 완료 후
- **⚠️ 중요**: `src/domains/memory/repositories/core-memory-repository.ts` 파일에서 **클래스 구현 완전 제거**
  - 기존 `CoreMemoryRepository` 클래스 코드 삭제
  - 인터페이스만 남기거나 별도 인터페이스 파일(`core-memory-repository.interface.ts`)로 분리
  - **파일 삭제 또는 인터페이스만 남김을 명확히 확인**
- **검증**: `npm test` 실행하여 모든 테스트 통과 확인
- **추가 검증**: `npm run test:ci` 실행하여 CI 환경에서도 통과 확인

### Phase 5: 테스트 및 검증

#### 5.1 테스트 실행 및 검증
1. **기존 테스트 실행**:
   ```bash
   npm test
   ```
   - 모든 기존 테스트 통과 확인
   - 실패 시 수정 후 재실행

2. **인터페이스 계약 테스트 실행**:
   ```bash
   npm test src/domains/memory/repositories/__tests__/core-memory-repository.contract.spec.ts
   ```

3. **Mock 기반 단위 테스트 실행**:
   ```bash
   npm test src/domains/memory/services/__tests__/core-memory-service.spec.ts
   ```

4. **Factory 테스트 실행**:
   ```bash
   npm test src/infrastructure/database/factories/__tests__/core-memory-repository.factory.spec.ts
   ```

5. **통합 테스트 실행**:
   ```bash
   npm test src/infrastructure/database/sqlite/core-memory-auto-load.integration.spec.ts
   ```

6. **CI 환경 테스트**:
   ```bash
   npm run test:ci
   ```

#### 5.2 성능 회귀 테스트
- 기존 성능 벤치마크와 비교
- 비동기화로 인한 오버헤드 측정 (허용 범위: 5% 이내)

#### 5.3 완료 기준
- ✅ `npm test` 실행 시 모든 테스트 통과
- ✅ `npm run test:ci` 실행 시 CI 환경에서도 통과
- ✅ 모든 새로운 테스트 파일이 통과
- ✅ 성능 회귀 없음 확인
- ✅ **기존 클래스 완전 제거 확인**: `src/domains/memory/repositories/core-memory-repository.ts`에서 클래스 구현 삭제, **파일 삭제 또는 인터페이스만 남김**
- ✅ **CoreMemory 계열 비동기 시그니처 변경 완료**: CoreMemoryRepository, CoreMemoryService, CoreMemory 관련 테스트 전부 업데이트 완료
- ✅ **다른 모듈 영향 없음 확인**: Vector*Repository, 기존 DatabaseConnection 인터페이스 변경 없음 확인

## 11. Open Questions

1. **인터페이스 파일 위치**: 기존 `core-memory-repository.ts`에 인터페이스와 구현체를 함께 둘지, 별도 파일로 분리할지?
   - **결정**: 별도 인터페이스 파일로 분리하여 명확성 확보
   - 파일명: `src/domains/memory/repositories/core-memory-repository.interface.ts`

2. **기존 클래스 처리**: 기존 `CoreMemoryRepository` 클래스를 즉시 제거할지, 단계적으로 마이그레이션할지?
   - **결정**: Phase 4의 체크리스트 완료 후 즉시 제거
   - 검증: `grep -r "new CoreMemoryRepository"` 실행하여 직접 인스턴스화 없음 확인

3. **CoreMemoryDatabaseConnection 어댑터**: `better-sqlite3`의 `Database`를 비동기 `CoreMemoryDatabaseConnection`으로 래핑하는 어댑터가 필요한지?
   - **결정**: 필요함. `infrastructure/database/adapters/sqlite-core-memory-adapter.ts`에 구현
   - 동기 API를 Promise로 래핑하여 비동기 인터페이스 준수
   - 파일명 통일: `sqlite-core-memory-adapter.ts` (전 문단에서 동일하게 사용)

4. **타입 정의 위치**: `CoreMemoryRecord` 등의 타입을 인터페이스 파일에 포함할지, 별도 타입 파일로 분리할지?
   - **결정**: 인터페이스 파일에 포함 (관련성 높음)
   - `core-memory-repository.interface.ts`에 인터페이스와 타입 모두 포함

5. **에러 타입**: 데이터베이스별 에러를 공통 에러 타입으로 추상화할지?
   - **결정**: 초기에는 기존 에러 처리 유지, 향후 필요시 추상화
   - PostgreSQL 추가 시 에러 타입 추상화 고려

6. **Factory 위치**: Factory를 `infrastructure/database/factories/`에 둘지, `domains/memory/repositories/`에 둘지?
   - **결정**: `infrastructure/database/factories/` (인프라 계층이므로)

7. **비동기/동기 계약**: CoreMemoryDatabaseConnection 인터페이스를 비동기화할지, SQLite만 동기 어댑터로 감쌀지?
   - **결정**: CoreMemory 전용 인터페이스(`CoreMemoryDatabaseConnection`)를 비동기화
   - 기존 `DatabaseConnection` 인터페이스는 변경하지 않음 (다른 모듈 영향 방지)
   - SQLite 구현체는 동기 API를 Promise로 래핑하는 어댑터 사용 (`sqlite-core-memory-adapter.ts`)

8. **환경 변수 선택 기준**: 어떤 env 이름/값으로 SQLite vs Postgres를 선택할지?
   - **결정**: `DB_TYPE` 환경 변수 사용
   - 값: `'sqlite'` (기본값), `'postgres'` (향후 지원)
   - 미지원 타입 입력 시 명확한 에러 메시지와 함께 실패 처리

9. **기존 DatabaseConnection 인터페이스 변경 여부**: 다른 모듈에 영향을 주지 않으려면?
   - **결정**: 기존 인터페이스는 변경하지 않음
   - CoreMemory 전용 인터페이스 생성으로 영향 범위 최소화
   - `Vector*Repository` 등 다른 소비자는 기존 인터페이스 계속 사용

## 12. Dependencies

### 12.1 기존 의존성
- `better-sqlite3`: SQLite 구현체에 필요
- TypeScript: 타입 안정성

### 12.2 새로운 의존성
- 없음 (기존 라이브러리만 사용)

### 12.3 관련 파일

**수정 대상**:
- `src/domains/memory/repositories/core-memory-repository.ts`: 리팩토링 대상
- `src/domains/memory/repositories/core-memory-repository.interface.ts`: 신규 생성
- `src/domains/memory/repositories/core-memory-database.interface.ts`: 신규 생성
- `src/domains/memory/services/core-memory-service.ts`: 호출부 업데이트 필요
- `src/infrastructure/database/sqlite/init.ts`: Factory 사용으로 변경
- `src/domains/memory/remember/remember-tool.ts`: Factory 사용으로 변경
- `src/domains/memory/recall/recall-tool.ts`: Factory 사용으로 변경

**변경하지 않을 파일** (영향 범위 제한):
- `src/shared/interfaces/database.interface.ts`: 기존 인터페이스 유지 (변경 없음)
- `src/domains/search/` 디렉토리 전체: Vector*Repository 관련 코드 (별도 마이그레이션 예정)

## 13. Risks and Mitigations

### 13.1 리스크

**R1**: 기존 코드 동작 변경
- **완화**: 철저한 테스트 및 단계적 마이그레이션

**R2**: 성능 저하
- **완화**: 성능 회귀 테스트 및 프로파일링

**R3**: 다른 Repository와의 일관성 부족
- **완화**: 명확한 패턴 수립 및 문서화

**R4**: 과도한 추상화로 인한 복잡도 증가
- **완화**: 최소한의 추상화 수준 유지, 필요시에만 확장

**R5**: 비동기화로 인한 성능 저하
- **완화**: SQLite 어댑터에서 동기 API를 효율적으로 Promise로 래핑
- 성능 회귀 테스트로 오버헤드 측정 및 허용 범위 확인 (5% 이내)

**R6**: 기존 `DatabaseConnection` 인터페이스 변경으로 인한 다른 모듈 영향
- **완화**: CoreMemory 전용 인터페이스(`CoreMemoryDatabaseConnection`) 생성
- 기존 `src/shared/interfaces/database.interface.ts`는 변경하지 않음
- `Vector*Repository` 등 다른 소비자에 영향 없음

**R7**: 호출부 업데이트 범위 불명확으로 인한 누락
- **완화**: Phase 4에 명확한 체크리스트와 범위 정의
- `grep` 명령어로 누락된 호출부 확인
- Vector*Repository 관련 코드는 명시적으로 제외

## 14. Future Enhancements

1. **PostgreSQL 구현체 추가**: 환경 변수 기반 선택
2. **다른 Repository 추상화**: EpisodicMemoryRepository, SemanticMemoryRepository 등
3. **트랜잭션 추상화**: 트랜잭션 관리 인터페이스 추가
4. **에러 타입 추상화**: 데이터베이스별 에러를 공통 타입으로
5. **Connection Pool 추상화**: 데이터베이스 연결 풀 관리 인터페이스

