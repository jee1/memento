# PRD: 코드 품질 개선 (God Object 분리, 타입 안정성, 로깅 일원화)

## 1. Introduction/Overview

현재 코드베이스에서 코드 품질과 유지보수성을 저해하는 주요 문제점들이 발견되었습니다:

1. **거대 파일(God Object) 문제**: `anchor-manager.ts`(1,700줄), `http-server.ts`(1,688줄) 등 일부 파일이 지나치게 커서 가독성과 테스트 용이성을 저해하고 있습니다. 특히 `searchLocal` 메서드는 약 240줄에 걸쳐 너무 많은 책임(조회, 임베딩, N-hop 검색, 필터링 등)을 가지고 있습니다.

2. **타입 안정성 부족**: 프로젝트 전체에서 `any` 타입이 186개나 사용되고 있으며, 타입 단언(`as any`)이 빈번하게 발생하고 있습니다. 이는 TypeScript의 장점인 컴파일 타임 에러 체크를 무력화합니다.

3. **로깅 일관성 결여**: 표준 로깅 서비스가 있음에도 불구하고 1,300개 이상의 `console.log`가 산재해 있습니다. 이는 MCP 서버 환경에서 표준 출력(stdout) 충돌 문제를 야기할 수 있는 위험 요소입니다.

**목표**: 영향도 우선 단계적 접근으로 코드 품질을 개선하여 유지보수성, 테스트 용이성, 타입 안정성을 향상시키고, 배포 리스크를 최소화합니다.

## 2. Goals

1. **거대 파일 분리**: 핵심 파일들을 500줄 이하로 분리하여 가독성과 테스트 용이성 향상
2. **searchLocal 메서드 분리**: 파이프라인 단계별 메서드 분리 및 전략 패턴 적용으로 확장성과 테스트 용이성 확보
3. **타입 안정성 개선**: 핵심 로직의 `any` 타입을 186개에서 50개 이하로 감소
4. **로깅 일원화**: 핵심 모듈의 `console.log`를 표준 로깅 서비스로 전환하여 MCP 환경 호환성 확보
5. **기존 기능 유지**: 모든 기존 테스트 통과 및 API 호환성 유지
6. **점진적 마이그레이션**: 모듈별 단계적 개선으로 배포 리스크 최소화

## 3. User Stories

### 3.1 개발자 관점

**As a** 백엔드 개발자  
**I want** 거대 파일을 기능별/레이어별로 분리  
**So that** 코드를 이해하고 수정하기 쉬워집니다.

**As a** 테스트 작성자  
**I want** 작은 단위의 모듈로 분리된 코드  
**So that** 단위 테스트를 작성하고 유지보수하기 쉬워집니다.

**As a** TypeScript 개발자  
**I want** `any` 타입을 구체적인 타입으로 교체  
**So that** 컴파일 타임에 타입 에러를 잡을 수 있습니다.

**As a** MCP 서버 개발자  
**I want** 모든 로깅이 표준 로깅 서비스를 통해 이루어짐  
**So that** stdout 충돌 없이 안정적으로 동작합니다.

### 3.2 시스템 관점

**As a** 시스템  
**I want** 모듈별로 명확하게 분리된 책임  
**So that** 변경 사항의 영향을 최소화하고 버그를 쉽게 추적할 수 있습니다.

**As a** 빌드 시스템  
**I want** 타입 안정성이 보장된 코드  
**So that** 런타임 에러를 줄이고 코드 품질을 향상시킬 수 있습니다.

## 4. Functional Requirements

### 4.1 Phase 1: 거대 파일 분리

#### 4.1.1 anchor-search-service.ts 분리

**FR-1.1**: `anchor-search-service.ts`를 기능별로 분리
- 현재 상태: `src/domains/anchor/services/anchor/anchor-search-service.ts` (1,261줄) - 분리 대상
- 분리 전략: 기존 `src/domains/anchor/services/anchor/` 구조 내에서 모듈 분리
- 검색 로직을 별도 모듈로 분리 (필요시)
- 각 파일은 500줄 이하로 제한

