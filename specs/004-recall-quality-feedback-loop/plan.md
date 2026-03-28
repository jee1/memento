# Implementation Plan: Recall Quality Feedback Loop

**Branch**: `004-recall-quality-feedback-loop` | **Date**: 2026-03-26 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `specs/004-recall-quality-feedback-loop/spec.md`

---

## Summary

검색 품질을 "계속 개선되는 시스템"으로 만들기 위한 4개 레이어 구현:
1. **P1 피드백 신호 수집**: `feedback_event` 테이블에 session_id/agent_id 추가 + 신규 `feedback` MCP 도구 + 랭킹 통합
2. **P2 쿼리 클래스별 성능**: `category-mapping.json`으로 macro_category 정의 + 카테고리별 MRR/NDCG 리포트 + CI 게이트
3. **P3 설명 가능한 랭킹**: recall에 `include_score_breakdown` 옵션 추가 (절대값 + 백분율)
4. **P4 A/B 가중치 실험**: named weight profile + permutation test 비교 스크립트

기존 `feedback_event` 테이블, `search-ranking.ts`, `quality-metrics-collector.ts`, benchmark-v3 fixture를 기반으로 최소 변경으로 구현.

---

## Technical Context

**Language/Version**: TypeScript (Node.js ≥ 20), ES modules
**Primary Dependencies**: better-sqlite3, vitest, zod (기존 의존성 신규 추가 없음)
**Storage**: SQLite (better-sqlite3) — `feedback_event` 확장: TS 마이그레이션 `021`~`024`(attribution, comment, score_breakdown_json, `(memory_id, created_at)` 복합 인덱스), SQL 참고 `005`~`008`(`005`~`007`은 컬럼·`contracts/mcp-tools.md` §5 번호 대응, `008`은 `024`과 동일 인덱스의 SQL 미러)
**Testing**: vitest — 기존 TDD 패턴(Red-Green-Refactor) 적용
**Target Platform**: Linux server (local MCP server)
**Project Type**: MCP server library (monorepo: core/server/client)
**Performance Goals**: feedback 저장 비동기(도입 전후 recall 지연 p95 증가분 <50ms), score_breakdown 포함 시 recall 지연 p95 증가분 <=100ms, `quality:benchmark:category-report` 집계 구간(시드 제외) 벽시계 <=30s(SC-006·T035)
**Constraints**: 하위 호환 필수 (기존 recall 파라미터 불변), 마이그레이션 자동 적용
**Scale/Scope**: 단일 SQLite DB, 로컬/개인 사용 (M1 범위)

---

## Constitution Check

*헌법(`.specify/memory/constitution.md` v1.0.0)을 기준으로 검증.*

| 원칙 | 상태 | 비고 |
|------|------|------|
| I. Test-First Delivery (MUST) | ✅ | 모든 스토리에서 Red→Green→Refactor 태스크 구성 |
| II. Backward Compatibility (MUST) | ✅ | `include_score_breakdown` 기본 false, 기존 호출 형식 유지 |
| III. Schema and Migration Discipline (MUST) | ✅ | 005~008 SQL 참고 + 021~024 TS 마이그레이션 + schema 동기화 |
| IV. Quality Gates Before Completion (MUST) | ✅ | lint/type-check/test 및 통합 검증 태스크 포함 |
| V. Observability and Failure Isolation (SHOULD) | ✅ | feedback 저장 실패는 구조화 로그 기록, recall 응답 경로 분리 |

Complexity Tracking 불필요 — 기존 패턴(feedback_event, ranking, quality-metrics-collector) 확장이므로 신규 추상화 없음.

---

## Project Structure

### Documentation (this feature)

```text
specs/004-recall-quality-feedback-loop/
├── plan.md              ← 이 파일
├── spec.md              ← 기능 명세
├── research.md          ← Phase 0 완료
├── data-model.md        ← Phase 1 완료
├── contracts/
│   └── mcp-tools.md     ← MCP 도구 계약
├── checklists/
│   └── requirements.md  ← 품질 체크리스트
└── tasks.md             ← /speckit.tasks 명령어로 생성
```

### Source Code (변경 위치)

```text
packages/memento-core/src/
├── infrastructure/database/database/
│   ├── migrations/
│   │   ├── 005_feedback_attribution.sql         attribution
│   │   ├── 006_feedback_comment.sql           comment 컬럼
│   │   ├── 007_feedback_score_breakdown.sql     score_breakdown_json
│   │   └── 008_feedback_memory_created_at.sql   idx_feedback_memory_created_at (TS 024 미러)
│   ├── migration/migrations/                    [TS 러너] 021~024 *.ts (024 = 복합 인덱스)
│   └── schema.sql                               [변경] 컬럼 추가 반영
├── shared/types/
│   ├── feedback.types.ts                        [신규] FeedbackEvent 타입
│   └── search.types.ts                          [변경] ScoreBreakdown 추가
├── domains/
│   ├── memory/
│   │   └── repositories/
│   │       └── feedback-repository.ts           [신규] DB CRUD
│   └── search/
│       ├── algorithms/
│       │   ├── search-ranking.ts                [변경] feedback_score 통합
│       │   └── hybrid-search-engine.ts          [변경] feedback 집계 주입
│       └── services/
│           └── (recall 로직은 recall-tool.ts 직접 처리, 별도 서비스 없음)
└── domains/monitoring/services/quality-assurance/
    └── quality-metrics-collector.ts             [변경] macro_category별 집계

packages/memento-core/src/domains/memory/tools/
├── feedback-tool.ts                             [신규] MCP feedback 도구
└── recall-tool.ts                               [변경] include_score_breakdown 파라미터

packages/memento-core/src/tools/
└── index.ts                                     [변경] FeedbackTool coreTools 배열에 추가

packages/memento-client/src/
├── memento-client.ts                            [변경] `feedback(memory_id, helpful, comment?, score?, score_breakdown?, options?)` HTTP 본문 — FR-002·US3 (`contracts/mcp-tools.md` §2; options는 마지막에 두어 무옵션 호출 시 인자 순서 안전)
└── types.ts                                     [변경] `FeedbackResult`, `FeedbackCallOptions`

tests/fixtures/search-quality/benchmark-v3/
└── category-mapping.json                        [신규] macro_category 매핑

config/ranking-profiles/
├── default.toml                                 [신규] 기본 가중치 프로파일
└── feedback-heavy.toml                          [신규] 실험용 가중치 예시

scripts/
├── quality-benchmark-category-report.ts         [신규] 카테고리별 품질 리포트
└── compare-weight-profiles.ts                   [신규] A/B 비교 스크립트
```

