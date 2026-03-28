# Tasks: Recall Quality Feedback Loop

**Input**: Design documents from `specs/004-recall-quality-feedback-loop/`
**Branch**: `004-recall-quality-feedback-loop`
**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, data-model.md ✅, contracts/ ✅

**Tests**: 프로젝트 TDD 원칙(CLAUDE.md) 준수 — 모든 구현 태스크에 Red-Green-Refactor 적용

**Organization**: 4개 User Story(P1~P4) 기준 구성. P1·P2는 병렬 진행 가능, P3는 P1 이후, P4는 P2 이후.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 병렬 실행 가능 (다른 파일, 완료 의존성 없음)
- **[Story]**: 해당 User Story (US1~US4)
- 파일 경로는 repo root 기준

---

## Phase 1: Setup (공유 기반 인프라)

**Purpose**: 모든 User Story에 필요한 DB 마이그레이션과 공유 타입 생성

- [X] T001 마이그레이션 파일 생성: `packages/memento-core/src/infrastructure/database/database/migrations/005_feedback_attribution.sql` (session_id, agent_id 컬럼 추가 + 인덱스)
- [X] T002 [P] `feedback.types.ts` 신규 생성: `packages/memento-core/src/shared/types/feedback.types.ts` (FeedbackEvent, CreateFeedbackEventInput, FeedbackNetScore)
- [X] T003 [P] `benchmark.types.ts` 신규 생성: `packages/memento-core/src/shared/types/benchmark.types.ts` (MacroCategory, QueryWithCategory, CategoryQualityReport)
- [X] T004 [P] `ranking.types.ts` 확장: `packages/memento-core/src/shared/types/ranking.types.ts` (WeightProfile, ABComparisonReport 추가)
- [X] T005 `schema.sql` 반영 업데이트: `packages/memento-core/src/infrastructure/database/database/schema.sql` (session_id, agent_id 컬럼 주석 반영)

**Checkpoint**: 마이그레이션 파일과 타입 정의 완료 — User Story 구현 시작 가능

---

## Phase 2: User Story 1 — 피드백 신호 수집 (Priority: P1) 🎯 MVP

**Goal**: 에이전트가 recall 결과에 helpful/not_helpful 피드백을 기록하고, 해당 신호가 다음 recall 랭킹에 반영된다.

**Independent Test**: recall → feedback 제출 → 재recall 시 긍정 피드백 기억이 상위에 오는지 확인

### 테스트 (Red — 실패 먼저 작성)

- [X] T006 [P] [US1] `feedback-repository.spec.ts` 신규 작성 (실패 확인): `packages/memento-core/src/domains/memory/repositories/__tests__/feedback-repository.spec.ts` (insertFeedback, getNetScores 단위 테스트)
- [X] T007 [P] [US1] `feedback-tool.spec.ts` 신규 작성 (실패 확인): `packages/memento-core/src/domains/memory/tools/__tests__/feedback-tool.spec.ts` (MCP 입력 검증, 성공/실패 응답 형식 테스트, FR-012 memory_id 존재·형식 검증 시나리오, FR-013 반복 제출 독립 이벤트 확인, FR-014 저장 실패 시 warn 로그 필드 검증)
- [X] T008 [P] [US1] `search-ranking.spec.ts`에 feedback_score 테스트 추가 (실패 확인): `packages/memento-core/src/domains/search/algorithms/__tests__/search-ranking.spec.ts` (feedback_score 주입 시 zeta_fb 가중치 반영 테스트, sigmoid 정확도: net=0→0.5 중립, net=1→≈0.731, net=−1→≈0.269)

### 구현 (Green)

