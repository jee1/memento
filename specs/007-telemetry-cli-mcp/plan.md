# Implementation Plan: Telemetry CLI & MCP Tool Access

**Branch**: `007-telemetry-cli-mcp` | **Date**: 2026-03-29 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/007-telemetry-cli-mcp/spec.md`

## Summary

HTTP 서버 없이 텔레메트리 지표를 조회할 수 있는 CLI 명령(`npm run telemetry`)과 에이전트 자가 진단용 MCP 도구(`get_telemetry_summary`)를 추가한다. 두 인터페이스 모두 006에서 구현된 `TelemetryService` 집계 메서드를 재사용하며 신규 DB 스키마 변경 없음.

## Technical Context

**Language/Version**: TypeScript (Node.js ≥ 20), ES modules
**Primary Dependencies**: better-sqlite3, @memento/core (TelemetryService, BaseTool)
**Storage**: 기존 SQLite — 읽기 전용 (신규 마이그레이션 없음)
**Testing**: vitest
**Target Platform**: Linux/macOS CLI + MCP stdio
**Project Type**: library + CLI
**Performance Goals**: CLI ≤ 2s, MCP 도구 ≤ 2s (SC-001, SC-002)
**Constraints**: 신규 집계 로직 없음 (FR-008); 기존 MCP 도구 16개 계약 변경 없음 (Constitution II)
**Scale/Scope**: 단일 DB 파일 접근, 최대 10만 건 기준

## Constitution Check

| 원칙 | 상태 | 비고 |
|------|------|------|
| I. Test-First | PASS | 각 구현 전 실패 테스트 작성 |
| II. Backward Compat | PASS | 기존 16개 MCP 도구 계약 변경 없음; 새 도구 추가만 |
| III. Schema Migration | PASS | DB 스키마 변경 없음 |
| IV. Quality Gates | PASS | lint + type-check + test 통과 후 완료 |
| V. Observability | PASS | MCP 도구 호출 자체가 telemetry_events에 기록됨 (FR-007) |

## Project Structure

### Documentation (this feature)

```text
specs/007-telemetry-cli-mcp/
├── plan.md              ← 이 파일
├── research.md          ← Phase 0 완료
├── data-model.md        ← Phase 1 완료
├── quickstart.md        ← Phase 1 완료
├── contracts/
│   └── mcp-tool.md      ← Phase 1 완료
└── tasks.md             ← /speckit.tasks 에서 생성
```

### Source Code

```text
packages/memento-core/src/domains/telemetry/
└── tools/
    ├── get-telemetry-summary-tool.ts        (신규)
    └── get-telemetry-summary-tool.spec.ts   (신규)

packages/memento-core/src/tools/
└── index.ts                                 (수정: coreTools에 추가)

packages/memento-server/src/
└── telemetry-cli.ts                         (신규: CLI 진입점)

package.json (root)                          (수정: scripts.telemetry 추가)
```

## Implementation Phases

### Phase A: MCP 도구 `get_telemetry_summary`

**목표**: 에이전트가 자신의 텔레메트리 지표를 MCP 도구로 조회할 수 있도록 한다.

**핵심 결정**:
- `BaseTool` 서브클래스 패턴 (`GetIntrospectionSummaryTool`과 동일한 구조)
- `context.services?.telemetryService?.getContext()?.ownerId`로 ALS owner_id 획득
- `getSearchQuality(period, ownerId)` + `getMemoryQuality(ownerId)` 조합
- 잘못된 `period` → `createErrorResult()` 반환
- DB 오류 → `createErrorResult()` 반환 (세션 중단 없음)

**구현 파일**:
1. `packages/memento-core/src/domains/telemetry/tools/get-telemetry-summary-tool.spec.ts` (먼저)
2. `packages/memento-core/src/domains/telemetry/tools/get-telemetry-summary-tool.ts`
3. `packages/memento-core/src/tools/index.ts` — `coreTools` 배열에 `GetTelemetrySummaryTool` 추가
4. ~~`packages/memento-core/src/domains/telemetry/index.ts` — 도구 export 추가~~ (불필요 — T004 참고: 다른 도메인 도구도 배럴 export 없이 직접 경로 import)

**출력 타입**: `data-model.md`의 `GetTelemetrySummaryResult` 참조

### Phase B: CLI `npm run telemetry`

**목표**: HTTP 서버 없이 터미널에서 텔레메트리 지표를 즉시 확인할 수 있도록 한다.

**핵심 결정**:
- `packages/memento-server/src/telemetry-cli.ts` 신규 진입점 (기존 `cli.ts`와 독립)
- `createMementoCore({ dbPath })` → `TelemetryService` 직접 호출
- `--period`, `--type` 옵션 수동 파싱 (외부 라이브러리 추가 없음 — research.md 결정)
- 포맷터 함수 내부 구현 (외부 라이브러리 없음)
- `package.json` root scripts에 `"telemetry"` 추가

**구현 파일**:
1. `packages/memento-server/src/telemetry-cli.spec.ts` (먼저 — 옵션 파싱 단위 테스트)
2. `packages/memento-server/src/telemetry-cli.ts`
3. `package.json` (root) — scripts 수정

**포맷 규칙** (`data-model.md`의 CLI 옵션 스키마 참조):
- `--type all`: Search Quality → Memory Quality → System Metrics 순 출력
- `--type search-quality`: Search Quality 섹션만
- `--type memory-quality`: Memory Quality 섹션만
- `--type system`: System Metrics 섹션만
- null 값은 `N/A`로 표시
- 빈 DB: "기록된 텔레메트리 데이터가 없습니다." 출력, exit 0

### Phase C: 통합 테스트 + Quality Gates

1. `packages/memento-server/src/server/routes/admin.routes.spec.ts` — `get_telemetry_summary` 경로 테스트가 아니라 integration 레벨 확인 (선택)
2. `npm run lint` + `npm run type-check` + `npm test` 전체 통과 확인

## Complexity Tracking

해당 없음. Constitution 위반 없음.
