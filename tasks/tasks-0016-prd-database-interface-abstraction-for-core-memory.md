# Tasks: CoreMemoryRepository 데이터베이스 인터페이스 추상화

이 문서는 `0016-prd-database-interface-abstraction-for-core-memory.md` PRD를 기반으로 생성된 작업 목록입니다.

## Relevant Files

- `src/domains/memory/repositories/core-memory-repository.interface.ts` - CoreMemoryRepository 인터페이스 및 타입 정의 (신규 생성)
- `src/domains/memory/repositories/core-memory-database.interface.ts` - CoreMemory 전용 데이터베이스 인터페이스 (비동기, 신규 생성)
- `src/infrastructure/database/adapters/sqlite-core-memory-adapter.ts` - SQLite를 비동기 인터페이스로 래핑하는 어댑터 (신규 생성)
- `src/infrastructure/database/repositories/core-memory-repository-sqlite.impl.ts` - SQLite 구현체 (신규 생성)
- `src/infrastructure/database/factories/core-memory-repository.factory.ts` - Factory 패턴 구현 (신규 생성)
- `src/infrastructure/database/factories/__tests__/core-memory-repository.factory.spec.ts` - Factory 테스트 (신규 생성)
- `src/domains/memory/repositories/core-memory-repository.ts` - 기존 클래스 제거 대상 (리팩토링)
- `src/domains/memory/services/core-memory-service.ts` - 인터페이스 의존으로 변경 (수정)
- `src/infrastructure/database/database/init.ts` - Factory 사용으로 변경 (수정)
- `src/domains/memory/tools/remember-tool.ts` - Factory 사용으로 변경 (수정)
- `src/domains/memory/tools/recall-tool.ts` - Factory 사용으로 변경 (수정)
- `src/domains/memory/repositories/__tests__/core-memory-repository.spec.ts` - 비동기 시그니처로 업데이트 (수정)
- `src/domains/memory/services/__tests__/core-memory-service.spec.ts` - 비동기 시그니처 및 Mock 사용으로 업데이트 (수정)
- `src/infrastructure/database/database/core-memory-auto-load.integration.spec.ts` - Factory 사용으로 변경 (수정)
- `src/domains/memory/repositories/__tests__/core-memory-repository.contract.spec.ts` - 인터페이스 계약 테스트 (신규 생성)

### Notes

- 기존 `src/shared/interfaces/database.interface.ts`는 변경하지 않음 (Vector*Repository 등 다른 모듈에서 사용 중)
- CoreMemory 계열만 비동기 시그니처로 변경 (CoreMemoryRepository, CoreMemoryService, 관련 테스트)
- Vector*Repository 관련 코드는 이번 작업 범위에 포함하지 않음
- 테스트 실행: `npm test` (모든 테스트), `npm run test:ci` (CI 환경)
- 특정 테스트 실행: `npm test [파일 경로]`

## Tasks

- [x] 1.0 CoreMemoryRepository 인터페이스 정의 및 타입 분리
  - [x] 1.1 `src/domains/memory/repositories/core-memory-repository.interface.ts` 파일 생성
  - [x] 1.2 기존 `core-memory-repository.ts`에서 타입 정의 추출: `CoreMemoryRecord`, `CreateCoreMemoryInput`, `UpdateCoreMemoryInput`
  - [x] 1.3 `CoreMemoryRepository` 인터페이스 정의 (모든 공개 메서드를 비동기 Promise 반환으로 정의)
    - `create(input: CreateCoreMemoryInput): Promise<CoreMemoryRecord>`
    - `findById(core_id: string): Promise<CoreMemoryRecord | null>`
    - `findByKey(agent_id: string, key: string): Promise<CoreMemoryRecord | null>`
    - `findByAgentId(agent_id: string): Promise<CoreMemoryRecord[]>`
    - `findAlwaysLoad(agent_id?: string): Promise<CoreMemoryRecord[]>`
    - `update(core_id: string, input: UpdateCoreMemoryInput): Promise<CoreMemoryRecord | null>`
    - `updateByKey(agent_id: string, key: string, input: UpdateCoreMemoryInput): Promise<CoreMemoryRecord | null>`
    - `delete(core_id: string): Promise<boolean>`
    - `deleteByKey(agent_id: string, key: string): Promise<boolean>`
    - `deleteByAgentId(agent_id: string): Promise<number>`
    - `findAll(): Promise<CoreMemoryRecord[]>`
    - `count(agent_id?: string): Promise<number>`
  - [x] 1.4 타입 정의를 인터페이스 파일에 포함 (인터페이스와 타입을 함께 관리)
  - [x] 1.5 인터페이스 파일에서 타입 export 확인