**FR-1.2**: 분리된 모듈 간 인터페이스 정의
- 각 모듈은 명확한 인터페이스를 통해 통신
- 의존성 주입 패턴 적용

**FR-1.3**: 기존 API 호환성 유지
- 기존 `AnchorManager` 래퍼(`src/services/anchor-manager.ts`)는 유지
- `anchor-manager.ts` (295줄)는 이미 적절한 크기로 유지
- `anchor-cache-service.ts`는 이미 분리되어 있음
- 내부적으로 분리된 모듈들을 조합하여 동작

#### 4.1.2 http-server.ts 분리

**FR-1.4**: `http-server.ts`를 라우터/핸들러/서비스 wiring으로 분리
- 라우터: `routes/` 디렉토리로 라우트 정의 분리
- 핸들러: `handlers/` 디렉토리로 요청 처리 로직 분리
- 서비스 wiring: `bootstrap.ts`에서 서비스 초기화 및 연결
- 각 파일은 500줄 이하로 제한

**FR-1.5**: `broadcastAnchorMapUpdate` 함수 분리
- `buildAnchorMapData`: 앵커 맵 데이터 구성
- `broadcastToSubscribers`: 구독자에게 브로드캐스트
- 각 함수는 50줄 이하로 제한

### 4.2 Phase 2: searchLocal 메서드 분리

**FR-2.1**: `searchLocal` 메서드를 파이프라인 단계별 메서드로 분리
- `getAnchorWithEmbedding`: 앵커 조회 및 임베딩 가져오기
- `performNHopSearch`: N-hop 검색 수행
- `applyQueryFilter`: 쿼리 기반 필터링
- `handleFallback`: Fallback 처리
- 각 메서드는 50줄 이하로 제한

**FR-2.2**: 전략 패턴 적용
- 검색 전략을 `LocalSearchService` 내부에 플러그인화
- `ISearchStrategy` 인터페이스 정의
- 각 전략을 별도 클래스로 구현 (예: `NHopSearchStrategy`, `QueryFilterStrategy`)
- 각 전략 파일은 500줄 이하로 제한 (예상: 50줄 내외)

**FR-2.3**: 분리된 파일 크기 제한
- `local-search-service.ts`: 500줄 이하 (예상: 50줄 내외)
- 각 전략 파일: 500줄 이하 (예상: 50줄 내외)
- Phase 1의 파일 크기 목표와 일관성 유지

**FR-2.4**: 분리된 함수/전략에 대한 단위 테스트 작성
- 각 단계별 함수에 대한 단위 테스트
- 각 전략에 대한 단위 테스트
- 통합 테스트로 전체 파이프라인 검증

### 4.3 Phase 3: 타입 안정성 개선

**FR-3.1**: 핵심 로직의 `any` 타입 제거
- 검색/임베딩/DB 경계 도메인 타입 우선 정의
- `any` 타입을 구체적인 타입으로 교체
- 목표: 186개 → 50개 이하

**FR-3.2**: 타입 단언 최소화
- `as any` 사용을 최소화하고 타입 가드 사용
- 제네릭을 활용한 재사용 가능한 타입 정의

**FR-3.3**: 새 코드에 엄격한 타입 적용
- 새로운 코드 작성 시 `any` 타입 사용 금지
- TypeScript strict 모드 준수

**FR-3.4**: 단계별 스냅샷 기록
- 각 단계 완료 후 `any` 타입 개수 기록
- 타입 체크 통과 확인

### 4.4 Phase 4: 로깅 일원화

**FR-4.1**: 표준 로거 모듈 명시
- 사용할 로거: `src/shared/utils/logger.ts`의 `logger` 객체
- 로거 인터페이스:
  ```typescript
  logger.debug(message: string, meta?: Record<string, unknown>): void
  logger.info(message: string, meta?: Record<string, unknown>): void
  logger.warn(message: string, meta?: Record<string, unknown>): void
  logger.error(message: string, meta?: Record<string, unknown>): void
  ```

