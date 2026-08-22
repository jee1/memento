# PRD: 종합 코드 개선 (클린코드 철학 기반)

## 1. Introduction/Overview

Memento 프로젝트는 MCP(Model Context Protocol) 서버로서 복잡한 메모리 관리 시스템을 구현하고 있습니다. 최근 수행된 코드 리뷰 결과, 전반적으로 양호한 코드 품질을 유지하고 있으나 클린코드 철학에 맞춰 개선이 필요한 영역들이 발견되었습니다.

**발견된 주요 개선 영역:**
1. **대형 파일 분리**: `HybridSearchEngine` (1,543줄), `TripleExtractionService` (1,163줄), `SemanticMemoryUpdateService` (945줄) 등이 단일 책임 원칙(SRP) 위반 위험
2. **긴 함수 분리**: `fetchProceduralMemoryMatches()` (155줄), `combineAndSortResults()` (115줄), `updateSemanticMemory()` (118줄) 등이 가독성과 테스트 용이성 저해
3. **타입 안정성 부족**: 프로젝트 전체에서 `any` 타입이 489개 사용되어 타입 안정성 저해
4. **MCP 도구 노출 정책 불일치**: 규칙 문서는 5개 도구만 노출을 규정하나 실제로는 12+개 도구가 등록됨
5. **console 로깅 과다**: 비테스트 코드에서 117개의 `console.*` 사용이 발견되어 로깅 정책 위반
6. **전역 변수 사용**: `globalThis`를 통한 전역 상태 관리로 테스트 어려움 및 부작용 발생 가능
7. **중복 코드**: `ToolContext` 생성 로직 등이 여러 곳에서 반복됨
8. **에러 처리 일관성**: 일부 코드에서 단순 `throw`만 하고 구조화된 에러 로깅 미적용

**목표**: 클린코드 철학에 맞춰 단계적으로 코드 품질을 개선하여 유지보수성, 테스트 용이성, 타입 안정성을 향상시키고, 모든 기존 기능과 API 호환성을 100% 유지합니다.

## 2. Goals

1. **클린코드 원칙 준수**: 파일 크기 500줄 이하, 함수 크기 50줄 이하로 제한
2. **타입 안정성 강화**: `any` 타입을 489개에서 50개 이하로 감소
3. **MCP 도구 노출 정책 정합성**: 규칙 문서와 실제 구현 간 불일치 해소
4. **로깅 정책 통일**: 비테스트 코드에서 `console.*` 사용 제거 및 표준 로거 사용
5. **전역 변수 제거**: `globalThis` 사용을 클래스 기반 상태 관리로 전환
6. **중복 코드 제거**: 공통 로직을 팩토리 함수/유틸리티로 통일
7. **에러 처리 일관성**: 모든 에러를 `ErrorLoggingService`를 통해 구조화된 로깅
8. **기존 기능 100% 유지**: 모든 기존 테스트 통과 및 API 호환성 유지
9. **단계적 개선**: 장기 계획(3개월 이상)으로 리스크 최소화하며 점진적 개선

## 3. User Stories

### 3.1 개발자 관점

**As a** 백엔드 개발자  
**I want** 작은 단위의 모듈로 분리된 코드  
**So that** 코드를 이해하고 수정하기 쉬워집니다.

**As a** 테스트 작성자  
**I want** 작은 함수로 분리된 코드  
**So that** 단위 테스트를 작성하고 유지보수하기 쉬워집니다.

**As a** TypeScript 개발자  
**I want** `any` 타입을 구체적인 타입으로 교체  
**So that** 컴파일 타임에 타입 에러를 잡을 수 있습니다.

**As a** MCP 서버 개발자  
**I want** 모든 로깅이 표준 로깅 서비스를 통해 이루어짐  
**So that** stdout 충돌 없이 안정적으로 동작합니다.

**As a** 코드 리뷰어  
**I want** 명확한 책임을 가진 작은 모듈들  
**So that** 코드 리뷰가 쉬워지고 버그를 쉽게 발견할 수 있습니다.

### 3.2 유지보수 담당자 관점

**As a** 유지보수 담당자  
**I want** 중복 코드가 제거됨  
**So that** 버그 수정 시 여러 곳을 수정할 필요가 없습니다.

**As a** 유지보수 담당자  
**I want** 일관된 에러 처리 패턴  
**So that** 에러 추적과 디버깅이 쉬워집니다.

**As a** 유지보수 담당자  
**I want** 규칙 문서와 실제 구현이 일치함  
**So that** 혼란 없이 코드를 이해할 수 있습니다.

### 3.3 시스템 관점

**As a** 시스템  
**I want** 모듈별로 명확하게 분리된 책임  
**So that** 변경 사항의 영향을 최소화하고 버그를 쉽게 추적할 수 있습니다.

**As a** 빌드 시스템  
**I want** 타입 안정성이 보장된 코드  
**So that** 런타임 에러를 줄이고 코드 품질을 향상시킬 수 있습니다.