- [X] T009 [US1] `feedback-repository.ts` 신규 구현: `packages/memento-core/src/domains/memory/repositories/feedback-repository.ts` (insertFeedback, getNetScores — 90일 슬라이딩 윈도우 IN 절 집계, net_score는 원시 정수 반환)
- [X] T010 [US1] `search-ranking.ts` 수정: `packages/memento-core/src/domains/search/algorithms/search-ranking.ts` (RankingFeatures에 `feedback_score?: number` 추가 — 값은 이미 sigmoid 정규화된 [0,1]; `feedback_score ?? 0.5` 를 zeta_fb=0.05 가중치로 공식에 독립 항 추가)
- [X] T011 [US1] `hybrid-search-engine.ts` 수정: `packages/memento-core/src/domains/search/algorithms/hybrid-search-engine.ts` (후보 memory ID로 getNetScores 호출 → 각 net_score에 시그모이드 정규화(`1/(1+e^(-x))`) 적용 → 정규화된 값을 features.feedback_score에 주입)
- [X] T012 [US1] `feedback-tool.ts` 신규 구현: `packages/memento-core/src/domains/memory/tools/feedback-tool.ts` (memory_id, helpful, session_id?, agent_id? 처리 — FR-012: memory_id 존재·형식만 검증, FR-013: 반복 제출 허용·독립 이벤트 저장, FR-014: 저장 실패 시 warn 로그에 memory_id·session_id·agent_id·error·timestamp ISO8601 포함, recall 응답 영향 없음)
- [X] T013 [US1] feedback-tool을 tool registry에 등록: `packages/memento-core/src/tools/index.ts` (`coreTools` 배열에 `new FeedbackTool()` 추가 + import)

**Checkpoint**: US1 독립 검증 — `npx vitest run packages/memento-core/src/domains/memory/repositories/__tests__/feedback-repository.spec.ts` + `packages/memento-core/src/domains/memory/tools/__tests__/feedback-tool.spec.ts`

---

## Phase 3: User Story 2 — 쿼리 클래스별 성능 측정 (Priority: P2)

**Goal**: 개발자가 4종 macro_category(episodic_recent/procedural/conceptual/tag_filter)별 MRR·NDCG를 분리 측정하고 CI 게이트를 통해 취약 영역을 확인한다.

**Independent Test**: `npm run quality:benchmark:category-report` 실행 시 카테고리별 수치 출력 및 MRR < 0.5 시 exit 1 확인

> ⚠️ US2는 US1과 독립 — 병렬 진행 가능

### 테스트 (Red — 실패 먼저 작성)

- [X] T014 [P] [US2] `quality-metrics-collector.spec.ts`에 collectCategoryMetrics 테스트 추가 (실패 확인): `packages/memento-core/src/domains/monitoring/services/quality-assurance/quality-metrics-collector.spec.ts` (category 필드 누락 쿼리 포함 시 에러 시나리오 포함)
- [X] T015 [P] [US2] `quality-benchmark-category-report.spec.ts` 신규 작성 (실패 확인): `scripts/quality-benchmark-category-report.spec.ts` (CLI 출력 형식, exit code 테스트)

### 구현 (Green)

- [X] T016 [P] [US2] `category-mapping.json` 신규 생성: `tests/fixtures/search-quality/benchmark-v3/category-mapping.json` (macro_category → category[] 매핑 + query_overrides:{})
- [X] T017 [US2] `quality-metrics-collector.ts` 수정: `packages/memento-core/src/domains/monitoring/services/quality-assurance/quality-metrics-collector.ts` (`collectCategoryMetrics(benchmarkDir, mappingPath)` 메서드 추가)
- [X] T018 [US2] `quality-benchmark-category-report.ts` 스크립트 신규 구현: `scripts/quality-benchmark-category-report.ts` (CLI 출력: macro_category | queries | MRR | NDCG@5 | NDCG@10 | threshold, MRR < 0.5 시 exit 1)
- [X] T019 [US2] npm 스크립트 등록: 루트 `package.json`에 `quality:benchmark:category-report` 추가

**Checkpoint**: US2 독립 검증 — `npm run quality:benchmark:category-report` 실행 후 카테고리별 리포트 출력 확인

---

## Phase 4: User Story 3 — 설명 가능한 랭킹 (Priority: P3)

**Goal**: recall 호출 시 `include_score_breakdown: true` 옵션을 사용하면 각 결과에 점수 구성 요소(절대값+백분율)가 포함된다. 기존 호출은 영향 없음(하위 호환).

**Independent Test**: `include_score_breakdown: true/false` 두 가지 호출로 응답 형식 차이 확인

> ⚠️ US3은 US1 완료 이후 시작 (feedback_score가 search-ranking.ts에 통합된 후)

### 테스트 (Red — 실패 먼저 작성)

