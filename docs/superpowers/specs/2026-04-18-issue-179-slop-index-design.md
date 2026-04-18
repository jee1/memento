# 설계: 이슈 #179 — memento-server `slop-detector` Critical (`index.ts`)

**상태**: 브레인스토밍 확정 (구현 전)  
**날짜**: 2026-04-18  
**이슈**: [GitHub #179](https://github.com/jee1/memento/issues/179) — `ai-slop-detector --js` 스캔 결과 추적 (Critical: `src/server/index.ts`)

---

## 1. 배경·문제 정의

`ai-slop-detector --project packages/memento-server/src --js` 실행 시 **Critical 1건**이 `packages/memento-server/src/server/index.ts`에 집중된다. 보고된 패턴은 대략 다음과 같다.

- `process.stderr.write` 래핑에서 `any` 사용
- `console.error` 오버라이드에서 `any[]`
- MCP stdio 준수를 위한 **의도적** `console.log` / `warn` / `info` / `debug` 무력화(빈 함수)

도구 점수만 맞추면 설정으로 누르는 방법도 있으나, 본 설계의 우선순위는 **타입 안전성과 “왜 이렇게 하는지”의 코드 내 명시**다(브레인스토밍에서 선택한 목표 **B**).

---

## 2. 목표·비목표

### 2.1 목표

- Critical 구간에서 **`any`를 제거하거나 의미 있게 좁힌다** (`unknown`, Node typings, `Parameters<>` 등).
- MCP stdio에서 **stdout 오염 방지**를 위해 `console.*` 일부를 막는 동작을 **이름 있는 no-op/헬퍼 + 블록 주석**으로 읽기 쉽게 만든다.
- 변경 후 **로컬에서 `slop-detector` 재실행**하여 Critical가 사라졌는지 확인한다(점수·Suspicious는 부차 지표).

### 2.2 비목표 (동일 PR·동일 스펙 범위에서 하지 않음)

- `mcp.routes.ts`, `admin.routes.ts`, `http-server.ts` 등 **Suspicious만 있는 파일**의 일괄 리팩터.
- `*.spec.ts`에 대한 `.slopconfig` 정책 정리(필요 시 **후속 이슈**).
- CI에 `slop-detector --ci-mode hard` **게이트 도입**(이슈 제안 3단계 — **후속**).

---

## 3. 설계 방침

### 3.1 타입

- `process.stderr.write` 대입: **Node.js 공식 타입과 동일한 인자·반환**을 따른다. 과도하게 좁히면 런타임과 어긋날 수 있으므로, 모호하면 `unknown` + 안전한 분기로 처리한다.
- `console.error` 오버라이드: 가변 인자는 `unknown[]`(또는 동등한 안전한 타입)로 두고, 기존처럼 `String(a)` 등으로 직렬화한다.

### 3.2 의도적 console 무력화

- **복제된 익명 `() => {}` 네 개** 대신, 공통 **no-op 헬퍼 하나**(`void` 반환)를 두고 `log` / `warn` / `info` / `debug`에 동일 참조를 할당하는 방식을 우선한다.
- 해당 블록 위에 **짧은 블록 주석**: MCP stdio 전송 시 stdout에는 JSON-RPC만 허용되므로, 모듈 로드 시점부터 `console` 기본 경로로의 출력을 막는다는 점을 명시한다.
- 선택: 주석에 **Issue #179** 참조 한 줄을 두어 추적성을 높인다.

### 3.3 도구 설정 (`.slopconfig`)

- **원칙**: Critical는 **코드로 해소**한다. 설정 파일로 라인을 숨기는 것은 **B 목표와 상충**할 수 있다.
- Suspicious·테스트 노이즈가 커질 때만 **후속**으로 `.slopconfig`의 `ignore` 등을 검토한다.

---

## 4. 검증

- `npm run lint`
- `npm run type-check`
- `packages/memento-server` 관련 단위 테스트(기존 `index.spec.ts` 등)
- 로컬: `slop-detector --project packages/memento-server/src --js` — **`[JS/TS Analysis]` 구간 기준 Critical 0**

---

## 5. 리스크·완화

| 리스크 | 완화 |
|--------|------|
| `stderr.write` 시그니처 오타로 런타임 깨짐 | Node typings 준수, 테스트·수동 smoke |
| no-op 리팩터로 diff만 커짐 | 동작 변경 없음을 유지, 한 파일·한 목적로 제한 |

---

## 6. 후속 작업 (이 스펙 외)

- 이슈 본문 2·3단계: 프로덕션 위주 재스캔, 선택 CI 게이트 및 테스트 경로 정책.
