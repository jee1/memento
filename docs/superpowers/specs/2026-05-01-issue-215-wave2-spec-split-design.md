# 설계: 이슈 #215 — Wave 2 거대 spec 분할 (LLM 초기화·통합)

**상태**: 브레인스토밍 확정 → 구현은 별도 `writing-plans` / PR  
**날짜**: 2026-05-01  
**관련**: [GitHub #215](https://github.com/jee1/memento/issues/215), 부모 [#180](https://github.com/jee1/memento/issues/180), 로드맵 `docs/superpowers/specs/2026-05-01-issue-180-refactor-roadmap-design.md` Wave 2  

---

## 1. 목적

유지보수·리뷰·정적 도구 노이즈를 줄이기 위해 아래 **거대 단일 spec**을 **하위 폴더 + 여러 `*.spec.ts`**로 분할한다. **테스트 의미·통과 조건은 분할 전과 동일**해야 한다.

| 기존 파일 | 대략 규모 (분할 시점 기준) |
|-----------|---------------------------|
| `packages/memento-core/src/shared/services/llm-client-initializer.spec.ts` | ~1338 LOC, 35 tests |
| `packages/memento-core/src/domains/relation/services/__tests__/llm-provider-integration.spec.ts` | ~972 LOC, 19 tests |

---

## 2. 비범위

- Wave 1(bootstrap), Wave 3(`any` 일괄 정리) — 이슈 본문과 동일. 분할 과정에서 타입을 좁히는 것은 자연스러운 부수 효과로만 허용.
- 프로덕션 코드 동작 변경, DB 스키마 변경, Vitest `include`/`exclude` 정책의 의미 있는 변경(필요 시 CI 동작 확인만 문서화).

---

## 3. 디렉터리·네이밍

### 3.1 단위 테스트 (`LLMClientInitializer`)

- **루트**: `packages/memento-core/src/shared/services/__tests__/llm-client-initializer/`
- **구성**: 여러 `*.spec.ts` + 공용 모듈 1개(예: `llm-client-initializer.test-setup.ts`). 공용 모듈은 **`*.spec.ts` / `*.test.ts` 접미사를 쓰지 않음** — Vitest가 테스트 파일로 오인하지 않도록.
- **정리**: 분할이 완료되면 기존 단일 파일 `packages/memento-core/src/shared/services/llm-client-initializer.spec.ts`는 **삭제**한다. 동일 스위트는 새 폴더의 파일들만으로 실행된다.

### 3.2 통합 테스트 (`LLM Provider 통합`)

- **루트**: `packages/memento-core/src/domains/relation/services/__tests__/llm-provider-integration/`
- **구성**: 여러 `*.spec.ts` + 공용 setup 모듈(통합 전용 모킹·`fetch`/`AbortSignal` 보관 등).
- **정리**: 분할 완료 후 기존 `packages/memento-core/src/domains/relation/services/__tests__/llm-provider-integration.spec.ts`는 **삭제**한다.

### 3.3 분할 단위 (권장)

- **안 A(채택)**: 기존 **상위·중첩 `describe` 블록 경계**를 파일 경계에 최대한 맞춘다. 아주 작은 블록은 한 파일에 2~3개 묶어 파일 수 과다를 방지한다.
- 단위 쪽 예시 축: `initialize`, 환경 변수 우선순위, OpenAI / Gemini / Ollama, `validateApiKeys`, `LLM_PROVIDER` fallback(`openai`/`gemini`/`ollama`/`auto` 하위 describe).
- 통합 쪽 예시 축: provider별 통합, API 키 없음, 설정 provider 실패 시 자동 전환 등 기존 `describe` 제목과 책임에 맞춘 파일 분리.

---

## 4. 공통 모킹·훅

- 각 폴더에 **`vi.mock` / `vi.hoisted` 기반 공유 상태**(예: `mockMementoConfig`)를 **한 setup 모듈**에 둔다.
- 각 `*.spec.ts`는 **해당 setup을 최상단에서 먼저 import**한다. Vitest `vi.mock` 호이스팅 순서를 깨지 않도록, 필요 시 파일 상단에 “첫 import 고정” 주석을 둔다.
- **통합 전용**: `getRawEnvValue` 모킹, `global.fetch` / `AbortSignal` 저장·복원(`beforeEach`/`afterEach`)은 **통합 폴더의 setup에만** 둔다. 단위 폴더에는 포함하지 않는다.

---

## 5. Vitest·CI

- 루트 `vitest.config.ts`의 `test.include`는 이미 `packages/memento-core/src/**/*.{test,spec}.{js,ts}`이므로, 하위 폴더의 `*.spec.ts`는 **추가 설정 없이** 수집된다.
- CI에서 `process.env.CI`일 때 `**/test/**/*integration*` 패턴으로 exclude 되는 항목과, 본 통합 spec 경로(`.../__tests__/...`)가 **겹치지 않음**을 분할 후 한 번 확인한다. 통합 테스트는 CI에서도 **기존과 같이 실행**되어야 한다(회귀 없음).

---

## 6. 검증·완료 조건

- 분할 후에도 **`it`/`test` 개수·시나리오가 분할 전과 동일**(현재 합계 54: 35 + 19). 테스트 이름·검증 내용을 바꾸지 않고 **이동·import 정리만** 한다.
- `npm run lint`, `npm run type-check`, `npm test` 통과.
- PR 본문: `Closes #215`, `Related #180` 링크. 브랜치 예: `issue/215-wave2-spec-split`(또는 저장소 규칙에 맞춤).

---

## 7. 구현 순서 권장 (요약)

1. 단위 폴더 생성 → setup 추출 → `describe` 블록을 파일별로 옮김 → 단일 `llm-client-initializer.spec.ts` 삭제 → 해당 스위트만 `vitest run`으로 확인.
2. 통합 폴더에 대해 동일 → 단일 `llm-provider-integration.spec.ts` 삭제 → 통합 스위트만 실행.
3. 전체 `npm test` 및 CI 로컬 재현.

---

## 8. 스펙 자체 점검

- **Placeholder**: 없음.
- **일관성**: 로드맵 Wave 2·이슈 #215 본문과 정합.
- **범위**: spec 분할 및 테스트 전용 헬퍼만; 제품 코드 리팩터는 비범위.
- **모호성**: “동일 스위트” = 동일 케이스 수·동일 검증 의미; 파일·폴더 구조는 본 문서 3절을 따른다.