- [X] T020 [P] [US3] `search-ranking.spec.ts`에 breakdown 옵션 테스트 추가 (실패 확인): `packages/memento-core/src/domains/search/algorithms/__tests__/search-ranking.spec.ts` (breakdown 포함/미포함 시 반환값 구조 테스트)
- [X] T021 [P] [US3] `recall-tool.spec.ts`에 include_score_breakdown 테스트 추가 (실패 확인): `packages/memento-core/src/domains/memory/tools/__tests__/recall-tool.spec.ts` (파라미터 유효성, 응답 score_breakdown 포함 여부 테스트)

### 구현 (Green)

- [X] T022 [P] [US3] `search.types.ts` 확장: `packages/memento-core/src/shared/types/search.types.ts` (ScoreComponent, ScoreBreakdown 타입 추가 — 6개 항목: relevance, recency, importance, usage, feedback, duplication_penalty + total)
- [X] T023 [US3] `search-ranking.ts` 수정: `packages/memento-core/src/domains/search/algorithms/search-ranking.ts` (`rank()` 반환값에 `breakdown?: ScoreBreakdown` 옵션 추가, 절대값+백분율 계산, feedback 항목 포함 6개 구성 요소)
- [X] T024 [US3] `recall-tool.ts` 수정 (breakdown 옵션 전달): `packages/memento-core/src/domains/memory/tools/recall-tool.ts` (ranking 호출 시 `include_score_breakdown` 옵션 전달 + 결과에서 breakdown 추출해 응답에 포함)
- [X] T025 [US3] `recall-tool.ts` 수정 (zod 파라미터): `packages/memento-core/src/domains/memory/tools/recall-tool.ts` (`include_score_breakdown?: boolean` zod inputSchema 추가, 기본값 false — T024 완료 후 진행)

**Checkpoint**: US3 독립 검증 — `include_score_breakdown: true` recall 호출 후 score_breakdown 포함 응답 확인, `include_score_breakdown` 미사용 시 기존 형식 유지 확인

---

## Phase 5: User Story 4 — 랭킹 가중치 A/B 실험 (Priority: P4)

**Goal**: 두 가중치 프로파일을 benchmark-v3로 비교해 MRR·NDCG 차이와 통계적 유의성(paired permutation test)을 리포트한다.

**Independent Test**: `npm run quality:benchmark:compare-profiles -- --profile-a default --profile-b feedback-heavy` 실행 후 MRR 비교 + p-value 출력 확인

> ⚠️ US4는 US2 완료 이후 시작 (quality-metrics-collector의 카테고리 집계 인프라 활용)

### 테스트 (Red — 실패 먼저 작성)

- [X] T026 [P] [US4] `compare-weight-profiles.spec.ts` 신규 작성 (실패 확인): `scripts/compare-weight-profiles.spec.ts` (두 프로파일 로딩, permutation test 결과 구조 테스트)

### 구현 (Green)

- [X] T027 [P] [US4] `default.toml` 신규 생성: `config/ranking-profiles/default.toml` (`config/ranking-weights.toml`과 동일: alpha=0.45, beta=0.20, gamma=0.20, delta=0.10, zeta=0.15, epsilon=0.10, theta=0.10, zeta_fb=0.05)
- [X] T028 [P] [US4] `feedback-heavy.toml` 신규 생성: `config/ranking-profiles/feedback-heavy.toml` (실험용: zeta_fb 상향, 다른 가중치 조정)
- [X] T029 [US4] `compare-weight-profiles.ts` 스크립트 신규 구현: `scripts/compare-weight-profiles.ts` (두 프로파일 로드 → benchmark-v3 실행 → MRR·NDCG@5·NDCG@10 집계 → paired permutation test → verdict: a_better/b_better/inconclusive)
- [X] T030 [US4] npm 스크립트 등록: 루트 `package.json`에 `quality:benchmark:compare-profiles` 추가

**Checkpoint**: US4 독립 검증 — 두 프로파일 비교 실행 후 p-value·verdict 포함 리포트 출력 확인

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: 전체 품질 게이트 통과 및 통합 검증

