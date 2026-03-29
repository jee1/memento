# Implementation Plan: Sleep Consolidation

**Branch**: `005-sleep-consolidation` | **Date**: 2026-03-28 | **Spec**: [spec.md](./spec.md)

## Summary

에피소딕 기억 클러스터를 오프라인 배치로 시맨틱 기억으로 증류한다. 임베딩 유사도 기반 greedy 클러스터링 → LLM(또는 extractive) 요약 → 시맨틱 저장 → 에피소딕 `is_consolidated` 마킹 순서로 실행하며, 시맨틱 저장 성공 후에만 에피소딕을 마킹하여 자기수복(self-healing) 특성을 보장한다.

## Technical Context

**Language/Version**: TypeScript (Node.js ≥ 20), ES modules
**Primary Dependencies**: better-sqlite3, zod, vitest (기존 의존성, 신규 추가 없음)
**Storage**: SQLite (better-sqlite3) — `memory_item.is_consolidated`는 TS 마이그레이션 `025-memory-item-is-consolidated.ts`(25.0); 레거시 `extracted_from`/`supported_by` 방향 보정은 `026-flip-consolidation-relation-directions.ts`(26.0)
**Testing**: vitest (unit `.spec.ts` + scenario `src/test/`)
**Target Platform**: Node.js 서버 (기존 memento-server)
**Project Type**: library + server (monorepo)
**Performance Goals**: 에피소딕 500개 기준 배치 120초 이내 (SC-004), recall 10% 이내 레이턴시 영향 (SC-002)
**Constraints**: 실시간 recall/remember와 격리된 오프라인 배치. 신규 외부 의존성 없음.
**Scale/Scope**: 초기 구현 기준 500개 에피소딕 / owner_id 단위

## Constitution Check

| 원칙 | 상태 | 비고 |
|------|------|------|
| I. Test-First Delivery | ✅ PASS | 각 구현 단계에서 spec 먼저 작성 |
| II. Backward Compatibility | ✅ PASS | 기존 MCP tool 계약 변경 없음. Admin-only 신규 엔드포인트 추가만 |
| III. Schema Migration Discipline | ✅ PASS | migration 025·026 및 schema.sql + TS 타입 동기화 |
| IV. Quality Gates | ✅ PASS | 각 Phase 완료 후 lint + type-check + test 통과 필수 |
| V. Observability | ✅ PASS | FileLogger 구조화 로그, 부분 실패 격리 (FR-009) |

## Project Structure

### Documentation (this feature)

```text
specs/005-sleep-consolidation/
├── plan.md              ← 이 파일
├── research.md          ← Phase 0 완료
├── data-model.md        ← Phase 1 완료
├── contracts/
│   └── admin-api.md     ← Phase 1 완료
└── tasks.md             ← /speckit.tasks 로 생성 예정
```

### Source Code

```text
packages/memento-core/
├── src/
│   ├── domains/
│   │   └── consolidation/              ← NEW 도메인
│   │       ├── services/
│   │       │   ├── sleep-consolidation-service.ts    ← 배치 오케스트레이터
│   │       │   ├── clustering-service.ts             ← 유사도 클러스터링
│   │       │   └── summarization-service.ts          ← LLM/extractive 요약
│   │       ├── repositories/
│   │       │   └── consolidation-repository.ts       ← DB 쿼리
│   │       └── index.ts
│   └── infrastructure/
│       ├── database/database/migration/migrations/
│       │   ├── 025-memory-item-is-consolidated.ts   ← NEW (25.0)
│       │   └── 026-flip-consolidation-relation-directions.ts ← 관계 방향 레거시 보정 (26.0)
│       └── scheduler/jobs/
│           └── sleep-consolidation-batch-job.ts      ← NEW 배치 잡
│
packages/memento-server/
└── src/server/routes/
    └── admin.routes.ts                               ← MODIFY: /consolidation/run 추가
```