---

## Implementation Order

레이어별로 독립 구현 가능. P1 완료 후 P2~P4는 병렬 진행 가능.

### Layer P1: 피드백 신호 수집 (의존성: 없음)

1. **마이그레이션 005** — `feedback_event`에 `session_id`, `agent_id` 컬럼 추가
2. **마이그레이션 024 (TS) / 008 (SQL)** — `feedback_event(memory_id, created_at)` 복합 인덱스(`getNetScores` 슬라이딩 윈도우)
3. **feedback.types.ts** — `FeedbackEvent`, `CreateFeedbackEventInput`, `FeedbackNetScore` 타입
4. **feedback-repository.ts** — `insertFeedback(input)`, `getNetScores(memoryIds, windowDays)` 구현
5. **search-ranking.ts** — `RankingFeatures`에 `feedback_score?: number` 추가, 랭킹 공식에 `zeta_fb` 가중치 통합(`feedback_norm` 중립 0.5일 때 항 기여 0)
6. **hybrid-search-engine.ts** — recall 호출 시 후보 memory ID 목록으로 `getNetScores` 호출 후 features에 주입
7. **feedback-tool.ts (MCP)** — `packages/memento-core/src/domains/memory/tools/feedback-tool.ts`: `memory_id`, `helpful`, `comment?`, `score?`, `score_breakdown?`, `session_id?`, `agent_id?` (`contracts/mcp-tools.md` §2, US3 맥락 저장)
8. **tools/index.ts** — `packages/memento-core/src/tools/index.ts`: `coreTools` 배열에 `FeedbackTool` 추가

### Layer P2: 쿼리 클래스별 성능 (의존성: 없음, P1과 독립)

1. **category-mapping.json** — macro_category ↔ category 매핑 정의
2. **benchmark.types.ts** — `MacroCategory`, `QueryWithCategory`, `CategoryQualityReport` 타입
3. **quality-metrics-collector.ts** — `collectCategoryMetrics(benchmarkDir, mappingPath)` 메서드 추가
4. **quality-benchmark-category-report.ts 스크립트** — CLI 출력 + CI 게이트 (MRR < 0.5 시 exit 1)
5. **package.json** — `quality:benchmark:category-report` 스크립트 등록

### Layer P3: score_breakdown (의존성: P1의 feedback_score 통합 완료)

1. **search.types.ts** — `packages/memento-core/src/shared/types/search.types.ts`: `ScoreComponent`, `ScoreBreakdown` 타입
2. **search-ranking.ts** — `packages/memento-core/src/domains/search/algorithms/search-ranking.ts`: `rank()` 반환값에 `breakdown?: ScoreBreakdown` 포함 옵션 추가
3. **recall-tool.ts** — `packages/memento-core/src/domains/memory/tools/recall-tool.ts`: `include_score_breakdown?: boolean` 파라미터 추가(zod schema 변경) + ranking 결과에서 breakdown 추출 직접 처리 (별도 recall-service.ts 없음)

### Layer P4: A/B 가중치 실험 (의존성: P2 quality-metrics-collector 완료)

1. **ranking.types.ts** — `WeightProfile`, `ABComparisonReport` 타입
2. **config/ranking-profiles/default.toml** — 현재 기본 가중치 프로파일화
3. **config/ranking-profiles/feedback-heavy.toml** — 실험용 예시 프로파일
4. **compare-weight-profiles.ts 스크립트** — 두 프로파일로 benchmark 실행 + permutation test
5. **package.json** — `quality:benchmark:compare-profiles` 스크립트 등록

---

## Key Design Decisions (from research.md)

| 결정 | 선택 | 근거 |
|------|------|------|
| 피드백 저장소 | 기존 feedback_event 테이블 확장 | 스키마 최소 변경, 기존 FK/인덱스 재사용 |
| 피드백 반영 시점 | 호출 시 집계 (IN 절) | 배치 스케줄러 불필요, 경쟁 조건 없음 |
| 피드백 TTL | 90일 WHERE 절 | 에피소딕 TTL과 일치, 물리 삭제 불필요 |
| 카테고리 관리 | 별도 category-mapping.json | queries.json 불변, manifest 재검증 불필요 |
| score_breakdown 형식 | 절대값 + 백분율 | 절대값으로 규모, 백분율로 기여 비율 파악 |
| A/B 통계 방법 | Paired permutation test | 쿼리 23개 소규모에 적합 |
| 다중 에이전트 접근 제어 | 전역 공유 | cold-start 방지, owner_id 필터로 격리 가능 |
