# Phase 1 Data Model: relation 도메인 config 모킹 교정

**Feature**: 657-821-fix-vi-mock-config-path | **Date**: 2026-08-27
**Source**: [spec.md](./spec.md) Key Entities, [research.md](./research.md)

DB 스키마 변경은 없다. 여기서 다루는 "엔티티" 는 테스트 실행 시점의 메모리 구조 3개와, 재발 방지 게이트가 다루는 데이터 구조 3개다.

---

## 1. 모킹된 설정 객체 (`mockConfig`)

스펙 파일 전체가 공유하는 **단일 가변 객체**. 모킹된 모듈이 이 참조를 붙잡고, 소스는 그 모듈을 통해 이 객체를 읽는다.

| 필드 | 타입 | 기준값 | 읽는 주체 |
|------|------|--------|-----------|
| `llmProvider` | `string` | `'auto'` | 추출기 직접 + `shared-helpers` |
| `openaiApiKey` | `string \| undefined` | `undefined` | `llm-client-initializer`, `openai.ts` |
| `geminiApiKey` | `string \| undefined` | `undefined` | `llm-client-initializer`, `gemini.ts` |
| `ollamaBaseUrl` | `string \| undefined` | `undefined` | `ollama.ts`, `extract-relations-ollama.ts` |
| `ollamaModel` | `string \| undefined` | `undefined` | `extract-relations-ollama.ts` |
| `openaiModel` | `string` | `'gpt-4o-mini'` | (도달 범위 밖, 상위집합) |
| `openaiLlmModel` | `string` | `'gpt-4o-mini'` | (도달 범위 밖, 상위집합) |
| `geminiModel` | `string` | `'gemini-1.5-flash'` | (도달 범위 밖, 상위집합) |
| `geminiLlmModel` | `string` | `'gemini-2.0-flash'` | (도달 범위 밖, 상위집합) |
| `llmModelOverrides` | `Record<string, string \| undefined>` | `{}` | (도달 범위 밖, 상위집합) |

**불변식**
- **INV-1 (참조 고정)**: 객체 참조는 스펙 파일 수명 동안 바뀌지 않는다. 갱신은 항상 제자리(`Object.assign`). 재할당하면 모킹된 모듈이 옛 객체를 계속 들고 있어 무효가 된다.
- **INV-2 (기준 상태 단일 정의)**: 기준값은 `createMockConfig()` 한 곳에만 정의된다 (FR-007).
- **INV-3 (호이스팅)**: 생성은 `vi.hoisted()` 안에서 일어난다. 그래야 mock factory 가 정적 로드 시점에 호출돼도 TDZ 에 걸리지 않는다 (research R2).
- **INV-4 (전이 충족)**: 도달 가능한 모든 `mementoConfig.X` 읽기에 대해 `X` 가 존재해야 한다 (FR-008).

**상태 전이**

```
[기준 상태] --beforeEach: Object.assign(mockConfig, createMockConfig())--> [기준 상태]
     |
     +-- 테스트 본문의 명시적 지정 --> [테스트 고유 상태] --(다음 beforeEach)--> [기준 상태]
```

각 테스트 종료 직후 대체 값 객체는 기준 상태와 같아야 한다 (SC-004).

---

## 2. 설정 모킹 선언 (`vi.mock` 대상 경로 ↔ 재가져오기 경로)

**쌍(pair)이 단위다.** 두 지점이 같은 모듈을 가리켜야만 의미가 있다.

| 지점 | 개수 | 교정 전 | 교정 후 |
|------|------|---------|---------|
| `vi.mock` 선언 | 1 (line 122) | `../../../shared/config/index.js` | `../../../../shared/config/index.js` |
| 동적 재가져오기 (팬텀) | 13 | `../../../shared/config/index.js` | `../../../../shared/config/index.js` |
| 동적 재가져오기 (실 모듈) | 1 (line 720) | `../../../../shared/config/index.js` | 변경 없음 |
| 죽은 선언 (`relation-extractor.spec.ts`) | 1 (line 24) | `../config/index.js` | **제거** |

