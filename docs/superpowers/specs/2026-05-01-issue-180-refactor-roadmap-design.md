# 설계: 이슈 #180 — 코드 품질 부채·복잡도 개선 **로드맵** (웨이브 분리)

**상태**: 로드맵 확정 (구현은 하위 이슈별 PR)  
**날짜**: 2026-05-01  
**부모 이슈**: [GitHub #180](https://github.com/jee1/memento/issues/180) — Slop Detection / graphify 진단 기반 리팩터

**하위 추적 이슈** (2026-05-01 등록):

| 웨이브 | 초점 | 하위 이슈 |
|--------|------|-----------|
| Wave 1 | `bootstrap` 초기화·조립 분리 | [#214](https://github.com/jee1/memento/issues/214) |
| Wave 2 | 거대 `*.spec.ts` 파일 분할 | [#215](https://github.com/jee1/memento/issues/215) |
| Wave 3 | `any` 제거·타입 경계 (우선순위 모듈) | [#216](https://github.com/jee1/memento/issues/216) |

---

## 1. 배경·문제 정의

이슈 #180은 **한 PR에 담기 어려운 광범위 개선**을 묶어 둔 메타 이슈다. 진단 요약(2026-04-18 기준)에는 대략 다음이 포함된다.

- **초기화 복잡도**: `packages/memento-core/src/bootstrap.ts`의 `initializeServices`·`initializeDatabase` 등 **깊은 중첩**과 한 파일에 과도한 책임.
- **거대 테스트**: 예) `llm-client-initializer.spec.ts` (~1.3k LOC), `llm-provider-integration.spec.ts` (~1k LOC) — 유지보수·리뷰 비용·도구(슬롭 스캐너) 노이즈.
- **타입 부채**: 핵심 경로의 `any` 남용(진단에 언급된 `logger.spec`, `unpin-tool`, `init` 등 **예시**; 실제 목록은 Wave 3에서 재스캔해 확정).

모노레포 이후 경로는 이슈 본문의 `src/...`가 아니라 **`packages/memento-core/...`** (및 필요 시 `packages/memento-server/...`) 기준으로 다룬다.

---

## 2. 목표·비목표

### 2.1 목표 (로드맵 전체)

- 위 세 축을 **의존 순서**로 쪼개, 각 웨이브가 **단일 목적·검증 가능한 경계**를 갖게 한다.
- 부모 #180은 **추적·우선순위**만 담고, **코드 변경은 하위 이슈별 브랜치/PR**로만 진행한다.
- 각 웨이브 완료 시: `npm run lint`, `npm run type-check`, `npm test` 통과를 **비기능 요구사항**으로 명시한다.

### 2.2 비목표 (본 로드맵 문서 범위)

- 한 PR에 Wave 1+2+3을 동시에 넣지 않는다.
- CI에 `slop-detector` 하드 게이트 도입, `.slopconfig` 전면 정리 등은 **선택 후속** — 별도 논의(예: #179 계열).

---

## 3. 웨이브 정의 (실행 순서)

### Wave 1 — Bootstrap / 서비스 조립

- **대상**: `packages/memento-core/src/bootstrap.ts` (필요 시 `packages/memento-server/src/server/bootstrap.ts`와의 역할 중복 여부만 점검, 중복 제거는 범위 내에서 최소).
- **방향**: `initializeDatabase` / `initializeServices` 등을 **이름 있는 단위**(팩토리·모듈 초기화 헬퍼)로 분리하고, 중첩 깊이를 줄인다. 동작 변경 없음(리팩터만).
- **검증**: 기존 부트스트랩·통합 테스트 + 수동 smoke(HTTP/MCP 중 해당 패키지에 맞게).

### Wave 2 — 거대 스펙 분할

- **대상(1차)**:  
  - `packages/memento-core/src/shared/services/llm-client-initializer.spec.ts`  
  - `packages/memento-core/src/domains/relation/services/__tests__/llm-provider-integration.spec.ts`
- **방향**: `describe` 블록 또는 **도메인 시나리오** 단위로 파일 분리; 공통 `beforeEach`/모킹은 `*.test-utils.ts` 또는 `vi` 공유 헬퍼로 추출. **테스트 의미(통과/실패 케이스) 동일** 유지.
- **검증**: 분할 후에도 동일 테스트 스위트가 실행되며 카운트·커버리지가 비등록 회귀 없이 유지되는지 확인.

### Wave 3 — `any` 정리·타입 강화

- **대상**: 이슈 #180에 나온 예시를 **시작점**으로 하되, Wave 3 착수 시점에 `npm run lint` / `@typescript-eslint/no-explicit-any` 또는 슬롭 리포트로 **우선순위 목록**을 한 번 더 확정한다.
- **방향**: `unknown` + 가드, 제네릭, 도메인 타입으로 치환; **런타임 계약**이 불명확한 곳은 주석 + 좁은 인터페이스.
- **검증**: 타입체크·린트; 해당 모듈 단위 테스트.

---

## 4. 웨이브 간 의존성

```text
Wave 1 (bootstrap) ──독립──┐
Wave 2 (spec split) ─독립─┼──> 부모 #180 클로즈는 전 웨이브 완료 또는 명시적 범위 축소 후
Wave 3 (any) ──────독립──┘
```

웨이브 간 **코드 의존성은 최소**로 가정한다. 동일 파일을 Wave 1과 Wave 3가 동시에 만지면 충돌 가능하므로, **같은 파일을 건드리는 PR은 순차 머지**를 권장한다.

---

## 5. 하위 이슈·브랜치 규칙

- 브랜치 예: `issue/<하위번호>-wave1-bootstrap` 등.
- PR 본문에 `Closes #<하위이슈>` / `Related #180` 링크.
- 부모 #180은 하위 이슈가 모두 닫힐 때까지 **OPEN** 유지하거나, 메타만 남기고 완료 정의를 명시한다.

---

## 6. 스펙 자체 점검 (요약)

- **Placeholder**: 없음 — 하위 이슈 #214–#216 반영 완료.
- **범위**: 한 웨이브 = 한 설계 축; 기능 추가·스키마 변경은 비목표.
- **모호성 해소**: “진단에 나온 구 경로”는 현재 monorepo 경로로 읽는다.

---

## 7. 다음 단계 (구현 전)

1. ~~하위 이슈 3건 생성·번호를 본 문서 표에 반영~~ → **완료** (#214, #215, #216).  
2. `writing-plans` 스킬에 따라 **웨이브별** `tasks.md` / 구현 계획 작성.  
3. Wave 1부터 순차 또는 병렬(파일 충돌 없을 때만) 구현.