**As a** 테스트 시스템  
**I want** 작은 단위의 테스트 가능한 함수들  
**So that** 테스트 커버리지를 높이고 회귀 테스트를 쉽게 할 수 있습니다.

## 4. Functional Requirements

### 4.1 Phase 1: 대형 파일 분리 (우선순위: 최고)

#### 4.1.1 HybridSearchEngine 분리

**FR-1.1**: `HybridSearchEngine` 클래스를 책임별로 분리
- 현재 상태: `src/domains/search/algorithms/hybrid-search-engine.ts` (1,543줄)
- 분리 전략:
  - `SearchResultCombiner`: 결과 결합 및 정렬 로직 (현재 `combineAndSortResults()` 메서드)
  - `ProceduralMemoryMatcher`: 프로시저 메모리 매칭 로직 (현재 `fetchProceduralMemoryMatches()` 메서드)
  - `HybridSearchEngine`: 메인 검색 로직만 유지 (500줄 이하 목표)
- 각 파일은 500줄 이하로 제한

**FR-1.2**: 분리된 클래스 간 인터페이스 정의
- `ISearchResultCombiner` 인터페이스 정의
- `IProceduralMemoryMatcher` 인터페이스 정의
- 의존성 주입 패턴 적용

**FR-1.3**: 기존 API 호환성 유지
- `HybridSearchEngine`의 공개 API는 변경하지 않음
- 내부적으로 분리된 클래스들을 조합하여 동작

#### 4.1.2 TripleExtractionService 분리

**FR-1.4**: `TripleExtractionService` 클래스를 책임별로 분리
- 현재 상태: `src/services/semantic-memory/triple-extraction-service.ts` (1,163줄)
- 분리 전략:
  - `TripleExtractor`: 추출 로직만 담당
  - `TripleParser`: 파싱 로직만 담당
  - `TripleNormalizer`: 정규화 로직만 담당
  - `TripleExtractionService`: 조합 및 오케스트레이션만 담당 (500줄 이하 목표)
- 각 파일은 500줄 이하로 제한

**FR-1.5**: 분리된 클래스 간 인터페이스 정의
- `ITripleExtractor`, `ITripleParser`, `ITripleNormalizer` 인터페이스 정의
- 의존성 주입 패턴 적용

#### 4.1.3 SemanticMemoryUpdateService 분리

**FR-1.6**: `SemanticMemoryUpdateService`의 긴 메서드 분리
- 현재 상태: `src/services/semantic-memory/semantic-memory-update-service.ts` (945줄)
- 분리 전략:
  - `updateSemanticMemory()` 메서드 (118줄)를 작은 함수로 분리
  - 각 함수는 50줄 이하로 제한
- 파일 크기는 유지하되 함수 크기만 개선

### 4.2 Phase 2: 긴 함수 분리 (우선순위: 높음)

**FR-2.1**: `fetchProceduralMemoryMatches()` 메서드 분리
- 현재 상태: 155줄
- 분리 전략:
  - `embedQuery()`: 쿼리 임베딩 생성
  - `findCandidates()`: 후보 찾기
  - `filterByRelevance()`: 관련성 필터링
  - `sortByScore()`: 점수 정렬
- 각 메서드는 50줄 이하로 제한

**FR-2.2**: `combineAndSortResults()` 메서드 분리
- 현재 상태: 115줄
- 분리 전략:
  - `normalizeScores()`: 점수 정규화
  - `mergeResults()`: 결과 병합
  - `deduplicateResults()`: 중복 제거
  - `sortByFinalScore()`: 최종 점수 정렬
- 각 메서드는 50줄 이하로 제한

**FR-2.3**: `updateSemanticMemory()` 메서드 분리
- 현재 상태: 118줄
- 분리 전략:
  - `validateInput()`: 입력 검증
  - `prepareUpdateData()`: 업데이트 데이터 준비
  - `applyUpdates()`: 업데이트 적용
  - `notifyListeners()`: 리스너 알림
- 각 메서드는 50줄 이하로 제한

**FR-2.4**: 분리된 함수에 대한 단위 테스트 작성
- 각 단계별 함수에 대한 단위 테스트
- 통합 테스트로 전체 파이프라인 검증

### 4.3 Phase 3: 타입 안정성 강화 (우선순위: 높음)

**FR-3.1**: 핵심 로직의 `any` 타입 제거
- 현재 상태: 489개
- 우선순위:
  1. `src/tools/*` (도구 경계 타입)
  2. `src/domains/search/*` (검색 도메인 타입)
  3. `src/server/*` (서버 진입점 타입)
  4. `src/npm-client/*` (클라이언트 타입)
- 목표: 489개 → 50개 이하

**FR-3.2**: SQL 파라미터 타입 정의
- 현재 문제: `any[]` 타입 사용
- 위치:
  - `src/server/bootstrap.ts:188`
  - `src/services/quality-assurance/quality-threshold-manager.ts:141`
  - `src/domains/search/repositories/vector-search.repository.ts:347`
- 해결: `SqlParam` 타입 정의 및 적용
  ```typescript
  type SqlParam = string | number | boolean | null | Date;
  const params: SqlParam[] = [];
  ```