**불변식**
- **INV-5 (원자성)**: 선언과 13곳의 재가져오기는 같은 편집에서 함께 바뀐다. 한쪽만 바꾸면 — 선언만이면 요란한 해석 실패, 재가져오기만이면 **모킹 없이 실 전역을 조작하는 조용한 회귀**.
- **INV-6 (해석 가능성)**: 모든 상대 경로 `vi.mock` 대상은 실재하는 모듈로 해석돼야 한다 (FR-009).

---

## 3. 실제 전역 설정 (`mementoConfig` 실물)

`packages/memento-core/src/shared/config/index.ts` 가 프로세스 환경에서 만든 싱글턴.

**불변식**
- **INV-7 (불가침)**: 테스트는 이 객체를 읽지도 쓰지도 않는다. 스펙 실행 전후로 값이 달라지면 안 된다 (FR-007a, SC-004).
- 현재 유일한 위반은 line 720(#819 도입, `try/finally` 복원 있음). Phase C 에서 모킹 기반으로 이관한다.

---

## 4. 게이트 발견 항목 (Finding)

`check-vi-mock-paths.ts` 가 만드는 레코드.

| 필드 | 타입 | 설명 |
|------|------|------|
| `file` | `string` | 저장소 루트 기준 상대 경로 |
| `line` | `number` | `vi.mock(` 이 시작하는 1-based 줄 번호 |
| `specifier` | `string` | 모킹 대상 문자열 원문 |
| `status` | `'violation' \| 'baselined' \| 'stale-baseline'` | 아래 판정 규칙 |

**판정 규칙**
1. `specifier` 가 `.` 로 시작하지 않으면 **레코드를 만들지 않는다** (FR-010, 패키지 모킹 제외).
2. 후보 중 하나라도 존재하면 통과. 후보 순서: `.js`→`.ts` 치환, `.js`→`.tsx` 치환, 원본, `+.ts`, `+.tsx`, `<dir>/index.ts`.
3. 미해석 + baseline 미등재 → `violation` (차단).
4. 미해석 + baseline 등재 → `baselined` (통과, 보고).
5. baseline 에 있는데 해석됨 → `stale-baseline` (통과, 보고) (FR-014).

---

## 5. Baseline 예외 항목

`scripts/vi-mock-path-baseline.json` 의 원소.

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `file` | `string` | ✅ | 저장소 루트 기준 상대 경로 |
| `specifier` | `string` | ✅ | 모킹 대상 문자열 원문 |
| `reason` | `string` | ✅ | 왜 지금 고치지 않는가 |
| `followUp` | `string` | ✅ | 후속 추적 대상 (이슈 번호 등) |

**불변식**
- **INV-8 (키 안정성)**: 매칭 키는 `file` + `specifier`. **줄 번호는 키에 넣지 않는다** — 무관한 편집에 밀려 예외가 조용히 풀린다.
- **INV-9 (사유 필수)**: `reason`·`followUp` 이 비면 게이트가 baseline 파일 자체를 오류로 본다. 사유 없는 예외는 새로운 조용한 통과 경로다.
- **INV-10 (초기 등재분 고정)**: 도입 시점 등재는 research R8 의 **8건뿐**. 범위 내 2건은 해소되므로 넣지 않는다 (SC-007).

---

## 엔티티 ↔ 요구사항 대응

| 엔티티 | 관련 FR / SC |
|--------|--------------|
| 모킹된 설정 객체 | FR-002, FR-007, FR-008, SC-001, SC-004 |
| 설정 모킹 선언 (쌍) | FR-001, FR-012, SC-001 |
| 실제 전역 설정 | FR-003, FR-007a, SC-002, SC-004 |
| Finding | FR-009, FR-010, FR-013, SC-005 |
| Baseline 항목 | FR-013, FR-014, SC-007 |