**수정되는 기존 파일:**
- `packages/memento-core/src/shared/types/memory.types.ts` — `isConsolidated` 필드 추가
- `packages/memento-core/src/infrastructure/database/database/schema.sql` — 동기화
- `packages/memento-core/src/infrastructure/scheduler/batch-scheduler.ts` — 신규 잡 등록
- `packages/memento-core/src/bootstrap.ts` — 신규 서비스 주입

**저장소 이중 트리 주의:** 구현·테스트·CI의 정본은 `packages/memento-core/src/`이다. 루트 `src/`는 과거 미러로 남아 있을 수 있으므로 변경 시 패키지와 동기화하거나 후속 이슈로 제거·단일화할 것.

## Implementation Phases

---

### Phase A: DB 스키마 + 타입 기반 작업

**목표**: 마이그레이션 + 타입 추가. 다른 모든 단계의 선행 조건.

**작업:**
1. `025-memory-item-is-consolidated.ts` 작성 및 마이그레이션 러너 등록
2. `026-flip-consolidation-relation-directions.ts` — 업그레이드 DB의 `extracted_from`/`supported_by` 엣지 방향을 data-model과 일치하도록 보정(레거시 행만 스왑)
3. `schema.sql`에 `is_consolidated` 컬럼 + 인덱스 동기화
4. `MemoryItem` 등 공유 타입에 `isConsolidated` 반영(선택 필드 가능)
5. `ConsolidationRepository` / `initializeDatabase` 등 실제 조회 경로에서 매핑

**테스트**: 마이그레이션 적용 후 `npm run db:check-migration` 통과

**완료 기준**: `npm run type-check` 통과, migration 적용 성공

---

### Phase B: Clustering Service

**목표**: 에피소딕 기억을 임베딩 유사도 기반으로 클러스터링하는 순수 함수형 서비스

**작업:**
1. `clustering-service.ts` 작성
   - `memory_embedding` 조회 → 코사인 유사도 행렬 계산
   - greedy threshold 클러스터링 (기본 임계값 0.75)
   - `owner_id` 단위 격리, `is_consolidated=FALSE` && `pinned=FALSE` 필터
   - 최소 클러스터 크기(기본 5) 미달 그룹 제외
2. `consolidation-repository.ts` 작성
   - 클러스터링 대상 에피소딕 조회 쿼리
   - `is_consolidated` + `importance` 업데이트 쿼리

**테스트** (`clustering-service.spec.ts`):
- 유사한 에피소딕 10개 → 1개 클러스터 생성
- `is_consolidated=TRUE` 항목 제외 확인
- `pinned=TRUE` 항목 제외 확인
- 임계값 미달 그룹(5개 미만) 건너뜀 확인
- 서로 다른 owner_id 항목 분리 확인

**완료 기준**: clustering-service.spec.ts 전체 통과

---

### Phase C: Summarization Service

**목표**: 클러스터에서 시맨틱 기억 콘텐츠를 생성하는 서비스 (LLM + extractive fallback)

**작업:**
1. `summarization-service.ts` 작성
   - LLM API 키 설정 여부 확인 (OPENAI_API_KEY → OpenAI, GEMINI_API_KEY → Gemini)
   - LLM 가용 시: 클러스터 에피소딕 내용 요약 프롬프트 생성 및 호출
   - LLM 불가 시: `importance` 최고 에피소딕 content 그대로 반환 (extractive fallback)

**테스트** (`summarization-service.spec.ts`):
- LLM 없는 환경에서 extractive fallback 동작 확인
- LLM mock 환경에서 요약 생성 확인

**완료 기준**: summarization-service.spec.ts 전체 통과

---

### Phase D: Sleep Consolidation Service (오케스트레이터)

**목표**: Phase B, C를 조합하는 메인 서비스. FR-001~FR-009의 핵심 로직.

**작업:**
1. `sleep-consolidation-service.ts` 작성
   - 전체 플로우 오케스트레이션:
     1. 클러스터링 → 2. 시맨틱 저장 → 3. memory_relation(`extracted_from`) 저장 → 4. 에피소딕 마킹
   - 클러스터별 독립 처리, 실패 시 해당 클러스터만 건너뜀 (FR-009)
   - `SleepConsolidationRunResult` 반환
2. `consolidation/index.ts` 작성 (도메인 공개 API)