- [X] T031 lint·type-check 전체 통과: `npm run lint && npm run type-check` (모든 신규 파일 포함)
- [X] T032 [P] 전체 테스트 스위트 통과: `npm test` (기존 테스트 회귀 없음 확인) — 2026-03-28 로컬 전체 스위트 통과로 검증
- [X] T033 [P] 피드백→랭킹 end-to-end 시나리오 검증: `packages/memento-core/src/test/test-feedback-ranking.spec.ts` + `npm run test:feedback-ranking` (recall → 피드백 다건 → 재recall 시 순위 상승)
- [X] T034 [P] score_breakdown 응답 시간 검증: `packages/memento-core/src/domains/search/algorithms/__tests__/search-ranking.spec.ts`에 breakdown 계산 추가 시 ≤100ms 이내 타이밍 단위 테스트 추가 (SC-003)
- [X] T035 [P] 카테고리 리포트 스크립트 벽시계 자동 검증(SC-006): `scripts/quality-benchmark-category-report.ts`에서 DB 시드 **이후** `collectCategoryMetrics`~출력 구간만 타이머로 측정, 30초 초과 시 non-zero exit(전체 CI 파이프라인 총시간이 아님 — `spec.md` SC-006·Clarifications)
- [X] T036 마이그레이션 자동 적용 검증: `npm run db:migrate -w @memento/core` 실행 + `feedback-repository.spec.ts` PRAGMA로 `feedback_event` 컬럼 확인(session_id, agent_id, comment, score_breakdown_json). TS 러너: `021`~`024`(속성·comment·score_breakdown·`idx_feedback_memory_created_at`). SQL 참고 스크립트: `005_feedback_attribution.sql` ~ `008_feedback_memory_created_at.sql`(번호는 TS와 별도; `contracts/mcp-tools.md` §5)
- [X] T037 [P] feedback 저장 경로 p95 지연 검증: `packages/memento-core/src/domains/search/algorithms/__tests__/hybrid-search-engine.spec.ts`에 `getNetScores` 빈 테이블 vs 대량 행 p95 차이 <50ms (FR-004)
- [X] T038 [P] 피드백 저장 실패율 측정 검증: `packages/memento-core/src/domains/memory/tools/__tests__/feedback-tool.spec.ts`에 대량 실패 시나리오를 추가해 실패율 계산 로직/리포트가 1% 임계치 판정 가능함을 확인 (SC-004)
- [X] T039 [P] 30일 재등장률 개선 측정 기준선 스크립트 작성: `scripts/quality-feedback-reappearance-report.ts` 신규 작성 (도입 전/후 top-5 재등장률 계산 및 +10% 비교 리포트, SC-001)
- [X] T040 [P] `@memento/client` 연동: `packages/memento-client` — `feedback(memory_id, helpful, comment?, score?, score_breakdown?, options?)` (options·세션/에이전트는 마지막; FR-002·`contracts/mcp-tools.md` §2), POST 반영; `plan.md`에 클라이언트 경로 명시(FR-002·N1)

---

## Dependencies & Execution Order

### Phase Dependencies

```
Phase 1 (Setup)
    ↓ — BLOCKS all user stories
Phase 2 (US1) ←→ Phase 3 (US2)   ← 병렬 가능
    ↓                   ↓
Phase 4 (US3)     Phase 5 (US4)
    ↓ (합류)            ↓ (합류)
Phase 6 (Polish)
```

### User Story Dependencies

| User Story | 선행 조건 | 병렬 가능 대상 |
|------------|-----------|----------------|
| US1 (P1) | Phase 1 완료 | US2와 병렬 가능 |
| US2 (P2) | Phase 1 완료 | US1과 병렬 가능 |
| US3 (P3) | US1 완료 | — |
| US4 (P4) | US2 완료 | — |

### Task-Level Dependencies (US1)

```
T006, T007, T008 (테스트 작성) ← 병렬
    ↓
T009 (feedback-repository)
    ↓
T010 (search-ranking feedback_score)
    ↓
T011 (hybrid-search-engine 주입)
    ↓
T012, T013 (feedback-tool + 등록)
```

### Task-Level Dependencies (US3)

```
T020, T021 (테스트 작성) ← 병렬
T022 (ScoreBreakdown 타입) ← 병렬
    ↓
T023 (search-ranking breakdown 구현)
    ↓
T024 (recall-tool.ts breakdown 옵션 전달)
    ↓
T025 (recall-tool.ts zod 파라미터 추가)
```