**FR-4.2**: 로깅 필드 스키마 정의
- 공통 필드 스키마:
  ```typescript
  interface LogMeta {
    agentId?: string;        // 에이전트 ID
    slot?: string;           // 앵커 슬롯 (A, B, C)
    memoryId?: string;       // 메모리 ID
    traceId?: string;        // 추적 ID (선택적)
    [key: string]: unknown;  // 추가 컨텍스트 정보
  }
  ```
- 로깅 형식: 구조화된 텍스트 형식 (ISO 8601 타임스탬프 + 레벨 + 메시지 + JSON 메타데이터)
  - 예: `2024-01-01T00:00:00.000Z | INFO | Anchor missing, falling back to global search | {"agentId":"default","slot":"A","query":"test"}`

**FR-4.3**: 로그 레벨 매핑 전략
- `console.log` → `logger.info` (일반 정보)
- `console.warn` → `logger.warn` (경고)
- `console.error` → `logger.error` (에러)
- `console.debug` → `logger.debug` (디버그 정보)
- `console.info` → `logger.info` (정보)

**FR-4.4**: 우선순위 높은 파일부터 로깅 교체
- 서버/핵심 서비스 모듈 우선 (`src/server/`, `src/services/`)
- MCP 환경에서 stdout 충돌 우려가 큰 부분부터 전환
- 마이그레이션 순서:
  1. `src/server/http-server.ts`
  2. `src/server/index.ts`
  3. `src/services/anchor-manager.ts`
  4. `src/services/` 하위 기타 서비스
  5. 나머지 모듈

**FR-4.5**: 예외 규칙 정의
- **테스트 파일 예외**: `*.spec.ts`, `test-*.ts` 파일은 `console.log` 사용 허용
  - 이유: 테스트 환경에서는 직접 출력이 유용함
- **CLI 스크립트 예외**: `scripts/` 디렉토리의 스크립트는 `console.log` 사용 허용
  - 이유: CLI 도구는 사용자에게 직접 출력해야 함
- **예외 적용 방법**: ESLint `no-console` 규칙에 `overrides` 사용
  ```json
  {
    "rules": {
      "no-console": "error"
    },
    "overrides": [
      {
        "files": ["**/*.spec.ts", "**/test-*.ts", "scripts/**"],
        "rules": {
          "no-console": "off"
        }
      }
    ]
  }
  ```
  - 기본 규칙: 모든 `console.*` 사용 금지 (에러 레벨)
  - 테스트/CLI 파일: `overrides`로 `no-console` 규칙 완전 비활성화
  - 핵심 모듈 0개 목표 달성을 위해 기본 규칙을 엄격하게 설정

**FR-4.6**: 모듈 단위 확장
- 한 모듈의 모든 `console.log`를 표준 로거로 교체
- 구조화된 로깅 형식 적용 (메타데이터 객체 사용)
- 컨텍스트 정보 포함 (agentId, slot 등)

**FR-4.7**: 핵심 모듈의 `console.log` 완전 제거
- 핵심 모듈에서 `console.log` 0개 달성
- 이후 전체 프로젝트로 확장 (테스트/CLI 제외)

## 5. Non-Goals (Out of Scope)

1. **전체 코드베이스 일괄 리팩토링**: 이번 작업은 우선순위가 높은 파일들에 집중하며, 다른 파일들은 향후 단계에서 처리
2. **성능 최적화**: 이번 작업의 주요 목표는 코드 구조 개선이며, 성능 최적화는 별도 작업으로 진행
3. **API 변경**: 기존 API 인터페이스는 유지하며, 내부 구현만 개선
4. **데이터베이스 스키마 변경**: 데이터베이스 스키마 변경은 포함하지 않음
5. **로깅 시스템 재설계**: 기존 표준 로깅 서비스를 활용하며, 새로운 로깅 시스템 구축은 제외

## 6. Design Considerations

### 6.1 아키텍처 패턴

- **의존성 주입**: 분리된 모듈들은 의존성 주입을 통해 연결
- **인터페이스 기반 설계**: 각 모듈은 명확한 인터페이스를 통해 통신
- **전략 패턴**: 검색 전략을 플러그인화하여 확장성 확보