**테스트** (`sleep-consolidation-service.spec.ts`):
- 정상 플로우: 에피소딕 → 시맨틱 생성 + memory_relation 생성 + is_consolidated 마킹
- 시맨틱 저장 실패 시 에피소딕 마킹 없음 (FR-003 순서 보장 / 자기수복)
- 클러스터 처리 실패 시 다음 클러스터 계속 처리 (FR-009)
- 핀된 기억 변경 없음 (FR-005)

**완료 기준**: sleep-consolidation-service.spec.ts 전체 통과

---

### Phase E: 배치 잡 + 스케줄러 통합

**목표**: 오프라인 배치로 자동 실행 (FR-004, FR-006, FR-008)

**작업:**
1. `sleep-consolidation-batch-job.ts` 작성
   - `BatchScheduler`에 등록 가능한 잡 인터페이스 구현
   - 기본 스케줄: 24시간 간격 (환경변수 `SLEEP_CONSOLIDATION_INTERVAL_MS` 설정 가능)
   - FileLogger로 구조화 로그 기록 (FR-008)
2. `batch-scheduler.ts` 수정: 신규 잡 등록
3. `bootstrap.ts` 수정: SleepConsolidationService 주입

**테스트** (`sleep-consolidation-batch-job.spec.ts`):
- 잡 실행 시 SleepConsolidationService 호출 확인
- 로그 기록 확인

**완료 기준**: 배치 잡 spec 통과, 스케줄러 통합 확인

---

### Phase F: Admin API 엔드포인트

**목표**: 수동 실행 지원 (FR-010), `contracts/admin-api.md` 계약 준수

**작업:**
1. `admin.routes.ts` 수정: `POST /admin/consolidation/run` 추가
   - 동시 실행 방지 (409 응답)
   - `dryRun`, `ownerIdFilter` 파라미터 지원
   - `SleepConsolidationRunResult` JSON 응답

**테스트**: `admin.routes.spec.ts`에 `POST /admin/consolidation/run` 응답 스펙(`contracts/admin-api.md`) 검증, dryRun 파라미터 동작, 동시 실행 409 응답 테스트 작성 (T029)

**완료 기준**: T029 admin routes 스펙 테스트 전체 통과, 엔드포인트 응답이 `contracts/admin-api.md` 계약과 일치

---

### Phase G: 시나리오 테스트 + 성능 검증

**목표**: SC-001~SC-005 검증

**작업:**
1. `src/test/test-sleep-consolidation.ts` 시나리오 테스트 작성
   - SC-001: 동일 주제 에피소딕 10개 → consolidation 후 recall 결과 에피소딕 수 40% 감소 검증
   - SC-002: consolidation 실행 중 recall 레이턴시 10% 이내 검증
   - SC-004: 에피소딕 500개 기준 120초 이내 완료 검증
   - SC-005: 핀된 기억 변경 없음 검증

**완료 기준**: `npm run test:search` 유사 패턴으로 시나리오 통과

---

## Quality Gates (각 Phase 완료 후)

```bash
npm run lint -- --fix
npm run type-check
npm test
```

Phase A~G 전체 완료 후 최종 확인:
```bash
npm run build
npm run test:search   # 기존 검색 품질 회귀 없음 확인
```

## Dependency Chain

```
Phase A (스키마/타입)
  → Phase B (클러스터링)
  → Phase C (요약)
    → Phase D (오케스트레이터) ← B + C 동시 선행 필요
      → Phase E (배치)
      → Phase F (Admin API)
        → Phase G (시나리오)
```

## Risk & Mitigation

| 리스크 | 완화 방법 |
|-------|---------|
| 대용량(500개+) 클러스터링 시 성능 | 청크 단위 처리, `owner_id`별 분할 |
| LLM API 오류 | extractive fallback + 클러스터 단위 건너뜀 |
| FTS5 트리거 부하 (시맨틱 다수 생성 시) | 배치 내 트랜잭션 최적화 |
| `ConsolidationScoreWorker`와 이름 혼동 | `SleepConsolidation*` prefix 일관 사용 |