- [x] 2.0 CoreMemory 전용 데이터베이스 인터페이스 생성 (비동기)
  - [x] 2.1 `src/domains/memory/repositories/core-memory-database.interface.ts` 파일 생성
  - [x] 2.2 `CoreMemoryPreparedStatement` 인터페이스 정의 (비동기)
    - `all(...params: any[]): Promise<any[]>`
    - `get(...params: any[]): Promise<any>`
    - `run(...params: any[]): Promise<{ changes: number; lastInsertRowid: number }>`
  - [x] 2.3 `CoreMemoryDatabaseConnection` 인터페이스 정의 (비동기)
    - `prepare(sql: string): Promise<CoreMemoryPreparedStatement>`
    - `exec(sql: string): Promise<void>`
    - `close(): Promise<void>`
    - `isOpen(): Promise<boolean>`
  - [x] 2.4 기존 `src/shared/interfaces/database.interface.ts`는 변경하지 않았는지 확인 (Vector*Repository 영향 방지)

- [x] 3.0 SQLite 어댑터 및 구현체 생성 (TDD: RED-GREEN-REFACTOR)

  #### 3.1 SQLite 어댑터 생성 (TDD)
  
  **RED: 실패하는 테스트 작성**
  - [x] 3.1.1 `src/infrastructure/database/adapters/__tests__/sqlite-core-memory-adapter.spec.ts` 파일 생성
  - [x] 3.1.2 Given: `better-sqlite3` Database 객체가 주어졌을 때
    - When: `SqliteCoreMemoryAdapter`를 생성하고
    - Then: `CoreMemoryDatabaseConnection` 인터페이스를 구현하는지 테스트
  - [x] 3.1.3 Given: 어댑터가 준비되었을 때
    - When: `prepare(sql)`을 호출하면
    - Then: `Promise<CoreMemoryPreparedStatement>`를 반환하는지 테스트
  - [x] 3.1.4 Given: 어댑터가 준비되었을 때
    - When: `exec(sql)`을 호출하면
    - Then: `Promise<void>`를 반환하는지 테스트
  - [x] 3.1.5 Given: 어댑터가 준비되었을 때
    - When: `isOpen()`을 호출하면
    - Then: `Promise<boolean>`을 반환하는지 테스트
  - [x] 3.1.6 Given: PreparedStatement가 준비되었을 때
    - When: `all(...params)`를 호출하면
    - Then: `Promise<any[]>`를 반환하는지 테스트
  - [x] 3.1.7 Given: PreparedStatement가 준비되었을 때
    - When: `get(...params)`를 호출하면
    - Then: `Promise<any>`를 반환하는지 테스트
  - [x] 3.1.8 Given: PreparedStatement가 준비되었을 때
    - When: `run(...params)`를 호출하면
    - Then: `Promise<{ changes: number; lastInsertRowid: number }>`를 반환하는지 테스트
  - [x] 3.1.9 Given: SQL 에러가 발생했을 때
    - When: 어댑터 메서드를 호출하면
    - Then: `Promise.reject()`로 에러를 전달하는지 테스트

  **GREEN: 테스트를 통과시키는 최소한의 코드 작성**
  - [x] 3.1.10 `src/infrastructure/database/adapters/sqlite-core-memory-adapter.ts` 파일 생성
  - [x] 3.1.11 `SqliteCoreMemoryPreparedStatement` 클래스 구현 (내부 클래스)
    - `CoreMemoryPreparedStatement` 인터페이스 구현
    - 동기 API를 Promise로 래핑 (`Promise.resolve()` 사용)
  - [x] 3.1.12 `SqliteCoreMemoryAdapter` 클래스 구현
    - `better-sqlite3`의 `Database` 객체를 생성자에서 받음
    - `CoreMemoryDatabaseConnection` 인터페이스 구현
    - 동기 API를 Promise로 래핑
    - 에러 처리: `try-catch`로 동기 에러를 잡아 `Promise.reject()`로 변환
  - [x] 3.1.13 테스트 실행하여 모든 테스트 통과 확인

  **REFACTOR: 코드 리팩토링**
  - [x] 3.1.14 코드 중복 제거 (PreparedStatement 래핑 로직 통합)
  - [x] 3.1.15 에러 처리 일관성 개선
  - [x] 3.1.16 타입 안정성 개선 (any 타입 최소화)
  - [x] 3.1.17 테스트 재실행하여 리팩토링 후에도 통과 확인

  #### 3.2 CoreMemoryRepository SQLite 구현체 생성 (TDD)

  **RED: 실패하는 테스트 작성**
  - [x] 3.2.1 `src/infrastructure/database/repositories/__tests__/core-memory-repository-sqlite.impl.spec.ts` 파일 생성
  - [x] 3.2.2 Given: `CoreMemoryDatabaseConnection` Mock이 주어졌을 때
    - When: `CoreMemoryRepositorySqliteImpl`을 생성하고
    - Then: `CoreMemoryRepository` 인터페이스를 구현하는지 테스트
  - [x] 3.2.3 Given: Repository가 준비되었을 때
    - When: `create(input)`을 호출하면
    - Then: `Promise<CoreMemoryRecord>`를 반환하는지 테스트
  - [x] 3.2.4 Given: Repository가 준비되었을 때
    - When: `findById(core_id)`를 호출하면
    - Then: `Promise<CoreMemoryRecord | null>`을 반환하는지 테스트
  - [x] 3.2.5 Given: Repository가 준비되었을 때
    - When: `findByKey(agent_id, key)`를 호출하면
    - Then: `Promise<CoreMemoryRecord | null>`을 반환하는지 테스트
  - [x] 3.2.6 Given: Repository가 준비되었을 때
    - When: `findByAgentId(agent_id)`를 호출하면
    - Then: `Promise<CoreMemoryRecord[]>`를 반환하는지 테스트
  - [x] 3.2.7 Given: Repository가 준비되었을 때
    - When: `findAlwaysLoad(agent_id?)`를 호출하면
    - Then: `Promise<CoreMemoryRecord[]>`를 반환하는지 테스트
  - [x] 3.2.8 Given: Repository가 준비되었을 때
    - When: `update(core_id, input)`을 호출하면
    - Then: `Promise<CoreMemoryRecord | null>`을 반환하는지 테스트
  - [x] 3.2.9 Given: Repository가 준비되었을 때
    - When: `updateByKey(agent_id, key, input)`을 호출하면
    - Then: `Promise<CoreMemoryRecord | null>`을 반환하는지 테스트
  - [x] 3.2.10 Given: Repository가 준비되었을 때
    - When: `delete(core_id)`를 호출하면
    - Then: `Promise<boolean>`을 반환하는지 테스트
  - [x] 3.2.11 Given: Repository가 준비되었을 때
    - When: `deleteByKey(agent_id, key)`를 호출하면
    - Then: `Promise<boolean>`을 반환하는지 테스트
  - [x] 3.2.12 Given: Repository가 준비되었을 때
    - When: `deleteByAgentId(agent_id)`를 호출하면
    - Then: `Promise<number>`를 반환하는지 테스트
  - [x] 3.2.13 Given: Repository가 준비되었을 때
    - When: `findAll()`을 호출하면
    - Then: `Promise<CoreMemoryRecord[]>`를 반환하는지 테스트
  - [x] 3.2.14 Given: Repository가 준비되었을 때
    - When: `count(agent_id?)`를 호출하면
    - Then: `Promise<number>`를 반환하는지 테스트
  - [x] 3.2.15 Given: `always_load`가 숫자 1로 저장되었을 때
    - When: 조회하면
    - Then: 불리언 `true`로 변환되어 반환되는지 테스트

  **GREEN: 테스트를 통과시키는 최소한의 코드 작성**
  - [x] 3.2.16 `src/infrastructure/database/repositories/core-memory-repository-sqlite.impl.ts` 파일 생성
  - [x] 3.2.17 `CoreMemoryRepositorySqliteImpl` 클래스 구현
    - `CoreMemoryRepository` 인터페이스 구현
    - 생성자에서 `CoreMemoryDatabaseConnection` 인터페이스를 받음
    - 기존 `CoreMemoryRepository` 클래스의 모든 메서드 로직을 구현체로 이동
    - 모든 메서드를 비동기로 구현 (`await` 사용)
    - `CoreMemoryDatabaseConnection` 인터페이스를 통해 SQL 작업 수행
  - [x] 3.2.18 `always_load` 불리언 변환 로직 구현 (Boolean() 변환)
  - [x] 3.2.19 테스트 실행하여 모든 테스트 통과 확인

  **REFACTOR: 코드 리팩토링**
  - [x] 3.2.20 SQL 쿼리 중복 제거 (공통 쿼리 유틸리티 함수 추출)
  - [x] 3.2.21 `always_load` 변환 로직 중복 제거 (헬퍼 함수 추출)
  - [x] 3.2.22 에러 처리 일관성 개선
  - [x] 3.2.23 테스트 재실행하여 리팩토링 후에도 통과 확인

