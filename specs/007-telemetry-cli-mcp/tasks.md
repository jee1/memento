# Tasks: Telemetry CLI & MCP Tool Access (007)

**Input**: Design documents from `/specs/007-telemetry-cli-mcp/`
**Prerequisites**: plan.md ✓, spec.md ✓, research.md ✓, data-model.md ✓, contracts/mcp-tool.md ✓

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 병렬 실행 가능 (다른 파일, 의존성 없음)
- **[Story]**: 해당 유저 스토리 레이블 (US1/US2/US3)

---

## Phase 1: Setup

**Purpose**: 신규 도구 디렉터리 및 파일 위치 준비

- [x] T001 `packages/memento-core/src/domains/telemetry/tools/` 디렉터리 생성 확인 (mkdir -p)

---

## Phase 2: User Story 3 — MCP 도구 `get_telemetry_summary` (Priority: P1) 🎯 MVP

**Goal**: 에이전트가 `get_telemetry_summary`를 호출하면 자신의 검색 품질·메모리 품질 지표를 얻을 수 있다.

**Independent Test**: `get_telemetry_summary({ period: '24h' })` 호출 시 `search_quality`와 `memory_quality`가 포함된 응답이 반환된다. DB 오류 시 에이전트 세션이 중단되지 않는다.

### Tests (Constitution I — 먼저 작성, 실패 확인 필수)

- [x] T002 [US3] `packages/memento-core/src/domains/telemetry/tools/get-telemetry-summary-tool.spec.ts` 작성 — 아래 5가지 실패하는 테스트 포함:
  1. `period` 미지정 시 기본값 `'24h'` 사용 검증
  2. ALS context의 `ownerId`로 필터링된 데이터 반환 검증
  3. 잘못된 `period` 값 → `createErrorResult()` 반환 검증
  4. `search_count` 등 모든 필드가 null인 `SearchQualityResult` 반환 시 null 필드 포함 응답 검증
  5. `telemetry_events` 테이블이 없을 때(마이그레이션 미실행) → `createErrorResult()` 반환 검증

### Implementation

- [x] T003 [US3] `packages/memento-core/src/domains/telemetry/tools/get-telemetry-summary-tool.ts` 구현:
  - `BaseTool` 서브클래스, 도구 이름 `get_telemetry_summary`
  - 입력 스키마: `{ period?: '24h' | '7d' | '30d' }` (contracts/mcp-tool.md 참조)
  - `handle()`: `context.services?.telemetryService?.getContext()?.ownerId`로 ownerId 획득
  - `getSearchQuality(period, ownerId)` + `getMemoryQuality(ownerId)` 조합하여 `GetTelemetrySummaryResult` 반환
  - 잘못된 period → `this.createErrorResult('Invalid period. Allowed: 24h, 7d, 30d')`
  - DB 오류 → try/catch + `this.createErrorResult(err.message)` (세션 중단 없음)
  - 출력 타입: `data-model.md`의 `GetTelemetrySummaryResult` 참조

- [x] T004 [P] [US3] `packages/memento-core/src/tools/index.ts` 수정 — `coreTools` 배열에 `new GetTelemetrySummaryTool()` 추가 (import는 직접 파일 경로 `../domains/telemetry/tools/get-telemetry-summary-tool.js` 사용 — 기존 `GetIntrospectionSummaryTool` 패턴과 동일, 도메인 배럴 export 불필요)

- [x] T005 [P] [US3] SC-001/SC-002 수동 성능 검증 준비 — 10만 건 이상 DB에서 `get_telemetry_summary` 응답 시간이 2초 이내임을 Phase 5에서 확인할 수 있도록 테스트용 DB 시드 또는 확인 절차 메모 (자동화 테스트 불필요 시 Phase 5 T014 수동 체크로 대체)

**Checkpoint**: `npx vitest run packages/memento-core/src/domains/telemetry/tools/get-telemetry-summary-tool.spec.ts` 통과. MCP 도구 목록에 `get_telemetry_summary` 노출 확인.

---

## Phase 3: User Story 1 — CLI 기본 텔레메트리 조회 (Priority: P1) 🎯 MVP