### 6.2 파일 구조

**⚠️ 중요: 기존 저장소 구조 유지**

리포지토리 가이드라인(`AGENTS.md`)에 따라 기존 디렉터리 구조를 유지합니다:
- 도메인 로직: `src/services/` (서비스 레이어)
- 알고리즘: `src/algorithms/` (검색 엔진)
- 서버 엔트리포인트: `src/server/` (MCP 서버)

**anchor-manager.ts 분리 구조** (기존 구조 활용):

**⚠️ 중요: 기존 `src/domains/anchor/services/anchor/` 구조 활용**

실제 코드베이스 확인 결과:
- `src/domains/anchor/services/anchor/` 구조가 이미 존재함
  - `anchor-manager.ts` (CRUD 로직)
  - `anchor-cache-service.ts` (캐시 로직)
  - `anchor-search-service.ts` (검색 로직, 1,261줄 - 분리 대상)
- `src/services/anchor-manager.ts`는 래퍼로 `src/domains/`의 서비스들을 사용

**분리 전략**:
- `src/domains/anchor/services/anchor/` 내부에서 모듈 분리 (신규 디렉터리 생성 없음)
- `anchor-search-service.ts`의 `searchLocal` 메서드를 별도 모듈로 분리
- `src/services/anchor-manager.ts`는 래퍼로 유지하여 기존 API 호환성 보장

```
src/
├── domains/
│   └── anchor/
│       └── services/
│           └── anchor/
│               ├── anchor-manager.ts (CRUD, 295줄)
│               ├── anchor-cache-service.ts (캐시)
│               ├── anchor-search-service.ts (검색, 분리 대상)
│               └── search/ (신규, searchLocal 분리)
│                   ├── local-search-service.ts
│                   └── strategies/
│                       ├── n-hop-search-strategy.ts
│                       └── query-filter-strategy.ts
├── services/
│   └── anchor-manager.ts (래퍼, 기존 API 유지)
└── server/
    ├── routes/ (이미 존재)
    ├── handlers/ (이미 존재)
    └── bootstrap.ts (이미 존재)
```

**중복 방지 계획**:
- `src/services/anchor/` 신규 디렉터리 생성하지 않음
- 기존 `src/domains/anchor/services/anchor/` 구조 내에서만 모듈 분리
- `src/services/anchor-manager.ts`는 래퍼로 유지하여 기존 import 경로 보존

**경로 alias 영향도**: 
- 기존 import 경로는 변경하지 않음 (`src/services/anchor-manager.ts` 유지)
- 내부 모듈 분리는 `src/domains/` 내에서만 수행
- `src/services/anchor-manager.ts`의 export는 유지하여 기존 코드와 호환

### 6.3 타입 정의

- 도메인별 타입을 명확히 정의
- 제네릭을 활용한 재사용 가능한 타입
- 타입 가드를 통한 런타임 타입 체크

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

### 8.1 거대 파일 분리

#### 측정 방법
- **파일 크기 측정**: `wc -l` 또는 `cloc` 도구 사용
- **함수 크기 측정**: ESLint 규칙 `max-lines-per-function` 설정 (경고: 50줄, 에러: 100줄)
- **자동화 스크립트**: `scripts/check-file-sizes.ts` 생성하여 CI/CD에 통합

#### 목표 및 예외 기준
- **파일 크기**: 핵심 핸들러/서비스 파일이 500줄 이하
  - 예외: 500줄 초과 시 리뷰어 승인 필요 (예: 복잡한 타입 정의, 대량의 테스트 케이스)
  - 단계별 목표: Phase 1 완료 시 80% 파일이 500줄 이하
- **함수 크기**: 단일 함수가 50줄 이하
  - 예외: 50줄 초과 시 리뷰어 승인 필요 (예: 복잡한 알고리즘, 에러 처리 로직)
  - 단계별 목표: Phase 2 완료 시 90% 함수가 50줄 이하
- **테스트 커버리지**: 분리된 모듈에 대한 단위 테스트 커버리지 80% 이상
  - 측정 도구: Vitest coverage (`npm test -- --coverage`)