**FR-3.3**: 타입 단언 최소화
- `as any` 사용을 최소화하고 타입 가드 사용
- 제네릭을 활용한 재사용 가능한 타입 정의

**FR-3.4**: 새 코드에 엄격한 타입 적용
- 새로운 코드 작성 시 `any` 타입 사용 금지
- TypeScript strict 모드 준수

### 4.4 Phase 4: 전역 변수 제거 (우선순위: 중간)

**FR-4.1**: `globalThis` 사용을 클래스로 캡슐화
- 현재 문제: `src/server/index.ts`에서 `globalThis` 사용
- 위치: `src/server/index.ts:536, 549, 555`
- 해결: `ServerState` 클래스 생성
  ```typescript
  class ServerState {
    private static transportConnected = false;
    private static serverInitialized = false;
    
    static setTransportConnected(value: boolean): void;
    static isTransportConnected(): boolean;
    static setServerInitialized(value: boolean): void;
    static isServerInitialized(): boolean;
  }
  ```

**FR-4.2**: 모든 `globalThis` 사용을 `ServerState`로 교체
- `src/server/index.ts`의 모든 `globalThis` 사용 교체
- 테스트 가능성 향상

### 4.5 Phase 5: MCP 도구 노출 정책 정합성 (우선순위: 중간)

**FR-5.1**: 현재 등록된 도구 확인
- `src/tools/index.ts`에서 등록된 도구 목록 확인
- 규칙 문서 (`.cursor/rules/mcp-tools-architecture.mdc`)와 비교

**FR-5.2**: 정책 정합성 확보
- 옵션 1: 규칙 문서 업데이트 (실제 등록 도구에 맞춤)
- 옵션 2: 실제 등록 도구를 규칙에 맞춤 (5개만 노출)
- 결정: 규칙 문서와 실제 구현 중 어느 것을 기준으로 할지 결정 필요

**FR-5.3**: 관리/운영성 도구 분리
- MCP 클라이언트에 노출되지 않아야 할 도구들을 별도 네임스페이스로 분리
- 내부 관리용 도구와 클라이언트 도구 구분

### 4.6 Phase 6: 로깅 정책 통일 (우선순위: 중간)

**FR-6.1**: 표준 로거 모듈 확인
- 사용할 로거: `src/shared/utils/logger.ts`의 `logger` 객체
- 로거 인터페이스:
  ```typescript
  logger.debug(message: string, meta?: Record<string, unknown>): void
  logger.info(message: string, meta?: Record<string, unknown>): void
  logger.warn(message: string, meta?: Record<string, unknown>): void
  logger.error(message: string, meta?: Record<string, unknown>): void
  ```

**FR-6.2**: 비테스트 코드의 `console.*` 제거
- 현재 상태: 비테스트 코드에서 117개 발견
- 우선순위:
  1. `src/infrastructure/database/sqlite/migrate.ts`
  2. `src/infrastructure/database/sqlite/migration/migration-runner.ts`
  3. `src/infrastructure/scheduler/batch-scheduler.ts`
  4. `src/infrastructure/logging/triple-extraction-logger.ts`
- 목표: 비테스트 코드에서 `console.*` 0개

**FR-6.3**: 예외 규칙 정의
- 테스트 파일 (`*.spec.ts`, `test-*.ts`): `console.log` 사용 허용
- CLI 스크립트 (`scripts/`): `console.log` 사용 허용
- ESLint `no-console` 규칙에 `overrides` 사용

### 4.7 Phase 7: 중복 코드 제거 (우선순위: 낮음)

**FR-7.1**: `ToolContext` 생성 로직 통일
- 현재 문제: 여러 곳에서 `ToolContext` 생성 로직 반복
- 해결: 팩토리 함수 생성
  ```typescript
  export function createToolContext(
    db: Database.Database,
    services: ServerServices
  ): ToolContext {
    return {
      db,
      searchEngine: services.searchEngine,
      hybridSearchEngine: services.hybridSearchEngine,
      embeddingService: services.embeddingService,
      // ... 나머지 서비스들
    };
  }
  ```

**FR-7.2**: 에러 처리 패턴 통일
- 현재 문제: 유사한 try-catch 블록이 여러 곳에 반복
- 해결: 공통 에러 핸들러 함수 생성
  ```typescript
  export async function withErrorHandling<T>(
    operation: () => Promise<T>,
    context: ErrorContext
  ): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      errorLoggingService.logError(
        error instanceof Error ? error : new Error(String(error)),
        ErrorSeverity.MEDIUM,
        ErrorCategory.UNKNOWN,
        context
      );
      throw error;
    }
  }
  ```

### 4.8 Phase 8: 에러 처리 일관성 (우선순위: 낮음)