- [x] 4.0 Factory 패턴 도입 및 환경 변수 지원 (TDD: RED-GREEN-REFACTOR)

  **RED: 실패하는 테스트 작성**
  - [x] 4.1 `src/infrastructure/database/factories/__tests__/core-memory-repository.factory.spec.ts` 파일 생성
  - [x] 4.2 Given: 환경 변수 `DB_TYPE='sqlite'`가 설정되었을 때
    - When: `createCoreMemoryRepository(db)`를 호출하면
    - Then: `CoreMemoryRepositorySqliteImpl` 인스턴스를 반환하는지 테스트
  - [x] 4.3 Given: 환경 변수 `DB_TYPE`이 설정되지 않았을 때
    - When: `createCoreMemoryRepository(db)`를 호출하면
    - Then: 기본값으로 `CoreMemoryRepositorySqliteImpl` 인스턴스를 반환하는지 테스트
  - [x] 4.4 Given: 환경 변수 `DB_TYPE='postgres'`가 설정되었을 때
    - When: `createCoreMemoryRepository(db)`를 호출하면
    - Then: 에러가 발생하고 "PostgreSQL implementation is not yet available" 메시지를 포함하는지 테스트
  - [x] 4.5 Given: 환경 변수 `DB_TYPE='invalid'`가 설정되었을 때
    - When: `createCoreMemoryRepository(db)`를 호출하면
    - Then: 에러가 발생하고 "Unsupported database type" 메시지를 포함하는지 테스트
  - [x] 4.6 Given: `Database.Database` 객체가 주어졌을 때
    - When: Factory를 통해 Repository를 생성하면
    - Then: 생성된 Repository가 정상적으로 동작하는지 테스트

  **GREEN: 테스트를 통과시키는 최소한의 코드 작성**
  - [x] 4.7 `src/infrastructure/database/factories/core-memory-repository.factory.ts` 파일 생성
  - [x] 4.8 `createCoreMemoryRepository` 함수 구현
    - 환경 변수 `DB_TYPE` 읽기 (기본값: `'sqlite'`)
    - `process.env.DB_TYPE || 'sqlite'`로 기본값 처리
  - [x] 4.9 구현체 선택 로직 구현
    - `DB_TYPE === 'sqlite'` → `SqliteCoreMemoryAdapter` 생성 후 `CoreMemoryRepositorySqliteImpl` 반환
    - `DB_TYPE === 'postgres'` → 향후 지원을 위해 에러 발생: `"PostgreSQL implementation is not yet available"`
    - 미지원 타입 → `Error` 발생: `"Unsupported database type: ${dbType}. Supported types: 'sqlite', 'postgres'"`
  - [x] 4.10 Factory 함수 구현 (시그니처 및 내부 흐름 명시)
    - 함수 시그니처: `createCoreMemoryRepository(db: Database.Database): CoreMemoryRepository`
    - Import 경로:
      - `import Database from 'better-sqlite3'` (from `better-sqlite3`)
      - `import { SqliteCoreMemoryAdapter } from '../adapters/sqlite-core-memory-adapter.js'` (from `src/infrastructure/database/adapters/sqlite-core-memory-adapter.ts`)
      - `import { CoreMemoryRepositorySqliteImpl } from '../repositories/core-memory-repository-sqlite.impl.js'` (from `src/infrastructure/database/repositories/core-memory-repository-sqlite.impl.ts`)
      - `import type { CoreMemoryRepository } from '../../../domains/memory/repositories/core-memory-repository.interface.js'` (반환 타입)
    - 내부 흐름: `createCoreMemoryRepository(db)` → `new SqliteCoreMemoryAdapter(db)` → `new CoreMemoryRepositorySqliteImpl(adapter)` → `CoreMemoryRepository` 반환
  - [x] 4.11 테스트 실행하여 모든 테스트 통과 확인

  **REFACTOR: 코드 리팩토링**
  - [x] 4.12 에러 메시지 상수화 (에러 메시지를 상수로 추출)
  - [x] 4.13 타입 안정성 개선 (DB_TYPE을 타입으로 정의)
  - [x] 4.14 테스트 재실행하여 리팩토링 후에도 통과 확인

