# Implementation Plan: relation 도메인 spec 2개의 config 모킹이 실제로 적용되지 않는다

**Branch**: `657-821-fix-vi-mock-config-path` | **Date**: 2026-08-27 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/657-821-fix-vi-mock-config-path/spec.md`

## Summary

`llm-based-relation-extractor.spec.ts` 의 `vi.mock('../../../shared/config/index.js')` 는 `__tests__/` 기준 3단계라 `src/domains/shared/config/index.js`(부재)로 풀린다. 소스는 `services/` 기준 같은 문자열이 `src/shared/config/index.js` 로 풀리므로 **모킹과 소스가 다른 모듈을 가리킨다**. 그런데도 스펙이 전량 통과하는 이유는 브레인스토밍에서 실증됐다: 같은 없는 경로로 `await import` 하는 13곳이 mock 레지스트리에 가로채여 파일 부재가 드러나지 않는다. 선언과 재가져오기가 **닫힌 팬텀 쌍**을 이룬다.

기술 접근은 3층이다.

1. **경로 교정 (원자적)**: `vi.mock` 선언 1곳 + 3단계 동적 import 13곳을 4단계로 **한 번에** 바꾼다. 동시에 `vi.hoisted()` 로 대체 값 객체를 끌어올린다 — 교정 후에는 모킹이 정적 로드 시점에 요구되므로 그대로 두면 TDZ 로 스펙 파일 전체가 로드 실패한다.
2. **테스트별 조건 지정·복원**: `beforeEach` 에서 대체 값 객체를 기준 상태로 되돌리고, 각 테스트가 자기 전제를 명시한다. `#819` 가 남긴 실 전역 직접 조작 1곳(line 720)을 모킹 기반으로 이관한다.
3. **재발 방지 차단 게이트**: `scripts/check-vi-mock-paths.ts` 를 기존 `check-retry-usage.ts` 패턴대로 만들고 CI `lint` 잡에 건다. 저장소 전체 실측 위반 10건 중 이번 범위 밖 8건은 사유·후속 추적을 붙인 baseline 예외 파일로 등재한다.

`relation-extractor.spec.ts:24` 의 `vi.mock('../config/index.js')` 는 그 모듈을 아무도 가져오지 않아 factory 가 한 번도 실행되지 않는다. Q1 결정대로 **선언만 제거**한다.

## Technical Context

**Language/Version**: TypeScript 5.x, Node.js 24.11.0 (ESM), npm 11.6.1
**Primary Dependencies**: Vitest 3.2.6 (`globals: true`, `pool: 'forks'`, maxForks 2), tsx (게이트 스크립트 실행기)
**Storage**: N/A — 테스트 코드·검사 설정만 건드린다. DB 스키마 변경 없음
**Testing**: Vitest. 루트 `vitest.config.ts` 의 `include` 가 저장소 루트 기준이므로 대상 스펙 실행은 **반드시 저장소 루트에서** 한다
**Target Platform**: Linux CI (GitHub Actions `ci.yml` → `lint` / `test:ci:core` 잡)
**Project Type**: npm workspaces 모노레포 (`packages/memento-core` 외 5개 + `apps/*`)
**Performance Goals**: N/A — 런타임 성능 목표 없음. 게이트 스크립트는 lint 잡 내 기존 스캐너와 같은 수준(전체 spec 파일 1회 스캔)
**Constraints**: 배포 산출물 동작 불변(테스트·검사 설정 한정). 게이트는 정상 모킹 오탐 0건이어야 lint 잡을 막지 않는다
**Scale/Scope**: 스펙 2개 (2185줄 + 745줄). 교정 지점 15곳(선언 1 + 동적 import 13 + 죽은 선언 1). 저장소 전체 상대경로 `vi.mock` 58건, 실측 위반 10건(범위 내 2 + baseline 8)

**NEEDS CLARIFICATION**: 없음. spec 의 Open Questions 3건은 브레인스토밍에서 전부 Resolved.

## Constitution Check

*GATE: Phase 0 이전 통과 필수. Phase 1 설계 후 재확인.*