### 8.2 타입 안정성

#### 측정 방법
- **any 타입 개수 측정**: 
  ```bash
  # grep을 사용한 기본 측정
  grep -r "\bany\b" src/ --include="*.ts" | grep -v "node_modules" | wc -l
  
  # 또는 TypeScript 컴파일러 사용
  tsc --noEmit --listFiles | xargs grep -h "\bany\b" | wc -l
  ```
- **자동화 스크립트**: `scripts/count-any-types.ts` 생성
- **ESLint 규칙**: `@typescript-eslint/no-explicit-any` 활성화 (경고 레벨)

#### 목표 및 예외 기준
- **any 타입 개수**: 186개 → 50개 이하 (단계별 스냅샷)
  - 단계별 목표:
    - Phase 3 시작 전: 186개 (베이스라인)
    - Phase 3 중간: 100개 이하
    - Phase 3 완료: 50개 이하
  - 예외 허용 기준:
    - 타입 정의가 불가능한 경우 (예: 동적 JSON 파싱, 외부 라이브러리 인터페이스)
    - 예외 사용 시 주석으로 이유 명시 필수
- **타입 체크 통과**: `npm run type-check` (`tsc --noEmit`) 통과 필수
- **타입 단언 감소**: `as any` 사용 최소화
  - 측정: `grep -r "as any" src/ --include="*.ts" | wc -l`
  - 목표: Phase 3 완료 시 20개 이하

### 8.3 로깅 일원화

#### 측정 방법
- **console.log 개수 측정**:
  ```bash
  # console.log/console.error/console.warn 등 모두 포함
  grep -r "console\." src/ --include="*.ts" | grep -v "node_modules" | wc -l
  
  # 핵심 모듈만 측정
  grep -r "console\." src/server/ src/services/ --include="*.ts" | wc -l
  ```
- **자동화 스크립트**: `scripts/count-console-logs.ts` 생성
- **ESLint 규칙**: `no-console` 규칙 활성화 (경고 레벨, 테스트/CLI 예외)

#### 목표 및 예외 기준
- **핵심 모듈 console.log**: 0개
  - 핵심 모듈 정의: `src/server/`, `src/services/` (MCP 서버 실행 경로)
  - 예외: 테스트 파일(`*.spec.ts`, `test-*.ts`), CLI 스크립트(`scripts/`)는 제외
- **전체 console.log**: 단계적 감소
  - 단계별 목표:
    - Phase 4 시작 전: 1,300개 (베이스라인)
    - Phase 4 중간: 500개 이하 (핵심 모듈 제거 후)
    - Phase 4 완료: 200개 이하 (테스트/CLI 제외)
- **로깅 일관성**: 모든 로깅이 표준 로거를 통해 이루어짐
  - 검증: 핵심 모듈에서 `console.log` 검색 시 0개 반환

### 8.4 품질 지표

- **기존 테스트 통과율**: 100% (`npm test` 통과 필수)
- **Lint 통과**: 각 단계 후 `npm run lint` 통과
- **타입 체크 통과**: 각 단계 후 `npm run type-check` 통과
- **성능 저하 없음**: 리팩토링 전후 성능 비교 (목표: ±5% 이내)
  - 측정: 당시 전용 성능 벤치마크 실행(현재 runner 제거됨)
  - 주요 지표: 검색 쿼리 응답 시간, 메모리 사용량

### 8.5 CI/CD 통합

#### 측정 스크립트 CI 게이트
- **스크립트 생성**: 다음 스크립트들을 `scripts/` 디렉토리에 생성
  - `scripts/check-file-sizes.ts`: 파일 크기 검증 (500줄 기준)
  - `scripts/count-any-types.ts`: any 타입 개수 측정
  - `scripts/count-console-logs.ts`: console.log 개수 측정