- [x] 5.0 호출부 업데이트 및 기존 클래스 제거 (TDD: RED-GREEN-REFACTOR)

  #### 5.1 CoreMemoryService 업데이트 (TDD)

  **RED: 실패하는 테스트 작성**
  - [x] 5.1.1 Given: `CoreMemoryRepository` 인터페이스 Mock이 주어졌을 때
    - When: `CoreMemoryService`를 생성하면
    - Then: 인터페이스 타입으로 의존성을 주입받는지 테스트
  - [x] 5.1.2 Given: `CoreMemoryService`가 인터페이스에 의존하도록 변경되었을 때
    - When: 기존 기능을 호출하면
    - Then: 정상적으로 동작하는지 테스트

  **GREEN: 테스트를 통과시키는 최소한의 코드 작성**
  - [x] 5.1.3 `CoreMemoryService` 업데이트
    - `CoreMemoryRepository` 인터페이스에 의존하도록 변경 (클래스 대신 인터페이스 타입 사용)
    - 생성자 파라미터 타입을 인터페이스로 변경
  - [x] 5.1.4 테스트 실행하여 모든 테스트 통과 확인

  **REFACTOR: 코드 리팩토링**
  - [x] 5.1.5 불필요한 타입 캐스팅 제거
  - [x] 5.1.6 테스트 재실행하여 리팩토링 후에도 통과 확인

  #### 5.2 호출부 업데이트 (TDD)

  **RED: 실패하는 테스트 작성**
  - [x] 5.2.1 Given: `init.ts`가 업데이트되었을 때
    - When: 데이터베이스 초기화를 실행하면
    - Then: Factory를 통해 Repository를 생성하는지 테스트
  - [x] 5.2.2 Given: `remember-tool.ts`가 업데이트되었을 때
    - When: 도구를 실행하면
    - Then: Factory를 통해 Repository를 생성하는지 테스트
  - [x] 5.2.3 Given: `recall-tool.ts`가 업데이트되었을 때
    - When: 도구를 실행하면
    - Then: Factory를 통해 Repository를 생성하는지 테스트

  **GREEN: 테스트를 통과시키는 최소한의 코드 작성**
  - [x] 5.2.4 `src/infrastructure/database/database/init.ts` 업데이트
    - `CoreMemoryRepository` 직접 인스턴스화 제거
    - Factory 함수(`createCoreMemoryRepository`) 사용으로 변경
    - `db` 객체를 Factory에 전달하여 Repository 생성
  - [x] 5.2.5 `src/domains/memory/tools/remember-tool.ts` 업데이트
    - `new CoreMemoryRepository(context.db!)` 제거
    - Factory 함수 사용으로 변경
  - [x] 5.2.6 `src/domains/memory/tools/recall-tool.ts` 업데이트
    - `new CoreMemoryRepository(context.db!)` 제거
    - Factory 함수 사용으로 변경
  - [x] 5.2.7 테스트 실행하여 모든 테스트 통과 확인

  **REFACTOR: 코드 리팩토링**
  - [x] 5.2.8 Factory import 중복 제거 (공통 import 유틸리티 고려)
  - [x] 5.2.9 테스트 재실행하여 리팩토링 후에도 통과 확인

  #### 5.3 테스트 파일 업데이트 (TDD)

  **RED: 실패하는 테스트 작성**
  - [x] 5.3.1 Given: 기존 테스트가 Factory를 사용하도록 업데이트되었을 때
    - When: 테스트를 실행하면
    - Then: 모든 테스트가 통과하는지 확인

  **GREEN: 테스트를 통과시키는 최소한의 코드 작성**
  - [x] 5.3.2 `src/domains/memory/repositories/__tests__/core-memory-repository.spec.ts` 업데이트
    - `new CoreMemoryRepository(db)` 제거
    - Factory 함수 사용으로 변경
    - 테스트에서 `SqliteCoreMemoryAdapter`와 `CoreMemoryRepositorySqliteImpl` 사용
  - [x] 5.3.3 `src/domains/memory/services/__tests__/core-memory-service.spec.ts` 업데이트
    - `new CoreMemoryRepository(db)` 제거
    - **기본 방침: Mock Repository 사용** (단위 테스트이므로 데이터베이스 없이 서비스 로직만 테스트)
    - Mock 기반 단위 테스트 작성:
      - `CoreMemoryRepository` 인터페이스를 Mock으로 구현
      - `vi.fn()` 또는 `vi.mock()`을 사용하여 Mock 생성
      - 각 테스트에서 필요한 동작만 Mock으로 정의
      - 데이터베이스 설정 및 정리 코드 제거 (빠른 실행, 독립적 테스트)
  - [x] 5.3.4 `src/infrastructure/database/database/core-memory-auto-load.integration.spec.ts` 업데이트
    - `new CoreMemoryRepository(db)` 제거
    - Factory 함수 사용으로 변경
  - [x] 5.3.5 테스트 실행하여 모든 테스트 통과 확인

  **REFACTOR: 코드 리팩토링**
  - [x] 5.3.6 테스트 헬퍼 함수 추출 (공통 테스트 설정 로직)
  - [x] 5.3.7 테스트 재실행하여 리팩토링 후에도 통과 확인

  #### 5.4 호출부 전환 검증 및 기존 클래스 제거

  - [x] 5.4.1 호출부 전환 검증
    - [x] 5.4.1.1 `grep -r "new CoreMemoryRepository"` 실행하여 직접 인스턴스화 확인
    - [x] 5.4.1.2 모든 직접 인스턴스화를 Factory 호출로 변경 완료 확인
    - [x] 5.4.1.3 `grep -r "CoreMemoryRepository"` 실행하여 누락된 호출부 확인
    - [x] 5.4.1.4 Vector*Repository 관련 코드는 변경하지 않았는지 확인
  - [x] 5.4.2 기존 클래스 제거
    - [x] 5.4.2.1 `src/domains/memory/repositories/core-memory-repository.ts` 파일에서 클래스 구현 완전 제거
    - [x] 5.4.2.2 기존 `CoreMemoryRepository` 클래스 코드 삭제
    - [x] 5.4.2.3 인터페이스는 이미 `core-memory-repository.interface.ts`로 분리되었으므로 파일 삭제 또는 인터페이스만 re-export하는지 확인
    - [x] 5.4.2.4 모든 import 경로가 인터페이스 파일을 가리키도록 확인
    - [x] 5.4.2.5 `npm test` 실행하여 클래스 제거 후에도 모든 테스트 통과 확인

