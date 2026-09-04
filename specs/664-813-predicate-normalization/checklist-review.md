# Code Review: triple predicate 정규화 게이트

**Feature**: 664-813-predicate-normalization | **Issue**: [#813](https://github.com/jee1/memento/issues/813)
**Reviewed**: 2026-09-04
**Range**: `main` → working tree (tracked diff 14 files + untracked #813 implementation files)
**Protocol**: `/speckit.superspec.review` → superpowers `requesting-code-review` (읽기 전용)

## 1. 요약

`TripleNormalizer.normalizeWithReport`가 FR-001 단일 게이트(choke point)로 동작하며, pass-through(`success ? canonical : triple.predicate`)가 제거되었다. `TripleExtractionService.extractWithLLM`에서 accepted triple만 반환하고 skip reason·집계를 `ExtractionInfo`에 실으며, `convertEpisodicSource`는 전부 게이트된 경우 soft success + skip metadata로 #805 패턴과 정렬된다. CLI `memory:kg-triple-predicate-quality`는 read-only 집계·캡 샘플을 제공하고 FR-006(절대 DB 경로 비노출)을 준수한다.

관련 테스트 232건(도메인·CLI·conversion) 및 `npm run lint` / `npm run type-check` 통과 확인.

**Critical 0건 · Important 0건** → **PASS**

## 2. 스펙 준수

| 항목 | 판정 | 근거 |
|------|------|------|
| FR-001 | PASS | 게이트 우선순위: empty → canonical+reassembly → OOV(공백 없음+한글 종결+reassembly) → drop (`triple-normalizer.ts:73-100`) |
| FR-002 | PASS | canonicalize 실패 시 pass-through 제거; OOV 규칙 2만 예외 (`triple-normalizer.ts:90-100`) |
| FR-003 | PASS | 게이트 통과 triple만 persist 경로 유입; `createSemanticMemory`의 form-(2) 폴백은 legacy·게이트 우회 시에만 (`semantic-memory-crud.ts:63-68`, `predicate-gate-persist.spec.ts`) |
| FR-004 | PASS | extraction 결과·persist spec에서 bad `kg_triple` 0건 (`predicate-gate-persist.spec.ts:119-124`) |
| FR-005 | PASS | `scripts/lib/kg-triple-predicate-quality.ts` + npm script (`package.json:102`) |
| FR-006 | PASS | stdout JSON only, sample cap ≤20, abs path 미출력 (`kg-triple-predicate-quality.spec.ts:149-179`) |
| FR-007 | PASS | reason 3종 고정; service `logger.info` + metadata keys (`triple-extraction-service.ts:376-381`, `triple-extraction-metadata.ts:31-34`) |
| FR-008 | PASS | MCP tool schema·검색 응답 무변경; `ExtractionInfo` additive만 |
| FR-009 | PASS | 부분 성공·all-skip soft success (`episodic-semantic-conversion.ts:292-311`, `episodic-semantic-conversion.spec.ts:280-359`) |
| FR-010 | PASS | 합성 predicate fixture만 사용 (normalizer·persist·CLI spec) |
| SC-001 | PASS | `predicate-gate-persist.spec.ts` — phrase/Latin → semantic form-(2) 0 |
| SC-002 | PASS | 동 spec — bad `kg_triple` 0 |
| SC-003 | PASS | CLI spec — rate·샘플·COUNT 불변 |
| SC-004 | PASS | lint/type-check + domain tests green (review run) |
| SC-005 | PASS | MCP 계약 변경 없음 (implicit; 기존 회귀 스위트 대상) |
| SC-006 | PASS | ops 목표만; CI assert 없음 (tasks Global Constraints 준수) |
| SC-007 | PASS | conversion spec — skip aggregates + primary non-failure |

### User Story / Acceptance Scenarios

| Story | AS | 판정 |
|-------|-----|------|
| US1 | AS1 `관련 작업` drop + reason | PASS (`triple-normalizer.spec.ts:20-29`) |
| US1 | AS2 `use` dict→`사용함`; no dict→drop | PASS (`triple-normalizer.spec.ts:44-57`, `:155-164`) |
| US1 | AS3 `사용함` 재조립 content | PASS (normalizer + persist spec) |
| US1 | AS4 OOV `배포함` accept | PASS (`triple-normalizer.spec.ts:69-77`, persist spec) |
| US1 | AS5 reassembly null → drop | PASS (`triple-normalizer.spec.ts:79-103`) |
| US2 | AS1 hangul rate ≈0.9 + samples | PASS (`kg-triple-predicate-quality.spec.ts:52-67`) |
| US2 | AS2 DB row count 불변 | PASS (builder + CLI read-only spec) |
| US3 | AS1 reason 기록 + 주 경로 성공 | PASS (service log + conversion) |
| US3 | AS2 부분 성공 + all-skip soft success | PASS (`episodic-semantic-conversion.spec.ts:280-359`) |

### Edge Cases (brainstorm)

| Category | Case | 판정 |
|----------|------|------|
| Boundary | empty/whitespace | PASS → `predicate_empty` |
| Boundary | OOV 한글 단일 토큰 | PASS → reassembly OK 시 accept |
| Boundary | 공백 포함 구 | PASS → drop (no head-word) |
| Boundary | 영문 미매칭 | PASS → drop; dict match → canonical |
| Boundary | 필터 후 0건 | PASS → soft success + metadata |
| Error | reassembly null | PASS → drop, no 원문 폴백 on gated path |
| Scale | CLI sample cap | PASS |
| Security | CLI abs path | PASS |
| UX/Ops | #804 FR-001b 불변 | PASS (Non-Goal) |
| UX/Ops | kg_triple upsert gated only | PASS |

## 3. Constitution (I–V)

| Principle | 판정 | Notes |
|-----------|------|-------|
| I Test-First | PASS | RED→GREEN 시나리오 per tasks; normalizer·conversion·CLI·persist specs |
| II MCP contracts | PASS | FR-008; public tool/response unchanged |
| III Schema | PASS | No DDL; gated upserts on existing tables |
| IV Quality gates | PASS | lint, type-check, targeted tests green at review |
| V Observability | PASS | skip reasons in log + metadata; remember primary path non-fatal |

## 4. 발견 사항

### Critical

없음.

### Important

없음 (confidence ≥ 80 기준).

### Suggestion

**[신뢰도 88] PR 커밋 전 untracked 구현 파일 스테이징 필요**

다음 #813 핵심 파일이 아직 untracked: `scripts/kg-triple-predicate-quality.ts`, `scripts/lib/kg-triple-predicate-quality.ts`, `scripts/kg-triple-predicate-quality.spec.ts`, `predicate-gate-persist.spec.ts`, `triple-extraction-predicate-gate.spec.ts`, `triple-extraction-metadata.spec.ts`, `specs/664-813-predicate-normalization/`. 코드 결함은 아니나 PR/머지 전 `git add` 필수.

**[신뢰도 82] `extractTriples` LLM→parser E2E 게이트 테스트 없음**

게이트는 `normalizeWithReport`·result-helper·conversion·persist 레이어로 분리 검증됨. `TripleExtractionService.extractWithLLM`에 parser mock을 두고 skip이 `ExtractionInfo`까지 전달되는 통합 1건은 회귀 방어력을 높일 수 있으나 tasks 범위(T005–T008)에는 필수 아님.

**[신뢰도 80] `hasPredicateGateSkips` 로직 중복**

`episodic-semantic-conversion.ts:34-62`와 `triple-extraction-result-helpers.ts:27-36`에 유사 로직. 동작은 일치; 후속에서 helper 단일 import로 정리 가능.

## 5. 강점

- 단일 choke point(`TripleNormalizer`) 설계가 plan Architecture·FR-002 invariant와 일치.
- all-gate-empty vs true `no_triple` 분기가 `normalizeTripleExtractionResult` + `convertEpisodicSource`에서 명확히 분리됨 (#813 soft success).
- OOV 허용 조건(공백 없음 + 한글 종결 + reassembly)이 plan caveat과 코드 주석에 반영됨.
- CLI가 `db-residue` 패턴(순수 builder + thin CLI + read-only spec)을 따름.
- AGENTS.md §3.1 gotcha + CHANGELOG 항목으로 ops discoverability 확보.

## 6. 검증 (review run)

```bash
npm test -- \
  packages/memento-core/src/domains/relation/services/triple-extraction \
  packages/memento-core/src/domains/memory/semantic/predicate-gate-persist.spec.ts \
  packages/memento-core/src/domains/memory/semantic/triple-extraction-metadata.spec.ts \
  packages/memento-core/src/domains/memory/semantic/episodic-semantic-conversion.spec.ts \
  scripts/kg-triple-predicate-quality.spec.ts
# → 17 + 3 test files, 232 tests passed

npm run lint && npm run type-check
# → 0 errors
```

## 7. 최종 판정

**PASS** — Critical/Important 없음. 머지 전 untracked 파일 스테이징만 확인하면 됨.