- **Phase별 CI 게이트**:
  ```bash
  # Phase 1, 2: 거대 파일 분리
  npm run lint && npm run type-check && npm test && node scripts/check-file-sizes.ts
  
  # Phase 3: 타입 안정성 개선 (Phase 1,2 체크 + any 타입 체크)
  npm run lint && npm run type-check && npm test && node scripts/check-file-sizes.ts && node scripts/count-any-types.ts
  
  # Phase 4: 로깅 일원화 (모든 체크 포함)
  npm run lint && npm run type-check && npm test && node scripts/check-file-sizes.ts && node scripts/count-any-types.ts && node scripts/count-console-logs.ts
  ```

- **전체 파이프라인 CI 게이트** (최종 검증):
  ```bash
  # 모든 Phase 완료 후 전체 검증
  npm run lint && npm run type-check && npm test && \
  node scripts/check-file-sizes.ts && \
  node scripts/count-any-types.ts && \
  node scripts/count-console-logs.ts
  ```

- **CI 실행 시점**:
  - **Pre-commit hook**: 기본 품질 게이트만 실행 (`npm run lint && npm run type-check`)
  - **Phase별 PR 체크**: 해당 Phase의 측정 스크립트 포함
  - **최종 PR 체크**: 모든 측정 스크립트 포함 (전체 파이프라인)

- **실패 기준**:
  - 파일 크기 초과: 경고 (리뷰어 승인 필요)
  - any 타입 목표 미달: 경고 (단계별 목표 확인)
  - console.log 목표 미달: 경고 (단계별 목표 확인)
  - 테스트 실패/Lint 실패/타입 체크 실패: 에러 (PR 병합 차단)

## 9. Implementation Plan

### Phase 1: 거대 파일 분리 (우선순위: 높음)

1. **anchor-search-service.ts 분리** (`src/domains/anchor/services/anchor/`)
   - 현재 상태: `anchor-search-service.ts` (1,261줄) - 분리 대상
   - 분리 전략: 기존 `src/domains/anchor/services/anchor/` 구조 내에서 모듈 분리
   - 검색 로직을 별도 모듈로 분리하여 500줄 이하로 제한
   - `anchor-manager.ts` (295줄)는 이미 적절한 크기로 유지
   - `anchor-cache-service.ts`는 이미 분리되어 있음
   - 기존 API 래퍼(`src/services/anchor-manager.ts`) 유지
   - 테스트 작성 및 통과 확인

2. **http-server.ts 분리** (`src/server/`)
   - 라우터 분리 (`routes/` - 이미 존재)
   - 핸들러 분리 (`handlers/` - 이미 존재)
   - 서비스 wiring 정리 (`bootstrap.ts` - 이미 존재)
   - `broadcastAnchorMapUpdate` 함수 분리
   - 테스트 작성 및 통과 확인

**완료 조건**: 
- `anchor-search-service.ts`가 적절한 크기로 분리됨 (500줄 이하)
- 모든 파일이 500줄 이하 (`scripts/check-file-sizes.ts`로 검증)
- 모든 기존 테스트 통과 (`npm test`)
- Lint 및 타입 체크 통과 (`npm run lint && npm run type-check`)
- CI 게이트 통과 (`npm run lint && npm run type-check && npm test && node scripts/check-file-sizes.ts`)

### Phase 2: searchLocal 메서드 분리 (우선순위: 높음)

1. **파이프라인 단계별 메서드 분리**
   - `getAnchorWithEmbedding` 메서드 추출
   - `performNHopSearch` 메서드 추출
   - `applyQueryFilter` 메서드 추출
   - `handleFallback` 메서드 추출

2. **전략 패턴 적용**
   - `ISearchStrategy` 인터페이스 정의
   - 각 전략 클래스 구현
   - `LocalSearchService`에 전략 주입
   - 각 파일이 500줄 이하로 유지 (예상: 50줄 내외)

3. **테스트 작성**
   - 각 단계별 함수 단위 테스트
   - 각 전략 단위 테스트
   - 통합 테스트

**완료 조건**:
- 각 메서드가 50줄 이하 (ESLint `max-lines-per-function` 규칙)
- 분리된 파일들이 500줄 이하 (`scripts/check-file-sizes.ts`로 검증)
  - `local-search-service.ts`: 예상 50줄 내외
  - 각 전략 파일: 예상 50줄 내외