**Goal**: HTTP 서버 없이 `npm run telemetry`로 전체 텔레메트리 지표(24h)를 터미널에서 확인할 수 있다.

**Independent Test**: `npm run telemetry` 실행 시 `[Search Quality]`, `[Memory Quality]`, `[System Metrics]` 섹션이 포맷된 텍스트로 출력된다. DB가 없으면 에러 메시지 + exit code 1.

### Tests (Constitution I — 먼저 작성, 실패 확인 필수)

- [x] T006 [US1] `packages/memento-server/src/telemetry-cli.spec.ts` 작성 — 아래 5가지 실패하는 테스트 포함:
  1. `formatSearchQuality(null 필드)` → `N/A` 표시 검증
  2. `formatSearchQuality({ search_count: 42, avg_latency_ms: 123, ... })` → 예상 출력 문자열 검증
  3. 빈 DB(데이터 없음) → "기록된 텔레메트리 데이터가 없습니다." 출력 + exit 0 검증
  4. 포맷된 출력의 각 줄이 80컬럼 이내임을 검증 (`maxLineLength ≤ 80`)
  5. `telemetry_events` 테이블이 없을 때(마이그레이션 미실행) → stderr에 에러 메시지 + exit 1 검증

### Implementation

- [x] T007 [US1] `packages/memento-server/src/telemetry-cli.ts` 구현:
  - `loadEnv()` → `createMementoCore({ dbPath })` → `TelemetryService` 직접 호출
  - 기본 동작: `--period 24h`, `--type all`
  - `getSearchQuality('24h', null)` + `getMemoryQuality(null)` + `getSystemMetrics('24h', null)` 순으로 출력
  - 포맷터 함수 (`formatSearchQuality`, `formatMemoryQuality`, `formatSystemMetrics`) 내부 구현
  - null 값 → `N/A` 표시
  - 모든 지표가 null → "기록된 텔레메트리 데이터가 없습니다." + exit 0
  - DB 오류 / 파일 없음 → stderr에 에러 메시지 + exit 1
  - cleanup: `closeDatabase(db)`
  - 출력 포맷: `quickstart.md` 및 `data-model.md` 참조

- [x] T008 [US1] root `package.json` 수정 — `scripts`에 `"telemetry": "tsx packages/memento-server/src/telemetry-cli.ts"` 추가 (memento-server의 `dev: tsx watch ...` 패턴과 동일)

**Checkpoint**: `npm run telemetry` 실행 시 섹션 헤더가 포함된 포맷된 출력 확인. `npm run telemetry -- --help` 사용법 출력 확인.

---

## Phase 4: User Story 2 — CLI 기간 필터 및 지표 유형 선택 (Priority: P2)

**Goal**: `--period`와 `--type` 옵션으로 조회 범위를 좁힐 수 있다.

**Independent Test**: `npm run telemetry -- --period 7d --type search-quality` 실행 시 Search Quality 섹션만 7일 기준으로 출력된다. 잘못된 옵션은 exit code 1과 허용 값 목록을 반환한다.

### Tests (Constitution I — 먼저 작성, 실패 확인 필수)

- [x] T009 [US2] `packages/memento-server/src/telemetry-cli.spec.ts`에 추가:
  1. `parseCliOptions(['--period', '7d'])` → `{ period: '7d', type: 'all' }` 반환 검증
  2. `parseCliOptions(['--period', '1y'])` → 잘못된 period 에러 반환 검증
  3. `parseCliOptions(['--type', 'memory-quality'])` → `{ period: '24h', type: 'memory-quality' }` 반환 검증
  4. `parseCliOptions(['--type', 'invalid'])` → 잘못된 type 에러 반환 검증

### Implementation

- [x] T010 [US2] `packages/memento-server/src/telemetry-cli.ts` 수정:
  - `parseCliOptions(argv)` 함수 추출 — `--period <24h|7d|30d>`, `--type <search-quality|memory-quality|system|all>`, `--help/-h` 파싱
  - 잘못된 `--period` → stderr에 허용 값 목록 출력 + exit 1
  - 잘못된 `--type` → stderr에 허용 값 목록 출력 + exit 1
  - `--type` 에 따라 해당 섹션만 조회+출력 (`search-quality` → `getSearchQuality`만, 등)
  - `--type memory-quality` → period 파라미터 무시 (data-model.md 참조)