### Parallel Opportunities

- T002, T003, T004 (공유 타입 신규 파일 3개) — 동시 진행 가능
- T006, T007, T008 (US1 테스트 3개) — 동시 작성 가능
- T014, T015, T016 (US2 테스트 + category-mapping.json) — 동시 진행 가능
- T020, T021, T022 (US3 테스트 + 타입) — 동시 진행 가능
- T026, T027, T028 (US4 테스트 + TOML 파일 2개) — 동시 진행 가능

---

## Parallel Example: User Story 1

```bash
# 테스트 파일 3개 동시 작성 (Red):
Task: "T006 feedback-repository.spec.ts 신규 작성"
Task: "T007 feedback-tool.spec.ts 신규 작성"
Task: "T008 search-ranking.spec.ts feedback_score 테스트 추가"

# 테스트 통과 후 구현 순서:
T009 → T010 → T011 → T012 → T013
```

## Parallel Example: User Story 2 (US1과 동시 진행)

```bash
# US1 진행 중 동시에:
Task: "T014 quality-metrics-collector.spec.ts 테스트 추가"
Task: "T015 quality-benchmark-category-report.spec.ts 신규 작성"
Task: "T016 category-mapping.json 생성"
```

---

## Implementation Strategy

### MVP First (User Story 1만)

1. Phase 1 완료 (T001~T005)
2. US1 테스트 작성 Red (T006~T008)
3. US1 구현 Green (T009~T013)
4. **STOP & VALIDATE**: feedback MCP 도구로 피드백 제출 → recall 재호출 → 랭킹 반영 확인
5. 이후 US2~US4 점진 추가

### Incremental Delivery

1. Phase 1 (T001~T005) → 기반 준비
2. US1 (T006~T013) → 피드백 수집 + 랭킹 반영 ← **MVP**
3. US2 (T014~T019) → 카테고리별 성능 측정 (US1과 병렬 가능)
4. US3 (T020~T025) → 설명 가능한 랭킹 (US1 이후)
5. US4 (T026~T030) → A/B 실험 (US2 이후)
6. Polish (T031~T040) → 전체 통합 검증

### Single Developer 순서

```
T001 → T002/T003/T004(병렬) → T005
→ T006/T007/T008(병렬) → T009 → T010 → T011 → T012 → T013   ← US1 완료
→ T014/T015/T016(병렬) → T017 → T018 → T019                  ← US2 완료
→ T020/T021/T022(병렬) → T023 → T024 → T025                  ← US3 완료 (T024·T025 모두 recall-tool.ts)
→ T026/T027/T028(병렬) → T029 → T030                         ← US4 완료
→ T031 → T032/T033/T034/T035/T037/T038/T039/T040(병렬) → T036     ← Polish
```

---

## Notes

- **Spec alignment (2026-03-28)**: `score_breakdown.relevance` 복합 의미(관계·절차·process_fit 합산) 및 US4 프로파일 승격 수동 절차는 `spec.md`(FR-008, US4, Assumptions, Clarifications), `data-model.md` §6, `contracts/mcp-tools.md` §1·§3.3에 반영됨.
- **Spec alignment (2026-03-28)**: `contracts/mcp-tools.md` §1에 `pct`의 `Math.round` 산출·`search-ranking.ts` 구현 참조를 명시. SC-006 초과 시 stderr에 시드 제외·전체 CI 워크플로 비포함 측정 범위를 표기(`quality-benchmark-category-report.ts`).
- TDD 원칙: 테스트 파일을 먼저 작성하고 `npx vitest run [파일]`로 Red(실패) 확인 후 구현
- [P] 태스크 = 다른 파일을 수정하므로 의존성 없이 병렬 진행 가능
- [Story] 라벨로 각 태스크가 어느 User Story에 속하는지 추적
- 각 Phase Checkpoint에서 독립 검증 후 다음 Phase 진행
- `feedback-tool.ts`의 저장 실패는 recall 응답에 영향 없어야 함 (SC-004)
- `include_score_breakdown` 미사용 시 기존 응답 형식 그대로 유지 (FR-009, 하위 호환)