| 원칙 | 판정 | 근거 |
|------|------|------|
| **I. Test-First Delivery (MUST)** | ✅ PASS | 이번 작업의 산출물 자체가 테스트다. RGR 은 "교정 전 위양성 입증 → 교정 → 전량 통과" 순으로 성립한다. **RED 정의**: 교정 전에 `mockConfig.llmProvider` 를 바꿔도 결과가 변하지 않음을 먼저 기록으로 남긴다(SC-001 의 측정 절차). FR-009 게이트 스크립트는 신규 프로덕션 코드가 아닌 검사 도구지만, 자체 spec 을 RGR 로 먼저 작성한다(`scripts/lib/quarantine-gates.spec.ts` 선례). |
| **II. Backward Compatibility (MUST)** | ✅ PASS | MCP 도구 계약·공개 API 를 건드리지 않는다. 변경 범위는 `__tests__/` 2개 파일 + `scripts/` 신규 2개 + `ci.yml` 1스텝 + `package.json` 스크립트 1개. |
| **III. Schema/Migration Discipline (MUST)** | ✅ N/A | DB 스키마 변경 없음. |
| **IV. Quality Gates (MUST)** | ✅ PASS (조건부) | 완료 전 `npm run lint`, `npm run type-check`, `npm test` 통과 필요. **graphify 게이트는 적용되지 않는다** — 프로덕션 코드를 건드리지 않기 때문이다. 단 FR-011 로 소스 결함이 드러나 소스를 고치게 되면 그 순간 graphify 게이트가 살아난다. 이번 범위에서는 소스를 고치지 않고 별도 이슈로 분리하므로 게이트는 계속 비적용이다. |
| **V. Observability (SHOULD)** | ✅ PASS | 게이트 스크립트는 위반을 `file:line -> specifier` 형태로 위치와 함께 보고한다(FR-009). baseline 에 있으나 실제 위반이 아닌 항목도 별도로 보고한다(FR-014). |

**Additional Constraints**
- Node 24+ / TS ESM ✅ 유지
- npm workspaces ✅ 유지
- 벤치마크 코퍼스 라이선스 ✅ N/A
- `graphify-out/` 커밋 금지 ✅ 해당 없음

**위반 없음** → Complexity Tracking 비움.

**Phase 1 설계 후 재확인 (2026-08-27)**: 판정 변동 없음. research·data-model·contracts 어디에도 프로덕션 코드 변경·스키마 변경·신규 의존성이 들어오지 않았다. 게이트 스크립트는 기존 `scripts/` 관례와 `scripts/lib/cli.ts` 를 재사용하며 새 패키지를 추가하지 않는다. graphify 비적용 판단도 그대로다.

## Project Structure

### Documentation (this feature)

```text
specs/657-821-fix-vi-mock-config-path/
├── spec.md              # 완료 (브레인스토밍 1회차 반영)
├── plan.md              # 이 파일 (/speckit.plan 출력)
├── research.md          # Phase 0 출력
├── data-model.md        # Phase 1 출력
├── quickstart.md        # Phase 1 출력
├── contracts/
│   └── vi-mock-path-checker.md   # 게이트 스크립트 CLI·baseline 파일 계약
├── checklists/
│   └── requirements.md  # 완료 (16/16)
└── tasks.md             # Phase 2 출력 (/speckit.tasks — 이 명령이 만들지 않음)
```

### Source Code (repository root)

```text
packages/memento-core/src/
├── domains/relation/services/
│   ├── llm-based-relation-extractor.ts          # 읽기 전용 (참조: llmProvider 3곳)
│   ├── llm-relation-extractor/
│   │   └── extract-relations-ollama.ts          # 읽기 전용 (ollamaBaseUrl·ollamaModel)
│   └── __tests__/
│       ├── llm-based-relation-extractor.spec.ts # ★ 주 교정 대상 (2185줄)
│       └── relation-extractor.spec.ts           # ★ 죽은 vi.mock 선언 제거 (line 24)
└── shared/
    ├── config/index.ts                          # 모킹 대상 실 모듈 (읽기 전용)
    └── services/
        ├── llm-client-initializer.ts            # 위임 대상 (openaiApiKey·geminiApiKey)
        └── llm-client-initializer/
            ├── shared-helpers.ts                # llmProvider
            ├── gemini.ts / openai.ts            # geminiApiKey / openaiApiKey
            └── ollama.ts                        # ollamaBaseUrl

scripts/
├── check-vi-mock-paths.ts          # ★ 신규 — FR-009/FR-010/FR-013/FR-014 게이트
├── check-vi-mock-paths.spec.ts     # ★ 신규 — 게이트 자체의 RGR 테스트
├── vi-mock-path-baseline.json      # ★ 신규 — 예외 목록 8건 (사유·후속 추적 포함)
└── lib/cli.ts                      # 기존 parseArgs 재사용

.github/workflows/ci.yml            # ★ lint 잡에 1스텝 추가
package.json                        # ★ npm script 1개 추가
```

