# Research: Telemetry CLI & MCP Tool Access (007)

## 1. CLI 서브커맨드 추가 패턴

**Decision**: 기존 `packages/memento-server/src/cli.ts`에 `telemetry` 서브커맨드를 추가한다.

**Rationale**: 프로젝트는 단일 CLI 진입점(`memento` 바이너리)을 유지하는 패턴이다. 별도 스크립트(`telemetry-cli.ts`)를 추가하면 env 로드, DB 초기화, cleanup 로직이 중복된다. `TOOL_SUBCOMMANDS` Set와 달리 `telemetry`는 MCP 도구를 실행하지 않으므로 분기를 명확히 구분한다.

**Alternatives considered**:
- 별도 스크립트 파일: env 로드·DB cleanup 코드 복제 필요 → 기각
- `npm run telemetry` → 별도 TypeScript 파일: 독립성은 있지만 기존 CLI 패턴과 불일치 → 기각

**Implementation detail**: `package.json` root scripts에 `"telemetry": "node --loader ts-node/esm packages/memento-server/src/telemetry-cli.ts"` 또는 빌드 후 `"telemetry": "node dist/telemetry-cli.js"` 형태로 등록. 기존 `cli.ts`의 복잡한 서브커맨드 분기를 피하기 위해 **전용 진입 파일** `packages/memento-server/src/telemetry-cli.ts`를 사용하되 공통 초기화 코드를 공유 모듈로 추출하지 않는다(YAGNI — 현재 CLI는 단순 함수 호출이므로 복제 비용이 낮음).

---

## 2. MCP 도구 등록 패턴

**Decision**: `BaseTool` 서브클래스 `GetTelemetrySummaryTool`을 `packages/memento-core/src/domains/telemetry/tools/` 에 추가하고 `packages/memento-core/src/tools/index.ts`의 `coreTools` 배열에 등록한다.

**Rationale**: 기존 16개 도구(`GetIntrospectionSummaryTool` 등)가 동일한 패턴을 따른다. `BaseTool`이 `createSuccessResult` / `createErrorResult`를 제공하므로 에러 처리가 일관적이다. `executeTool` 경유 호출로 ALS context(owner_id)가 자동 주입된다.

**owner_id 획득**: `context.services?.telemetryService?.getContext()?.ownerId`로 현재 ALS store의 ownerId를 읽는다. `executeTool`이 도구 실행 전 `runWithContext(ownerId, fn)`으로 감싸므로 도구 핸들러 내에서 `getContext()`는 항상 유효하다.

**Alternatives considered**:
- `context.agentId` 직접 사용: ALS context가 없는 경우만 fallback으로 사용하는 것이 맞음 → ALS 우선
- 새 도메인 디렉터리(`telemetry/tools/`): 기존 `memory/tools/`와 같은 계층으로 일관성 있음 → 채택

---

## 3. CLI 출력 포맷

**Decision**: 섹션 헤더(`[Search Quality]`)와 키-값 들여쓰기 포맷. 색상·이모지 없음. 숫자 단위 명시(`ms`, `%`, `건`).

**Rationale**: FR-004 요구사항. CI/CD 파이프라인, 리다이렉트 환경에서도 파싱 가능. 80컬럼 제한 준수.

**Format example**:
```
=== Memento Telemetry (24h) ===

[Search Quality]
  Total queries       : 42
  Avg latency         : 123 ms
  p95 latency         : 456 ms
  Empty result rate   : 12.5 %
  Avg candidate count : 8.3

[Memory Quality]
  Total memories      : 523
  Duplicate rate (24h): 2.1 %
  Orphan ratio        : 5.3 %
  Relation coverage   : 78.2 %

[System Metrics (24h)]
  Recall   - requests: 42  success: 40  error_rate: 4.8 %
  Remember - requests: 18  success: 18  error_rate: 0.0 %
  Feedback - requests:  3  success:  3  error_rate: 0.0 %
```

---

## 4. 기존 `TelemetryService` 재사용 범위

**Decision**: CLI와 MCP 도구 모두 `TelemetryService.getSearchQuality()`, `getMemoryQuality()`, `getSystemMetrics()` 세 메서드를 직접 호출한다. 신규 집계 로직 없음.

**Rationale**: SC-003, FR-008 요구사항. 세 메서드가 이미 `owner_id` 필터 파라미터를 지원한다.

---

## 5. 스키마 변경 여부

**Decision**: DB 스키마 변경 없음. 새 마이그레이션 파일 없음.

**Rationale**: 기존 `telemetry_events`, `telemetry_daily_metrics` 테이블을 읽기만 한다. Constitution III 해당 없음.