- 모든 기존 테스트 통과 (`npm test`)
- 새로운 단위 테스트 작성 완료
- CI 게이트 통과 (`npm run lint && npm run type-check && npm test && node scripts/check-file-sizes.ts`)

### Phase 3: 타입 안정성 개선 (우선순위: 중간)

1. **도메인 타입 정의**
   - 검색 관련 타입 정의
   - 임베딩 관련 타입 정의
   - DB 경계 타입 정의

2. **핵심 로직 any 제거**
   - 검색/임베딩/DB 경계 도메인부터 시작
   - 타입 가드 활용
   - 제네릭 활용

3. **단계별 검증**
   - 각 단계 후 `any` 타입 개수 기록
   - 타입 체크 통과 확인

**완료 조건**:
- `any` 타입 50개 이하
- 타입 체크 통과
- 새 코드에 `any` 사용 금지

### Phase 4: 로깅 일원화 (우선순위: 중간)

1. **로깅 전환 준비**
   - 표준 로거 모듈 확인 (`src/shared/utils/logger.ts`)
   - 로깅 필드 스키마 문서화
   - ESLint 규칙 설정 (테스트/CLI 예외)

2. **우선순위 파일 교체**
   - `src/server/http-server.ts`부터 시작
   - `src/server/index.ts` 교체
   - `src/services/anchor-manager.ts` 교체
   - 각 파일 교체 후 테스트 통과 확인

3. **모듈 단위 확장**
   - `src/services/` 하위 기타 서비스 순차 교체
   - 한 모듈씩 순차적으로 교체
   - 구조화된 로깅 형식 적용 (메타데이터 객체 사용)

4. **검증**
   - 핵심 모듈 `console.log` 0개 확인 (`scripts/count-console-logs.ts` 실행)
   - 로깅 일관성 확인 (ESLint 규칙 통과)
   - MCP 환경 호환성 테스트

**완료 조건**:
- 핵심 모듈(`src/server/`, `src/services/`) `console.log` 0개
- 모든 로깅이 표준 로거(`logger`)를 통해 이루어짐
- ESLint `no-console` 규칙 통과 (테스트/CLI 제외)
- MCP 서버 정상 동작 확인

## 10. Open Questions

1. **성능 영향 측정**: 리팩토링 전후 성능 벤치마크를 어느 정도의 정확도로 측정할 것인가?
   - **해결**: 당시 전용 성능 벤치마크를 사용하여 ±5% 이내 목표 설정
2. **로깅 형식**: 구조화된 로깅(JSON)을 사용할지, 아니면 기존 형식을 유지할지?
   - **해결**: 기존 `logger` 모듈의 구조화된 텍스트 형식 유지 (ISO 8601 + 레벨 + 메시지 + JSON 메타데이터)
3. **타입 엄격도**: 새 코드에 대해 `strict` 모드를 즉시 적용할지, 아니면 점진적으로 적용할지?
   - **해결**: 새 코드에 대해 엄격한 타입 적용, 기존 코드는 점진적 개선
4. **테스트 커버리지 목표**: 분리된 모듈에 대한 테스트 커버리지 목표를 80%로 설정했는데, 이 목표가 적절한가?
   - **해결**: 80% 목표 유지, 핵심 로직은 90% 이상 권장
5. **마이그레이션 기간**: 각 Phase별 예상 소요 기간은 얼마인가?
   - **미결**: 프로젝트 일정에 따라 조정 필요
6. **디렉터리 구조 변경**: `src/domains/` 구조를 사용할지, `src/services/` 구조를 유지할지?
   - **해결**: 기존 구조 유지 (`src/services/`, `src/server/`), `src/domains/`는 이미 존재하는 구조 활용

## 11. Risks and Mitigation

### 11.1 리스크

1. **기능 회귀**: 리팩토링 과정에서 기존 기능이 깨질 수 있음
2. **성능 저하**: 모듈 분리로 인한 오버헤드 발생 가능
3. **리뷰 비용 증가**: 큰 변경사항으로 인한 리뷰 시간 증가
4. **병합 충돌**: 장기간 진행되는 작업으로 인한 병합 충돌 가능