**Structure Decision**: 기존 구조를 그대로 쓴다. 새 디렉터리·새 의존성·새 도구를 도입하지 않는다. 게이트 스크립트는 `scripts/check-retry-usage.ts`·`scripts/count-console-logs.ts` 와 동일한 자리·동일한 `--ci` 관례를 따르고, CI 에서도 같은 `lint` 잡의 이웃 스텝으로 붙는다(Assumptions 의 "기존 검사 체계에 얹을 수 있는 최소 형태" 를 그대로 구현).

## Implementation Phases

User Story 우선순위를 그대로 따르되, US1·US2·US3 은 **한 커밋 단위로 묶인다**. 경로만 고치고 멈추면 스펙 파일이 로드조차 되지 않거나(TDZ) 순서 의존으로 깨지기 때문이다.

### Phase A — 위양성 입증 (RED, US1)
- 교정 전 상태에서 `mockConfig.llmProvider` 를 바꿔도 config 의존 단언 결과가 변하지 않음을 측정·기록한다.
- `.env` 의 `LLM_PROVIDER=ollama` 를 미설정/다른 값으로 바꿔 실행해 결과가 달라지는지 확인한다(SC-002 의 역방향 측정: 교정 전에는 달라지고, 교정 후에는 달라지지 않아야 한다).

### Phase B — 원자적 경로 교정 (US1)
- `vi.hoisted()` 로 `createMockConfig`/`mockConfig` 를 끌어올린다.
- `vi.mock` 대상 경로와 3단계 동적 import 13곳을 **같은 편집에서** 4단계로 바꾼다.
- `relation-extractor.spec.ts:24` 의 죽은 선언을 제거한다(FR-012).
- 게이트: 스펙 파일이 로드되고, 최소한 실행은 시작되어야 한다.

### Phase C — 드러난 실패 전수 정리 (US2 + US3)
- 실패를 "테스트가 조건을 명시하지 않아서" / "소스 결함" 으로 분류한다(FR-005, FR-011).
- `beforeEach` 기준 상태 복원을 도입한다(FR-007).
- line 720 의 실 전역 직접 조작을 모킹 기반으로 이관한다(FR-007a).
- **환경 변수 채널을 함께 고정한다** — `process.env.LLM_PROVIDER` 가 모킹된 `mementoConfig.llmProvider` 를 덮는다(research R10). `beforeEach` 에서 두 경로를 같은 값으로 맞추고, `afterEach` 에서 환경 변수를 복원한다. 효과 없는 API 키 환경 변수 삭제는 제거한다(FR-015, SC-008).
- 단언 약화 금지. 순서 무관성·반복 실행 동일성 확인(SC-003).

### Phase D — 재발 방지 게이트 (US4, P3)
- `check-vi-mock-paths.ts` + 자체 spec + baseline 8건 등재.
- `package.json` 스크립트 + `ci.yml` lint 잡 스텝 추가.
- **baseline 등재 전에 후속 이슈를 먼저 만든다** — `followUp` 이 `#TBD` 로 남으면 SC-007 ("예외 목록의 모든 항목은 후속 추적 대상을 가진다")이 도입 시점에 곧바로 깨진다. `embedding-provider-factory.spec.ts` 5건을 한 묶음으로, 나머지 3건을 개별로 여는 것이 최소 형태다.
- 의도적 위반 1건을 넣어 검출·차단되는지, 정상 모킹 48건에 오탐이 없는지 확인(SC-005).

### 완료 게이트
`npm run lint` · `npm run type-check` · `npm test` 전부 통과. graphify 는 비적용(프로덕션 코드 미변경).

## Complexity Tracking

> Constitution Check 위반 없음 — 비움.