**FR-8.1**: 모든 에러를 `ErrorLoggingService`를 통해 로깅
- 현재 문제: 일부 코드에서 단순 `throw`만 하고 있음
- 해결: 모든 에러를 구조화된 로깅
  ```typescript
  try {
    await riskyOperation();
  } catch (error) {
    errorLoggingService.logError(
      error instanceof Error ? error : new Error(String(error)),
      ErrorSeverity.MEDIUM,
      ErrorCategory.UNKNOWN,
      {
        operation: 'riskyOperation',
        context: { /* 추가 컨텍스트 */ }
      }
    );
    throw new Error(`Operation failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  ```

**FR-8.2**: 커스텀 에러 클래스 사용 권장
- `AnchorError`, `MemoryNotFoundError` 등 기존 커스텀 에러 클래스 활용
- 필요 시 새로운 커스텀 에러 클래스 추가

## 5. Non-Goals (Out of Scope)

1. **전체 코드베이스 일괄 리팩토링**: 이번 작업은 우선순위가 높은 파일들에 집중하며, 다른 파일들은 향후 단계에서 처리
2. **성능 최적화**: 이번 작업의 주요 목표는 코드 구조 개선이며, 성능 최적화는 별도 작업으로 진행
3. **API 변경**: 기존 API 인터페이스는 유지하며, 내부 구현만 개선
4. **데이터베이스 스키마 변경**: 데이터베이스 스키마 변경은 포함하지 않음
5. **로깅 시스템 재설계**: 기존 표준 로깅 서비스를 활용하며, 새로운 로깅 시스템 구축은 제외
6. **테스트 파일 리팩토링**: 테스트 파일의 `console.log` 사용은 허용되므로 제외

## 6. Design Considerations

### 6.1 클린코드 원칙

- **단일 책임 원칙 (SRP)**: 각 클래스/함수는 하나의 책임만 가짐
- **작은 함수**: 함수는 50줄 이하로 제한
- **작은 파일**: 파일은 500줄 이하로 제한
- **명확한 네이밍**: 함수/변수명이 의도를 명확히 표현
- **중복 제거 (DRY)**: 공통 로직은 팩토리 함수/유틸리티로 통일

### 6.2 아키텍처 패턴

- **의존성 주입**: 분리된 모듈들은 의존성 주입을 통해 연결
- **인터페이스 기반 설계**: 각 모듈은 명확한 인터페이스를 통해 통신
- **팩토리 패턴**: 공통 객체 생성 로직을 팩토리 함수로 통일

### 6.3 타입 안정성

- **구체적 타입 정의**: `any` 타입 대신 구체적인 타입 정의
- **타입 가드 활용**: 런타임 타입 체크를 위한 타입 가드 함수
- **제네릭 활용**: 재사용 가능한 타입 정의

### 6.4 파일 구조

**⚠️ 중요: 기존 저장소 구조 유지**

리포지토리 가이드라인(`AGENTS.md`)에 따라 기존 디렉터리 구조를 유지합니다:
- 도메인 로직: `src/domains/` (도메인별 분리)
- 서비스: `src/services/` (서비스 레이어)
- 알고리즘: `src/algorithms/` (검색 엔진)
- 서버 엔트리포인트: `src/server/` (MCP 서버)

**분리 전략 예시**:
```
src/
├── domains/
│   └── search/
│       └── algorithms/
│           ├── hybrid-search-engine.ts (메인, 500줄 이하)
│           ├── search-result-combiner.ts (결과 결합, 500줄 이하)
│           └── procedural-memory-matcher.ts (프로시저 매칭, 500줄 이하)
├── services/
│   └── semantic-memory/
│       ├── triple-extraction-service.ts (조합, 500줄 이하)
│       ├── triple-extractor.ts (추출, 500줄 이하)
│       ├── triple-parser.ts (파싱, 500줄 이하)
│       └── triple-normalizer.ts (정규화, 500줄 이하)
└── server/
    └── server-state.ts (전역 상태 관리 클래스)