### 11.2 완화 전략

1. **기능 회귀 방지**: 
   - 모든 기존 테스트 통과 필수
   - 단계별 검증
   - 통합 테스트 강화

2. **성능 저하 방지**:
   - 리팩토링 전후 성능 벤치마크
   - 프로파일링을 통한 병목 지점 확인

3. **리뷰 비용 최소화**:
   - Phase별 PR 분리
   - 상세한 변경사항 설명
   - 리팩토링 전후 비교 제공

4. **병합 충돌 최소화**:
   - 작은 단위로 PR 분리
   - 빠른 병합 주기
   - 충돌 조기 발견 및 해결

## 12. Dependencies

### 12.1 기술 스택

- 기존 TypeScript 컴파일러 및 타입 시스템
- 기존 로깅 서비스 (`src/shared/utils/logger.ts`)
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

- [ ] `anchor-search-service.ts`가 적절한 크기로 분리됨 (`src/domains/anchor/services/anchor/` 내부, 500줄 이하)
- [ ] `http-server.ts`가 라우터/핸들러/서비스로 분리됨
- [ ] 각 파일이 500줄 이하임 (`scripts/check-file-sizes.ts`로 검증)
- [ ] 모든 기존 테스트 통과 (`npm test`)
- [ ] Lint 및 타입 체크 통과 (`npm run lint && npm run type-check`)
- [ ] CI 게이트 통과 (`npm run lint && npm run type-check && npm test && node scripts/check-file-sizes.ts`)

### Phase 2 완료 기준

- [ ] `searchLocal` 메서드가 4개 이상의 단계별 메서드로 분리됨
- [ ] 각 메서드가 50줄 이하임 (ESLint `max-lines-per-function` 규칙으로 검증)
- [ ] 전략 패턴이 적용됨
- [ ] 분리된 파일들이 500줄 이하로 유지됨 (`scripts/check-file-sizes.ts`로 검증)
  - `local-search-service.ts`: 예상 50줄 내외
  - 각 전략 파일 (`n-hop-search-strategy.ts`, `query-filter-strategy.ts` 등): 예상 50줄 내외
- [ ] 각 단계별 함수/전략에 대한 단위 테스트 작성됨
- [ ] 모든 기존 테스트 통과 (`npm test`)
- [ ] CI 게이트 통과 (`npm run lint && npm run type-check && npm test && node scripts/check-file-sizes.ts`)

### Phase 3 완료 기준

- [ ] `any` 타입이 50개 이하로 감소함 (`scripts/count-any-types.ts`로 검증)
- [ ] 핵심 로직의 도메인 타입이 정의됨
- [ ] 타입 체크 통과 (`npm run type-check`)
- [ ] 새 코드에 `any` 사용 금지 규칙 적용됨 (ESLint `@typescript-eslint/no-explicit-any` 경고)
- [ ] CI 게이트 통과 (`npm run lint && npm run type-check && npm test && node scripts/check-file-sizes.ts && node scripts/count-any-types.ts`)

### Phase 4 완료 기준

- [ ] 표준 로거 모듈(`src/shared/utils/logger.ts`) 사용 확인
- [ ] 로깅 필드 스키마 문서화 완료
- [ ] 핵심 모듈(`src/server/`, `src/services/`)의 모든 `console.*` 사용이 0개임 (`scripts/count-console-logs.ts`로 검증)
- [ ] 모든 로깅이 표준 로거(`logger.info/warn/error/debug`)를 통해 이루어짐
- [ ] 구조화된 로깅 형식(메타데이터 객체)이 적용됨
- [ ] ESLint `no-console` 규칙 통과 (기본 규칙: error, 테스트/CLI만 overrides로 예외, `npm run lint` 통과)
- [ ] MCP 환경 호환성 확인됨 (서버 정상 실행 및 로그 출력 확인)
- [ ] CI 게이트 통과 (`npm run lint && npm run type-check && npm test && node scripts/count-console-logs.ts`)

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