**Checkpoint**: `npm run telemetry -- --period 7d --type search-quality` 실행 시 Search Quality 섹션만 출력. `npm run telemetry -- --period bad` 실행 시 exit 1 + 허용 값 목록.

---

## Phase 5: Polish & Quality Gates

**Purpose**: Constitution IV 충족 — 모든 quality gate 통과

- [x] T011 [P] `npm run lint` 통과 확인 — 신규 파일 포함 lint 에러 없음
- [x] T012 [P] `npm run type-check` 통과 확인 — 타입 오류 없음
- [x] T013 `npm test` 전체 통과 확인 — 기존 테스트 회귀 없음
- [ ] T014 SC-001/SC-002 수동 성능 검증 — 10만 건 이상 DB에서 `npm run telemetry` 실행 시간 ≤ 2s, `get_telemetry_summary` 응답 시간 ≤ 2s 확인 (time 명령 또는 직접 측정). **수동 검증 필요** — 자동화 불가, 운영/스테이징 DB에서 직접 확인 후 체크.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: 즉시 시작 가능
- **Phase 2 (US3 MCP)**: Phase 1 완료 후 시작
- **Phase 3 (US1 CLI)**: Phase 1 완료 후 시작 (Phase 2와 병렬 가능)
- **Phase 4 (US2 CLI 옵션)**: Phase 3 완료 후 시작 (US1 CLI를 확장)
- **Phase 5 (Polish)**: Phase 2, 3, 4 모두 완료 후

### User Story Dependencies

- **US3 (P1)**: Phase 1 이후 독립 — US1/US2와 무관
- **US1 (P1)**: Phase 1 이후 독립 — US3와 병렬 가능
- **US2 (P2)**: US1 완료 후 (US1의 CLI 파일 확장)

### Within Each User Story

- 테스트 작성 → 테스트 실패 확인 → 구현 → 테스트 통과 확인
- 같은 파일 수정 시 순차 실행

### Parallel Opportunities

- T002(US3 테스트)와 T006(US1 테스트)는 서로 다른 파일 → 병렬 가능
- T003(US3 구현)와 T007(US1 구현)는 서로 다른 파일 → 병렬 가능
- T004와 T005는 모두 T003 완료 후 서로 다른 관심사 → 병렬 가능 ([P] 표시)
- T011, T012 (lint/type-check)는 서로 병렬 가능

---

## Parallel Example: US3와 US1 동시 진행

```
Phase 2와 Phase 3을 병렬로 실행:
  Agent A: T002 → T003 → T004 → T005  (MCP 도구)
  Agent B: T006 → T007 → T008         (CLI 기본)

Phase 4는 Phase 3 완료 후:
  Agent A or B: T009 → T010
```

---

## Implementation Strategy

### MVP First (US3 + US1만)

1. Phase 1: Setup (T001)
2. Phase 2: MCP 도구 (T002~T005)
3. Phase 3: CLI 기본 (T006~T008)
4. **STOP and VALIDATE**: `get_telemetry_summary` 호출 + `npm run telemetry` 실행 확인
5. US2(CLI 옵션)는 별도 PR 또는 이후 추가

### Full Delivery

1. MVP 완료 후 Phase 4 (T009~T010) 추가
2. Phase 5 (T011~T013) quality gates 통과
3. 전체 완료

---

## Notes

- [P] 태스크 = 다른 파일, 의존성 없음 → 병렬 실행 가능
- Constitution I (Test-First): 각 구현 태스크 전 테스트가 반드시 먼저 실패해야 함
- `BaseTool` 패턴 참조: `packages/memento-core/src/domains/memory/tools/get-introspection-summary-tool.ts`
- CLI 패턴 참조: `packages/memento-server/src/cli.ts` (env 로드, DB 초기화, cleanup)
- 출력 포맷 참조: `specs/007-telemetry-cli-mcp/quickstart.md`
- MCP 계약 참조: `specs/007-telemetry-cli-mcp/contracts/mcp-tool.md`