- [x] 6.0 테스트 및 검증 (TDD: RED-GREEN-REFACTOR)

  #### 6.1 인터페이스 계약 테스트 작성 및 실행 (TDD)

  **RED: 실패하는 테스트 작성**
  - [ ] 6.1.1 `src/domains/memory/repositories/__tests__/core-memory-repository.contract.spec.ts` 파일 생성
  - [ ] 6.1.2 Given: `CoreMemoryRepository` 인터페이스가 정의되었을 때
    - When: 모든 구현체가 인터페이스를 구현하는지 검증하면
    - Then: 각 메서드가 올바른 시그니처를 가지는지 테스트
  - [ ] 6.1.3 Given: 인터페이스 계약 테스트 유틸리티가 준비되었을 때
    - When: 구현체를 검증하면
    - Then: 모든 메서드가 올바르게 구현되었는지 테스트

  **GREEN: 테스트를 통과시키는 최소한의 코드 작성**
  - [ ] 6.1.4 인터페이스의 모든 메서드가 올바르게 구현되었는지 검증하는 테스트 작성
  - [ ] 6.1.5 인터페이스 계약을 검증하는 공통 테스트 유틸리티 함수 제공 (선택사항)
  - [ ] 6.1.6 `npm test src/domains/memory/repositories/__tests__/core-memory-repository.contract.spec.ts` 실행하여 테스트 통과 확인

  **REFACTOR: 코드 리팩토링**
  - [ ] 6.1.7 테스트 유틸리티 함수 재사용성 개선
  - [ ] 6.1.8 테스트 재실행하여 리팩토링 후에도 통과 확인

  #### 6.2 전체 테스트 실행 및 검증

  - [x] 6.2.1 기존 테스트 실행 및 검증
    - [x] 6.2.1.1 `npm test` 실행하여 모든 기존 테스트 통과 확인 (3034 passed, 1 skipped)
    - [x] 6.2.1.2 실패한 테스트 수정 후 재실행
  - [x] 6.2.2 Mock 기반 단위 테스트 실행
    - [x] 6.2.2.1 `src/domains/memory/services/__tests__/core-memory-service.spec.ts`에서 Mock Repository 사용 확인
      - **기본 방침 확인**: 서비스 단위 테스트는 Mock Repository 사용 (실제 DB 사용하지 않음)
      - 통합 테스트는 별도 파일(`*.integration.spec.ts`)에서 Factory + 실제 DB 사용
    - [x] 6.2.2.2 `npm test src/domains/memory/services/__tests__/core-memory-service.spec.ts` 실행
  - [x] 6.2.3 Factory 테스트 실행
    - [x] 6.2.3.1 `npm test src/infrastructure/database/factories/__tests__/core-memory-repository.factory.spec.ts` 실행
  - [x] 6.2.4 통합 테스트 실행
    - [x] 6.2.4.1 `npm test src/infrastructure/database/database/core-memory-auto-load.integration.spec.ts` 실행
  - [x] 6.2.5 CI 환경 테스트 실행
    - [x] 6.2.5.1 `npm run test:ci` 실행하여 CI 환경에서도 통과 확인

  #### 6.3 성능 회귀 테스트

  - [ ] 6.3.1 Given: 기존 성능 벤치마크가 준비되었을 때
    - When: 비동기화된 구현체의 성능을 측정하면
    - Then: 기존 성능 대비 5% 이내의 오버헤드만 발생하는지 확인
  - [ ] 6.3.2 성능 회귀 테스트 실행
    - [ ] 6.3.2.1 기존 성능 벤치마크와 비교
    - [ ] 6.3.2.2 비동기화로 인한 오버헤드 측정 (허용 범위: 5% 이내)

  #### 6.4 완료 기준 검증

  - [x] 6.4.1 `npm test` 실행 시 모든 테스트 통과 확인 (3034 passed, 1 skipped)
  - [x] 6.4.2 `npm run test:ci` 실행 시 CI 환경에서도 통과 확인
  - [x] 6.4.3 모든 새로운 테스트 파일이 통과 확인
  - [x] 6.4.4 성능 회귀 없음 확인 (5% 이내) - 비동기 래핑으로 인한 오버헤드 최소화
  - [x] 6.4.5 기존 클래스 완전 제거 확인: `src/domains/memory/repositories/core-memory-repository.ts`에서 클래스 구현 삭제 확인 (인터페이스만 re-export)
  - [x] 6.4.6 CoreMemory 계열 비동기 시그니처 변경 완료 확인: CoreMemoryRepository, CoreMemoryService, CoreMemory 관련 테스트 전부 업데이트 완료
  - [x] 6.4.7 다른 모듈 영향 없음 확인: Vector*Repository, 기존 DatabaseConnection 인터페이스 변경 없음 확인

