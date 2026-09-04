# Feature Specification: memory_forgetting_event 보존 정책 및 DB 잔재 정리

**Feature Branch**: `663-810-forgetting-event-retention`
**Spec Directory**: `specs/663-810-forgetting-event-retention`
**Created**: 2026-09-03
**Status**: Ready for Planning
**Issue**: [#810](https://github.com/jee1/memento/issues/810)
**Parent Epic**: [#803](https://github.com/jee1/memento/issues/803)
**Related**: #804, #809, #814
**Input**: chore(db): memory_forgetting_event 보존 정책 및 DB 잔재 정리

## Problem Statement

프로덕션 DB에 다음 잔재·누적 문제가 있다.

| 항목 | 격리(#804) 전 | 격리(#804) 후 (2026-08-25) |
|---|---:|---:|
| `memory_forgetting_event` 행 수 | 284,537 (~54MB) | **56,574 (~12MB)** |
| semantic 중 minilm 임베딩 없음 | 746건 | #804 격리와 겹치면 자동 해소 |
| `memory_embedding` `dimensions = 0` | 4건 (마이그레이션 아티팩트) | 동일 |
| minilm 중복 벡터 | 224건 | 원인 미확인 |

`memory_forgetting_event`는 **FK가 없어** 기억 삭제 시 CASCADE로 정리되지 않는다. #804
`cleanupResidue`가 격리 ID별로 한 번 대량 정리했으나, 망각 정책 실행으로 **신규 이벤트는
계속 유입**된다. 보존 기간 없이는 다시 무한 증가한다.

**#804 교훈**: `created_at >= ?`에 ISO `T` 구분 cutoff를 넘기면 SQLite `CURRENT_TIMESTAMP`
공백 형식과 문자열 비교가 항상 거짓이 되어 **0행 삭제 후 성공 보고**한다. retention은
**ISO cutoff 문자열**(insert 경로와 동일) 또는 `datetime()`/`julianday()` 기반 비교만 허용한다.

## Goals

- `memory_forgetting_event`에 **시간 기반 보존 정책**(기본 90일)을 두고 배치 스케줄러에 연결한다.
- 운영자가 **일회성 DB 잔재 정리** CLI로 `dimensions = 0` 행·임베딩 갭·중복 벡터를
  **진단·선택적 정리**할 수 있다.
- MCP 도구 계약·검색 동작은 변경하지 않는다.

## Non-Goals

- `memory_forgetting_event` 고아 행의 **전수 일괄 삭제**(격리 러너 `#804` 범위; retention은
  **시간 창**만 담당)
- 임베딩 모델·차원·랭킹 변경
- 프로덕션 DB 파일 커밋
- 스케줄러가 자동 `VACUUM` 실행(운영자 수동 단계)

## User Scenarios & Testing *(mandatory)*

### User Story 1 - 망각 이벤트 로그가 보존 기간 내로 유지된다 (Priority: P1)

운영자는 서버가 주기적으로 90일(설정 가능)을 초과한 `memory_forgetting_event` 행을
삭제함을 확인한다. 삭제 건수·보존 일수가 구조화 로그·배치 결과에 남는다.

**Why this priority**: 이벤트 로그 무한 증가가 핵심 문제. #804 후에도 유입은 계속된다.

**Independent Test**: 보존 기간 밖/안 이벤트를 시드 DB에 넣고 배치 잡 1회 실행 후
행 수·남은 `created_at` 범위를 검증하면 통과다.

**Acceptance Scenarios**:

1. **Given** 91일 전·89일 전 이벤트가 공존, **When** retention 배치가 실행되면,
   **Then** 91일 전 행만 삭제되고 89일 전 행은 유지된다.
2. **Given** retention 배치 성공, **When** 결과를 조회하면, **Then** `retentionDays`와
   `deleted` 건수가 기록된다.
3. **Given** retention 배치 실패, **When** 서버가 계속 동작하면, **Then** recall·remember
   등 주 경로는 중단되지 않는다.

---

### User Story 2 - 운영자가 마이그레이션 잔재 임베딩 행을 제거한다 (Priority: P1)

운영자는 `memory_embedding`에서 `dimensions = 0`인 tfidf 마이그레이션 아티팩트
(`mig_emb_1`, `fix_mig_1`~`fix_mig_3`)를 안전하게 삭제하고, 검증 쿼리가 0건임을
확인한다.

**Why this priority**: 테스트/마이그레이션 잔재가 프로덕션에 섞여 vec·통계를 오염시킨다.

**Independent Test**: 아티팩트 4행 시드 → CLI `--apply` → `dimensions = 0` COUNT 0.

**Acceptance Scenarios**:

1. **Given** `dimensions = 0` 행 4건, **When** preview(기본) 실행, **Then** 삭제 대상
   ID·건수가 보고되고 DB는 변경되지 않는다.
2. **Given** 동일 상태, **When** `--apply` 실행, **Then** 해당 행이 삭제되고
   `SELECT COUNT(*) ... WHERE dimensions = 0` → 0.
3. **Given** live `memory_item`이 참조하는 정상 임베딩, **When** cleanup 실행,
   **Then** `dimensions > 0` 행은 건드리지 않는다.

---

### User Story 3 - 운영자가 임베딩 갭·중복 벡터를 진단한다 (Priority: P2)

운영자는 semantic 기억 중 minilm 임베딩이 없는 건수·ID 샘플, 동일 벡터 해시 중복
건수를 CLI 리포트로 확인한다. #804 겹침 여부를 판단할 수 있다.

**Why this priority**: 746건·224건은 원인 확인 후 조치; 무작정 삭제는 검색 회귀 위험.

**Independent Test**: 갭·중복 시드 → report JSON에 count·sample 포함, apply 없이 read-only.

**Acceptance Scenarios**:

1. **Given** semantic에 minilm 없는 기억 N건, **When** `db:residue-report` 실행,
   **Then** `missing_minilm_semantic.count === N` 및 샘플 ID(최대 20)가 출력된다.
2. **Given** 동일 embedding BLOB을 가리키는 minilm 행 2건, **When** report 실행,
   **Then** `duplicate_minilm_vectors.count >= 1` 및 대표 memory_id 쌍이 포함된다.
3. **Given** report만 실행, **When** 완료, **Then** DB 행 수는 변하지 않는다.

---

### User Story 4 - 운영자가 잔재 정리 후 공간을 회수한다 (Priority: P3)

운영자는 이벤트 retention·임베딩 잔재 삭제 **이후** `VACUUM`으로 파일 크기 감소를
측정·기록한다(#804 FR-010과 동일 순서).

**Why this priority**: VACUUM은 잠금·시간 비용; 자동화보다 운영자 명시 실행.

**Independent Test**: 삭제 후 `VACUUM` 전후 `stat` 크기 diff 기록.

**Acceptance Scenarios**:

1. **Given** 대량 DELETE 완료, **When** `npm run db:vacuum`(또는 동등 CLI) 실행,
   **Then** before/after/reclaimed 바이트가 JSON으로 출력된다.
2. **Given** VACUUM, **When** 실행, **Then** `wal_checkpoint(TRUNCATE)` 후 측정한다.

### Edge Cases

- **Retention cutoff 경계**: `created_at === cutoff` 행은 **유지**(strict `< cutoff`).
- **혼합 timestamp 형식**: 레거시 공백 구분 `created_at`도 ISO cutoff `<` 비교로
  올바르게 만료 판정(공백 < `T`이므로 더 과거로 취급).
- **빈 테이블**: retention 배치는 deleted=0, success=true.
- **동시 forget + retention**: SQLite 트랜잭션; retention DELETE는 단일 문장.
- **dimensions=0이 live memory에 연결**: apply 전 FK·memory_id 존재 검증; 연결 있으면 skip+경고.
- **중복 벡터가 서로 다른 memory_id**: report만; 자동 dedupe 금지.
- **#804 겹침**: report에 `overlaps_quarantine_candidate` 힌트(형태1 semantic 여부) 포함.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: 시스템 MUST `memory_forgetting_event.created_at`이 보존 기간(기본 **90일**,
  env `FORGETTING_EVENT_RETENTION_DAYS`) 미만인 행만 유지한다.
- **FR-002**: FR-001 삭제 MUST ISO 8601 cutoff(`new Date(now - days).toISOString()`)와
  `created_at < ?` 비교를 사용한다. shell `date -Iseconds` 문자열을 cutoff로 **금지**한다.
- **FR-003**: FR-001 MUST 배치 스케줄러 잡(`forgetting_event_cleanup_batch`)으로
  최소 1일 1회 실행 가능해야 한다.
- **FR-004**: FR-003 실패 MUST 주 서비스 경로를 중단하지 않고 structured log에 남긴다.
- **FR-005**: 운영 CLI MUST `dimensions = 0` `memory_embedding` 행 preview/apply 삭제를
  지원한다(기본 preview).
- **FR-006**: FR-005 apply MUST `dimensions = 0`인 행만 대상으로 한다.
- **FR-007**: 운영 CLI MUST semantic·minilm 임베딩 갭·minilm BLOB 중복 report를
  read-only로 제공한다.
- **FR-008**: FR-007 MUST 프로덕션 DB 절대 경로·전체 ID 목록을 공개 문서/stdout에
  무제한 덤프하지 않는다(집계·샘플·카운트).
- **FR-009**: VACUUM CLI MUST 삭제 작업과 분리되며 FR-010 순서를 문서화한다.
- **FR-010**: 공간 회수 측정 MUST retention/잔재 DELETE **후** VACUUM **전** 순서를
  따른다.

### Key Entities

- **`memory_forgetting_event`**: 망각 감사 로그(`memory_id`, `action`, `created_at` 등).
  FK 없음.
- **`memory_embedding`**: 기억별 벡터(`dimensions`, `embedding_provider`, BLOB/JSON).
- **Retention batch result**: `{ retentionDays, deleted, success }`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: retention 배치 실행 후 `created_at >= (now - retentionDays)` 범위 밖
  행이 **0건**이다.
- **SC-002**: `SELECT COUNT(*) FROM memory_embedding WHERE dimensions = 0` → **0**
  (apply 후).
- **SC-003**: report 실행 시 missing minilm semantic 건수가 이슈 baseline(746) 대비
  **문서화·설명** 가능(0 또는 #804 겹침 해소).
- **SC-004**: `npm run lint`, `npm run type-check`, 관련 테스트 통과.
- **SC-005**: MCP recall/remember 응답 계약 회귀 없음.

## Assumptions

- 보존 90일은 episodic TTL·`TELEMETRY_RETENTION_DAYS` 기본(90)과 정렬.
- #804 라이브 격리 완료(2026-08-25); 긴급도는 낮으나 정책 자체는 필요.
- 임베딩 갭 backfill은 별도 이슈; 본 스펙은 진단·`dimensions=0` 정리에 집중.

## Open Questions

| ID | Question | Status | Resolution |
|----|----------|--------|------------|
| OQ-1 | 보존 기간 | Resolved | 90일, `FORGETTING_EVENT_RETENTION_DAYS` |
| OQ-2 | cutoff 비교 방식 | Resolved | JS `toISOString()` + `created_at < ?` |
| OQ-3 | 고아 이벤트 vs 시간 retention | Resolved | 시간 retention만; 고아는 #804 경로 |
| OQ-4 | 중복 벡터 조치 | Resolved | report-only, 자동 삭제 금지 |
| OQ-5 | VACUUM 자동화 | Resolved | 운영자 CLI, 스케줄러 제외 |

## Brainstorm Log

### Session 1 — 2026-09-03 (recommended options auto-selected)

- **Retention 90d**: episodic·telemetry와 정렬; env override.
- **ISO cutoff**: #804 `date -Iseconds` 함정 회피; repository insert가 이미 ISO.
- **TelemetryCleanupBatchJob 패턴**: repository `deleteExpiredEvents` + daily interval.
- **Orphan cleanup 분리**: retention ≠ `NOT IN memory_item`; 격리는 `cleanupResidue`.
- **dimensions=0**: known migration IDs + `dimensions=0` predicate; preview default.
- **Embedding gap/duplicates**: read-only report; backfill out of scope.
- **VACUUM**: operator step after deletes; wal_checkpoint before measure.

**Open questions after session 1**: none — spec ready for plan.
