# Memento 프로젝트 전수 조사 보고서 (2026-01)

**작성일**: 2026-01-16  
**조사 범위**: `src/`, `.cursor/rules`, `docs` 내 규칙 문서  
**조사 방법**: 정적 스캔(패턴 검색), 심볼 기반 구조 분석  
**조사 항목**: 클린코드 철학, 커서 룰 준수, 개선 필요 코드, 보안 이슈

---

## 📊 종합 평가

### 전체 점수: **7.4/10** (양호)

대부분의 핵심 기능은 구조화되어 있지만, **도구 노출 정책(커서 룰)과 실제 구현 간 불일치**, **과도한 파일/메서드 크기**, **`any` 남용**, **프로덕션 코드의 console 사용**이 누적되어 유지보수성과 규칙 준수 측면에서 점수가 하락했습니다.

**주요 강점**:
- ✅ DB 관련 SQL 인젝션 방어 의식(화이트리스트 및 패턴 검증) 존재
- ✅ MCP 프로토콜 대응을 위한 서버 콘솔 오버라이드 설계
- ✅ 테스트 범위가 넓고 분량이 큼

**주요 개선점**:
- 🔴 MCP 도구 노출 정책과 실제 등록 도구의 불일치
- 🟡 대형 파일 다수로 SRP(단일 책임) 위반 위험
- 🟡 프로덕션 코드 내 `any` 사용량 과다
- 🟡 console 로깅이 규칙 대비 과도

---

## ✅ 클린코드 철학 준수 여부

### 1) 단일 책임 원칙(SRP) — **6/10** 🟡

아래 파일들은 1,200~1,700+ 라인 수준으로 **기능 분리 후보**입니다.

- `src/domains/memory/tools/recall-tool.ts`
- `src/infrastructure/scheduler/batch-scheduler.ts`
- `src/domains/relation/services/llm-based-relation-extractor.ts`
- `src/domains/search/algorithms/hybrid-search-engine.ts`
- `src/domains/memory/tools/remember-tool.ts`
- `src/services/quality-assurance/quality-metrics-collector.ts`

**영향**: 단일 파일 내 책임 과다로 변경 영향도 추적이 어려워지고, 테스트 및 리팩터링 비용이 증가합니다.

### 2) 타입 안정성 — **6/10** 🟡

비테스트 코드 기준 `any` 사용이 **489건** 발견되었습니다.

대표 위치:
- `src/tools/types.ts`
- `src/tools/base-tool.ts`
- `src/domains/search/algorithms/hybrid-search-engine.ts`
- `src/server/index.ts`
- `src/npm-client/*`

**영향**: 런타임 에러 탐지가 지연되고, 도구/서비스 경계에서 타입 계약이 약해집니다.

### 3) TODO/FIXME — **8/10** 🟢

총 8건으로 관리 가능한 수준입니다. 다만 아래 TODO는 기능 누락 가능성이 있어 우선순위가 높습니다.

- `src/services/semantic-memory/semantic-memory-update-service.ts` (RelationType 확장 필요)
- `src/domains/memory/tools/remember-tool.ts` (agent_id 기본값 하드코딩)

### 4) console 사용 — **6/10** 🟡

비테스트 코드 기준 **117건**의 `console.*` 사용이 확인되었습니다.

대표 위치:
- `src/infrastructure/database/database/migrate.ts`
- `src/infrastructure/database/database/migration/migration-runner.ts`
- `src/infrastructure/scheduler/batch-scheduler.ts`
- `src/infrastructure/logging/triple-extraction-logger.ts`

**코드 스타일 규칙**(테스트/서버 진입점 제외)을 위배할 소지가 있습니다.

---

## 📋 커서 룰 준수 여부

### 1) MCP 도구 노출 정책 위반 — **5/10** 🔴

`.cursor/rules/mcp-tools-architecture.mdc` 및 `.cursor/rules/mcp-server-development.mdc`는 **MCP 클라이언트 도구 5개만 노출**을 규정합니다. 하지만 실제 등록 도구는 12+개입니다.

- 규정: `.cursor/rules/mcp-tools-architecture.mdc`
- 구현: `src/tools/index.ts`

**영향**: 관리/운영성 도구가 MCP 클라이언트에 노출될 경우 공격 표면 확대 및 정책 위반 위험이 있습니다.

### 2) 테스트 네이밍 규칙 불일치 — **6/10** 🟡

`.cursor/rules/testing.mdc`는 `*.test.ts`를 권장하나, 실제는 `*.spec.ts`가 **196개**, `*.test.ts`는 **0개**입니다.

- 규정: `.cursor/rules/testing.mdc`
- 현황: `src/**/*.spec.ts` 대규모

**영향**: 규칙 문서와 실제 관행의 불일치로 신규 기여자 혼란 가능.

---

## 🔐 보안 이슈 점검

### 1) 외부 프로세스 실행 — **주의 필요** 🟡

`RelationValidatorExecutor`는 `npx tsx`를 통해 스크립트를 실행합니다.

- `src/infrastructure/scheduler/relation-validator-executor.ts`

**리스크**: 현재는 내부 스크립트 경로를 사용하지만, **실행 인자/환경이 외부 입력으로 확장될 경우** 명령 주입 위험이 발생할 수 있습니다. 실행 인자 고정 또는 화이트리스트화가 권장됩니다.

### 2) 동적 SQL 문자열 — **낮음** 🟢

`addMissingColumn()`에서 테이블/컬럼명을 문자열 보간으로 삽입합니다.

- `src/infrastructure/database/database/init.ts`

**리스크**: 현재는 내부 상수만 사용되지만, 외부 입력이 유입될 여지가 생기면 SQL 인젝션 위험이 있습니다. 향후 외부 입력 경로가 추가될 경우 **화이트리스트 검증**을 추가하는 편이 안전합니다.

### 3) 로그 데이터 마스킹 — **부분 양호** 🟢

`populateVecTables()`는 테이블명 화이트리스트 및 패턴 검증을 수행하며, 일부 로깅은 `PIIMasker`를 사용합니다.

- `src/infrastructure/database/database/init.ts`
- `src/infrastructure/logging/triple-extraction-logger.ts`

**개선 포인트**: 일부 로그는 `stdout/stderr`를 직접 기록하므로 민감 정보 포함 가능성이 있습니다.

---

## ✅ 개선 권장 사항 (우선순위 순)

1) **MCP 도구 노출 정책 정합성 확보**  
   - `src/tools/index.ts`의 등록 도구를 규칙과 맞추거나, 규칙 문서를 업데이트하세요.

2) **대형 파일 분리**  
   - 핵심 알고리즘/도구 파일은 책임 단위로 분리하고, 내부 클래스를 모듈화하세요.

3) **`any` 정리 로드맵 수립**  
   - `src/tools/*`, `src/domains/search/*`, `src/npm-client/*`부터 점진적으로 타입 정의 보강을 추천합니다.

4) **console 로깅 정책 통일**  
   - 마이그레이션/배치/로거 영역에서도 공통 Logger 또는 structured logging으로 통합하세요.

5) **외부 프로세스 실행 가드 강화**  
   - 실행 인자 화이트리스트 또는 제한적 enum 적용을 고려하세요.

---

## 🧪 테스트/검증

- 테스트 실행은 수행하지 않았습니다.

---

## 부록: 주요 규칙 문서

- `.cursor/rules/mcp-tools-architecture.mdc`
- `.cursor/rules/mcp-server-development.mdc`
- `.cursor/rules/testing.mdc`
- `.cursor/rules/implementation.mdc`
- `.cursor/rules/database-schema.mdc`
- `.cursor/rules/error-logging.mdc`