```

## 7. Technical Considerations

### 7.1 의존성

- 기존 TypeScript, Node.js 버전 유지
- 기존 라이브러리 의존성 유지 (추가 의존성 없음)

### 7.2 마이그레이션 전략

- **점진적 마이그레이션**: 한 번에 모든 것을 변경하지 않고 모듈별로 단계적 진행
- **하위 호환성 유지**: 기존 API는 래퍼를 통해 유지
- **기능 플래그**: 필요시 기능 플래그를 통해 새/구 구현 전환 가능

### 7.3 테스트 전략

- **기존 테스트 통과 필수**: 모든 기존 테스트가 통과해야 함
- **단위 테스트 추가**: 분리된 모듈에 대한 단위 테스트 작성
- **통합 테스트**: 전체 파이프라인 검증을 위한 통합 테스트

### 7.4 코드 리뷰

- 각 Phase별로 PR 분리하여 리뷰 비용 최소화
- 리팩토링 전후 비교를 위한 상세한 설명 포함

## 8. Success Metrics

### 8.1 파일 크기

#### 측정 방법
- **파일 크기 측정**: `wc -l` 또는 `cloc` 도구 사용
- **자동화 스크립트**: `scripts/check-file-sizes.ts` 생성하여 CI/CD에 통합

#### 목표 및 예외 기준
- **파일 크기**: 핵심 핸들러/서비스 파일이 500줄 이하
  - 예외: 500줄 초과 시 리뷰어 승인 필요 (예: 복잡한 타입 정의, 대량의 테스트 케이스)
  - 단계별 목표: Phase 1 완료 시 80% 파일이 500줄 이하
- **함수 크기**: 단일 함수가 50줄 이하
  - 예외: 50줄 초과 시 리뷰어 승인 필요 (예: 복잡한 알고리즘, 에러 처리 로직)
  - 단계별 목표: Phase 2 완료 시 90% 함수가 50줄 이하

### 8.2 타입 안정성

#### 측정 방법
- **any 타입 개수 측정**: 
  ```bash
  grep -r "\bany\b" src/ --include="*.ts" | grep -v "node_modules" | wc -l
  ```
- **자동화 스크립트**: `scripts/count-any-types.ts` 생성
- **ESLint 규칙**: `@typescript-eslint/no-explicit-any` 활성화 (경고 레벨)

#### 목표 및 예외 기준
- **any 타입 개수**: 489개 → 50개 이하 (단계별 스냅샷)
  - 단계별 목표:
    - Phase 3 시작 전: 489개 (베이스라인)
    - Phase 3 중간: 200개 이하
    - Phase 3 완료: 50개 이하
  - 예외 허용 기준:
    - 타입 정의가 불가능한 경우 (예: 동적 JSON 파싱, 외부 라이브러리 인터페이스)
    - 예외 사용 시 주석으로 이유 명시 필수
- **타입 체크 통과**: `npm run type-check` (`tsc --noEmit`) 통과 필수

### 8.3 로깅 정책

#### 측정 방법
- **console.log 개수 측정**:
  ```bash
  grep -r "console\." src/ --include="*.ts" | grep -v "node_modules" | grep -v "\.spec\.ts" | grep -v "test-" | wc -l
  ```
- **자동화 스크립트**: `scripts/count-console-logs.ts` 생성
- **ESLint 규칙**: `no-console` 규칙 활성화 (경고 레벨, 테스트/CLI 예외)

#### 목표 및 예외 기준
- **비테스트 코드 console.log**: 117개 → 0개
  - 비테스트 코드 정의: `src/` 내 `*.spec.ts`, `test-*.ts`, `scripts/` 제외
  - 예외: 테스트 파일(`*.spec.ts`, `test-*.ts`), CLI 스크립트(`scripts/`)는 제외
- **로깅 일관성**: 모든 로깅이 표준 로거를 통해 이루어짐

### 8.4 MCP 도구 노출 정책

#### 측정 방법
- **등록된 도구 개수**: `src/tools/index.ts`에서 등록된 도구 개수 확인
- **규칙 문서 확인**: `.cursor/rules/mcp-tools-architecture.mdc`와 비교

#### 목표
- **정책 정합성**: 규칙 문서와 실제 구현이 일치
- **도구 분리**: 관리/운영성 도구와 클라이언트 도구 구분

### 8.5 전역 변수 제거

#### 측정 방법
- **globalThis 사용 개수**: 
  ```bash
  grep -r "globalThis" src/ --include="*.ts" | wc -l
  ```
- **목표**: `globalThis` 사용 0개 (또는 최소화)

### 8.6 중복 코드 제거

#### 측정 방법
- **ToolContext 생성 위치**: `grep -r "ToolContext" src/ --include="*.ts" | wc -l`
- **목표**: 팩토리 함수 사용으로 중복 제거

### 8.7 에러 처리 일관성

#### 측정 방법
- **ErrorLoggingService 사용률**: 에러 발생 지점에서 `ErrorLoggingService` 사용 비율
- **목표**: 모든 에러가 `ErrorLoggingService`를 통해 로깅됨

### 8.8 종합 성공 기준

- **기존 테스트 통과율**: 100% (`npm test` 통과 필수)
- **Lint 통과**: 각 단계 후 `npm run lint` 통과
- **타입 체크 통과**: 각 단계 후 `npm run type-check` 통과
- **성능 저하 없음**: 리팩토링 전후 성능 비교 (목표: ±5% 이내)
- **API 호환성**: 모든 기존 API가 정상 동작

## 9. Implementation Plan

### Phase 1: 대형 파일 분리 (예상 기간: 3-4주)

1. **HybridSearchEngine 분리**
   - `SearchResultCombiner` 클래스 생성
   - `ProceduralMemoryMatcher` 클래스 생성
   - `HybridSearchEngine` 리팩토링
   - 인터페이스 정의 및 의존성 주입 적용
   - 테스트 작성 및 통과 확인

2. **TripleExtractionService 분리**
   - `TripleExtractor` 클래스 생성
   - `TripleParser` 클래스 생성
   - `TripleNormalizer` 클래스 생성
   - `TripleExtractionService` 리팩토링
   - 인터페이스 정의 및 의존성 주입 적용
   - 테스트 작성 및 통과 확인

3. **SemanticMemoryUpdateService 메서드 분리**
   - `updateSemanticMemory()` 메서드를 작은 함수로 분리
   - 각 함수는 50줄 이하로 제한
   - 테스트 작성 및 통과 확인

**완료 조건**: 
- 모든 파일이 500줄 이하 (`scripts/check-file-sizes.ts`로 검증)
- 모든 함수가 50줄 이하 (ESLint `max-lines-per-function` 규칙)
- 모든 기존 테스트 통과 (`npm test`)
- Lint 및 타입 체크 통과 (`npm run lint && npm run type-check`)

### Phase 2: 긴 함수 분리 (예상 기간: 2-3주)

1. **fetchProceduralMemoryMatches() 분리**
   - `embedQuery()` 메서드 추출
   - `findCandidates()` 메서드 추출
   - `filterByRelevance()` 메서드 추출
   - `sortByScore()` 메서드 추출
   - 각 메서드는 50줄 이하로 제한

2. **combineAndSortResults() 분리**
   - `normalizeScores()` 메서드 추출
   - `mergeResults()` 메서드 추출
   - `deduplicateResults()` 메서드 추출
   - `sortByFinalScore()` 메서드 추출
   - 각 메서드는 50줄 이하로 제한

3. **updateSemanticMemory() 분리**
   - `validateInput()` 메서드 추출
   - `prepareUpdateData()` 메서드 추출
   - `applyUpdates()` 메서드 추출
   - `notifyListeners()` 메서드 추출
   - 각 메서드는 50줄 이하로 제한

4. **테스트 작성**
   - 각 단계별 함수 단위 테스트
   - 통합 테스트

**완료 조건**:
- 각 메서드가 50줄 이하 (ESLint `max-lines-per-function` 규칙)
- 모든 기존 테스트 통과 (`npm test`)
- 새로운 단위 테스트 작성 완료

### Phase 3: 타입 안정성 강화 (예상 기간: 4-5주)

1. **SQL 파라미터 타입 정의**
   - `SqlParam` 타입 정의
   - `src/server/bootstrap.ts` 적용
   - `src/services/quality-assurance/quality-threshold-manager.ts` 적용
   - `src/domains/search/repositories/vector-search.repository.ts` 적용

2. **도구 경계 타입 정의**
   - `src/tools/*`의 `any` 타입 제거
   - 구체적인 타입 정의

3. **검색 도메인 타입 정의**
   - `src/domains/search/*`의 `any` 타입 제거
   - 구체적인 타입 정의

4. **서버 진입점 타입 정의**
   - `src/server/*`의 `any` 타입 제거
   - 구체적인 타입 정의

5. **클라이언트 타입 정의**
   - `src/npm-client/*`의 `any` 타입 제거
   - 구체적인 타입 정의

6. **단계별 검증**
   - 각 단계 후 `any` 타입 개수 기록
   - 타입 체크 통과 확인

**완료 조건**:
- `any` 타입 50개 이하 (`scripts/count-any-types.ts`로 검증)
- 타입 체크 통과 (`npm run type-check`)
- 새 코드에 `any` 사용 금지 (ESLint `@typescript-eslint/no-explicit-any` 경고)

### Phase 4: 전역 변수 제거 (예상 기간: 1주)

1. **ServerState 클래스 생성**
   - `src/server/server-state.ts` 생성
   - `ServerState` 클래스 구현

2. **globalThis 사용 교체**
   - `src/server/index.ts`의 모든 `globalThis` 사용을 `ServerState`로 교체
   - 테스트 가능성 향상

**완료 조건**:
- `globalThis` 사용 0개 (또는 최소화)
- 모든 기존 테스트 통과 (`npm test`)

### Phase 5: MCP 도구 노출 정책 정합성 (예상 기간: 1-2주)

1. **현재 상태 분석**
   - `src/tools/index.ts`에서 등록된 도구 목록 확인
   - 규칙 문서 (`.cursor/rules/mcp-tools-architecture.mdc`) 확인
   - 불일치 지점 파악

2. **정책 정합성 확보**
   - 규칙 문서 업데이트 또는 실제 구현 수정 결정
   - 관리/운영성 도구 분리

3. **문서화**
   - 정책 문서 업데이트
   - 도구 분류 문서화

**완료 조건**:
- 규칙 문서와 실제 구현이 일치
- 관리/운영성 도구와 클라이언트 도구 구분

### Phase 6: 로깅 정책 통일 (예상 기간: 2-3주)

1. **로깅 전환 준비**
   - 표준 로거 모듈 확인 (`src/shared/utils/logger.ts`)
   - 로깅 필드 스키마 문서화
   - ESLint 규칙 설정 (테스트/CLI 예외)

2. **우선순위 파일 교체**
   - `src/infrastructure/database/sqlite/migrate.ts` 교체
   - `src/infrastructure/database/sqlite/migration/migration-runner.ts` 교체
   - `src/infrastructure/scheduler/batch-scheduler.ts` 교체
   - `src/infrastructure/logging/triple-extraction-logger.ts` 교체

3. **모듈 단위 확장**
   - `src/infrastructure/` 하위 기타 파일 순차 교체
   - 한 모듈씩 순차적으로 교체
   - 구조화된 로깅 형식 적용 (메타데이터 객체 사용)

4. **검증**
   - 비테스트 코드 `console.log` 0개 확인 (`scripts/count-console-logs.ts` 실행)
   - 로깅 일관성 확인 (ESLint 규칙 통과)

**완료 조건**:
- 비테스트 코드 `console.log` 0개 (`scripts/count-console-logs.ts`로 검증)
- 모든 로깅이 표준 로거(`logger`)를 통해 이루어짐
- ESLint `no-console` 규칙 통과 (테스트/CLI 제외)

### Phase 7: 중복 코드 제거 (예상 기간: 1-2주)

1. **ToolContext 팩토리 함수 생성**
   - `createToolContext()` 함수 생성
   - 모든 `ToolContext` 생성 로직을 팩토리 함수로 교체

2. **에러 처리 패턴 통일**
   - `withErrorHandling()` 함수 생성
   - 공통 에러 핸들러 적용

**완료 조건**:
- `ToolContext` 생성 로직이 팩토리 함수로 통일
- 에러 처리 패턴이 공통 핸들러로 통일
- 모든 기존 테스트 통과 (`npm test`)

### Phase 8: 에러 처리 일관성 (예상 기간: 1-2주)

1. **에러 로깅 적용**
   - 모든 에러 발생 지점에서 `ErrorLoggingService` 사용
   - 구조화된 에러 로깅 적용

2. **커스텀 에러 클래스 활용**
   - 기존 커스텀 에러 클래스 활용
   - 필요 시 새로운 커스텀 에러 클래스 추가

**완료 조건**:
- 모든 에러가 `ErrorLoggingService`를 통해 로깅됨
- 커스텀 에러 클래스 활용
- 모든 기존 테스트 통과 (`npm test`)

## 10. Open Questions

1. **MCP 도구 노출 정책**: 규칙 문서와 실제 구현 중 어느 것을 기준으로 할 것인가?
   - **해결 방안**: 규칙 문서와 실제 구현을 비교하여 더 적절한 방향으로 통일

2. **파일 크기 예외**: 복잡한 타입 정의나 대량의 테스트 케이스로 인해 500줄을 초과하는 경우는 어떻게 처리할 것인가?
   - **해결 방안**: 리뷰어 승인을 받은 경우 예외 허용, 주석으로 이유 명시

3. **함수 크기 예외**: 복잡한 알고리즘이나 에러 처리 로직으로 인해 50줄을 초과하는 경우는 어떻게 처리할 것인가?
   - **해결 방안**: 리뷰어 승인을 받은 경우 예외 허용, 주석으로 이유 명시

4. **any 타입 예외**: 타입 정의가 불가능한 경우 (예: 동적 JSON 파싱, 외부 라이브러리 인터페이스)는 어떻게 처리할 것인가?
   - **해결 방안**: 주석으로 이유 명시 필수, 가능한 경우 타입 가드 함수 사용

5. **성능 영향 측정**: 리팩토링 전후 성능 벤치마크를 어느 정도의 정확도로 측정할 것인가?
   - **해결 방안**: 당시 전용 성능 벤치마크를 사용하여 ±5% 이내 목표 설정

6. **마이그레이션 기간**: 각 Phase별 예상 소요 기간은 얼마인가?
   - **해결 방안**: 총 3개월 이상의 장기 계획으로 단계적 진행

## 11. Risks and Mitigation

### 11.1 리스크

1. **기능 회귀**: 리팩토링 과정에서 기존 기능이 깨질 수 있음
2. **성능 저하**: 모듈 분리로 인한 오버헤드 발생 가능
3. **리뷰 비용 증가**: 큰 변경사항으로 인한 리뷰 시간 증가
4. **병합 충돌**: 장기간 진행되는 작업으로 인한 병합 충돌 가능
5. **타입 안정성 개선의 복잡성**: 일부 `any` 타입이 복잡한 로직에 얽혀 있어 제거가 어려울 수 있음

### 11.2 완화 전략

1. **기능 회귀 방지**: 
   - 모든 기존 테스트 통과 필수
   - 단계별 검증
   - 통합 테스트 강화
   - 코드 리뷰 필수

2. **성능 저하 방지**:
   - 리팩토링 전후 성능 벤치마크
   - 프로파일링을 통한 병목 지점 확인
   - 목표: ±5% 이내

3. **리뷰 비용 최소화**:
   - Phase별 PR 분리
   - 상세한 변경사항 설명
   - 리팩토링 전후 비교 제공

4. **병합 충돌 최소화**:
   - 작은 단위로 PR 분리
   - 빠른 병합 주기
   - 충돌 조기 발견 및 해결

5. **타입 안정성 개선의 복잡성 완화**:
   - 우선순위가 높은 영역부터 시작
   - 점진적 개선
   - 복잡한 경우는 주석으로 이유 명시 후 예외 허용

## 12. Dependencies

### 12.1 기술 스택

- 기존 TypeScript 컴파일러 및 타입 시스템
- 기존 로깅 서비스 (`src/shared/utils/logger.ts`)
- 기존 에러 로깅 서비스 (`ErrorLoggingService`)
- 기존 테스트 프레임워크 (Vitest)
- 기존 빌드 시스템 (TypeScript Compiler)

### 12.2 측정 도구

- **파일/함수 크기 측정**: `wc -l`, `cloc`, ESLint `max-lines-per-function`
- **타입 안정성 측정**: `grep`, `tsc --noEmit`, ESLint `@typescript-eslint/no-explicit-any`
- **로깅 측정**: `grep`, ESLint `no-console`
- **자동화 스크립트**: 
  - `scripts/check-file-sizes.ts` (파일 크기 검증)
  - `scripts/count-any-types.ts` (any 타입 개수 측정)
  - `scripts/count-console-logs.ts` (console.log 개수 측정)

### 12.3 경로 및 Import 영향도

- **기존 import 경로 유지**: 모든 기존 import 경로는 변경하지 않음
- **내부 모듈 분리만 수행**: 파일 분리 시에도 기존 export 경로 유지
- **래퍼 패턴 활용**: 기존 API는 래퍼 클래스를 통해 유지하여 호환성 보장

## 13. Acceptance Criteria

### Phase 1 완료 기준

- [ ] `HybridSearchEngine`이 적절한 크기로 분리됨 (500줄 이하)
- [ ] `TripleExtractionService`가 적절한 크기로 분리됨 (500줄 이하)
- [ ] `SemanticMemoryUpdateService`의 긴 메서드가 분리됨 (50줄 이하)
- [ ] 모든 파일이 500줄 이하임 (`scripts/check-file-sizes.ts`로 검증)
- [ ] 모든 함수가 50줄 이하임 (ESLint `max-lines-per-function` 규칙)
- [ ] 모든 기존 테스트 통과 (`npm test`)
- [ ] Lint 및 타입 체크 통과 (`npm run lint && npm run type-check`)

### Phase 2 완료 기준

- [ ] `fetchProceduralMemoryMatches()`가 작은 함수로 분리됨 (50줄 이하)
- [ ] `combineAndSortResults()`가 작은 함수로 분리됨 (50줄 이하)
- [ ] `updateSemanticMemory()`가 작은 함수로 분리됨 (50줄 이하)
- [ ] 각 단계별 함수에 대한 단위 테스트 작성됨
- [ ] 모든 기존 테스트 통과 (`npm test`)

### Phase 3 완료 기준

- [ ] `any` 타입이 50개 이하로 감소함 (`scripts/count-any-types.ts`로 검증)
- [ ] SQL 파라미터 타입이 정의됨 (`SqlParam` 타입)
- [ ] 핵심 로직의 도메인 타입이 정의됨
- [ ] 타입 체크 통과 (`npm run type-check`)
- [ ] 새 코드에 `any` 사용 금지 규칙 적용됨 (ESLint `@typescript-eslint/no-explicit-any` 경고)

### Phase 4 완료 기준

- [ ] `ServerState` 클래스가 생성됨
- [ ] `globalThis` 사용이 0개 (또는 최소화)
- [ ] 모든 기존 테스트 통과 (`npm test`)

### Phase 5 완료 기준

- [ ] 규칙 문서와 실제 구현이 일치
- [ ] 관리/운영성 도구와 클라이언트 도구 구분
- [ ] 정책 문서 업데이트 완료

### Phase 6 완료 기준

- [ ] 비테스트 코드 `console.log` 0개 (`scripts/count-console-logs.ts`로 검증)
- [ ] 모든 로깅이 표준 로거(`logger`)를 통해 이루어짐
- [ ] ESLint `no-console` 규칙 통과 (테스트/CLI 제외)

### Phase 7 완료 기준

- [ ] `ToolContext` 생성 로직이 팩토리 함수로 통일
- [ ] 에러 처리 패턴이 공통 핸들러로 통일
- [ ] 모든 기존 테스트 통과 (`npm test`)

### Phase 8 완료 기준

- [ ] 모든 에러가 `ErrorLoggingService`를 통해 로깅됨
- [ ] 커스텀 에러 클래스 활용
- [ ] 모든 기존 테스트 통과 (`npm test`)

### 전체 완료 기준

- [ ] 모든 Phase 완료
- [ ] 성능 저하 없음 (당시 전용 벤치마크 기준 ±5% 이내)
- [ ] 모든 기존 테스트 통과 (`npm test`)
- [ ] 전체 파이프라인 CI 게이트 통과 (모든 측정 스크립트 포함)
  ```bash
  npm run lint && npm run type-check && npm test && \
  node scripts/check-file-sizes.ts && \
  node scripts/count-any-types.ts && \
  node scripts/count-console-logs.ts
  ```
- [ ] 코드 리뷰 완료 및 승인
- [ ] 문서화 완료
- [ ] 기존 기능 100% 유지 확인
- [ ] API 호환성 100% 유지 확인
