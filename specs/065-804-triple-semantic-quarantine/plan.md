# Implementation Plan: 자동 triple semantic 격리

**Branch**: `jee1/chore-memory-triple-semantic-23-664-dry-run` | **Date**: 2026-08-22 | **Spec**: [spec.md](./spec.md)
**Issue**: [#804](https://github.com/jee1/memento/issues/804) | **Parent Epic**: [#803](https://github.com/jee1/memento/issues/803)

## Summary

라이브 DB에서 triple 추출 파이프라인이 만든 **템플릿 문장 semantic 24,086건**을 기존 `forget`
도구로 격리한다. 판별식·절차·중단 게이트는 spec의 「실행 절차 요약」에 확정돼 있고, 이 계획은
**그것을 어떤 코드로 실행할지**를 정한다.

핵심 구조는 **사본 2개 리허설**이다. 백업(사본 A)을 뜨고 그것을 복제(사본 B)해 전량 격리를 먼저
돌린다. 리허설이 소요 시간·연쇄 정리·회수량·재개 동작을 모두 검증하고, before/after 프로브도
사본에서 수행해 라이브를 오염시키지 않는다. 전부 통과해야 라이브를 건드린다.

## Technical Context

**Language/Version**: TypeScript (ES modules), Node.js ≥24
**Primary Dependencies**: `better-sqlite3`, `sqlite-vec`, 기존 `@memento/core`의 `ForgetTool`
**Storage**: SQLite (`~/.memento/data/memory.db`, 548MB, WAL 모드)
**Testing**: Vitest
**Target Platform**: 로컬 운영자 CLI (Linux)
**Project Type**: 운영 스크립트 — `scripts/` 아래 일회성 러너, `packages/` 동작 불변
**Performance Goals**: 없음. 소요 시간은 목표가 아니라 **리허설로 측정할 값**(FR-006c)
**Constraints**: 프로덕션 DB 파괴적 작업. 정지 구간은 재집계~`VACUUM`으로 한정(FR-008b)
**Scale/Scope**: 대상 24,086건, 연쇄 삭제 `memory_relation` 54,742 · `memory_embedding` 24,086 ·
`memory_review_candidate` 3,609 · `meta_memory_stats` 66 · `feedback_event` 10

미해결 항목 없음 — spec의 32회차 브레인스토밍이 실측으로 해소했다. 유일한 미지수인 **실행
소요 시간**은 설계로 정할 수 없고 사본 B 리허설이 산출한다.

## Constitution Check

헌법 v1.2.0 기준. *GATE: Phase 0 이전 통과, Phase 1 이후 재확인.*

| 원칙 | 상태 | 근거 |
|---|---|---|
| I. Test-First Delivery | **PASS** | 러너는 신규 코드이므로 Red-Green-Refactor 적용. 판별식 SQL·형태 분류·재개 로직에 실패 테스트를 먼저 쓴다(T-단계 참조). 구조적 리팩터링 예외에 해당하지 않는다 |
| II. Backward Compatibility | **PASS** | MCP 도구 계약 불변. `ForgetTool`을 호출만 하고 수정하지 않는다 |
| III. Schema and Migration | **PASS** | 스키마 변경 없음. 마이그레이션 파일 불필요 |
| IV. Quality Gates | **PASS** | `lint`·`type-check`·`test` 통과 후 완료. **graphify는 적용 대상이 아니다** — 산출물이 `scripts/` 러너와 문서뿐이고 `packages/` 아래 동작을 바꾸지 않는다(spec Assumptions) |
| V. Observability | **PASS** | dry-run 리포트·진행 기록·관계 내보내기가 관측 산출물이다. 실패 시 배치 단위로 기록하고 재개 가능(FR-005b) |
| Runtime / workspaces | **PASS** | Node 24+, npm workspaces 유지 |
| 코퍼스 라이선스 (Additional Constraints) | **PASS** | 기억 본문 산출물은 `.local/` 한정, 공개 문서엔 집계만(FR-006b). 헌법의 재배포 불가 코퍼스 규칙과 같은 계열 |

**Complexity Tracking**: 해당 없음(게이트 위반 없음).

## Architecture

```text
scripts/quarantine-pipeline-semantic.ts          # 러너 (신규, 유일한 코드 산출물)
  ├─ resolveTargets(db)                          # FR-001·002i 판별식 → ID 목록
  ├─ classifyForm(db)                            # FR-002f·002g 형태 (1)(2)(3) 전수 집계
  ├─ verifyNoFalsePositive(db)                   # FR-002j 전수 검증 (2방식 교차)
  ├─ reportDryRun(db)                            # FR-003·001c·001d·004·004d·006a·006d
  ├─ exportRelations(db)                         # FR-006i 관계 내보내기
  ├─ runQuarantine(db, ids)                      # FR-005 forget 반복 + FR-005b 진행 기록
  ├─ cleanupResidue(db, startedAt)               # FR-009a outbox + FR-006d forgetting_event
  └─ vacuumAndMeasure(db)                        # FR-010

기존 코드 (수정 없음)
  executeTool('forget', { batch, hard:true, confirm:true }, { db, services:{} })
    └─ toolRegistry → ForgetTool.handle(...)
  FK ON DELETE CASCADE + memory_embedding_vec_delete + memory_item_fts_delete
```

**`forget` 호출 방식** (FR-005d 결정): `@memento/core`가 공개 export하는 **`executeTool`**을 쓴다.
`ForgetTool` 클래스는 공개 API가 아니다 — 루트 배럴이 재export하지 않고 패키지 `exports` 맵에도
그 경로가 없어, `tsx` 실행 시 `@memento/core`가 `dist/`로 해석되면 직접 인스턴스화가 런타임에
깨진다. `executeTool`은 레지스트리를 거쳐 같은 `ForgetTool`에 도달하므로 "삭제는 `forget`이
수행한다"는 제약은 그대로다.

`ToolContext`는 `services`의 모든 항목이 optional이라 `{ db, services: {} }`로 충분하다.
`createToolContext`는 완전한 `ServerServices`를 요구하므로 쓰지 않는다. `cleanupRelatedData`가
`embeddingService?.isAvailable()`로 optional chaining을 쓰고, 그 경로는 어차피 `rowid`에 TEXT를
넘겨 0행을 지우는 no-op이다 — 실제 연쇄 정리는 FK cascade와 트리거가 수행한다(spec 24회차 실측).

**DB는 `initializeDatabase`로 열지 않는다.** 그 함수는 마이그레이션과 스키마 보정을 실행하므로
호출만으로 라이브에 쓴다. 읽기 전용 명령은 `readonly: true`로, 쓰기 명령은 일반 연결 +
`PRAGMA foreign_keys = ON` 확인으로 연다(research 확인 6).

MCP 서버를 띄우지 않으므로 FR-008a("러너 외 쓰기 프로세스 없음")와 충돌하지 않는다. 다만
**사본 프로브(before/after)는 서버가 필요하다**(`memory_injection`이 MCP 도구) — FR-003d대로
`DB_PATH`를 사본으로 지정한 별도 인스턴스를 쓴다.

## Module boundaries

| 모듈 | 역할 | 관련 조항 |
|---|---|---|
| `scripts/quarantine-pipeline-semantic.ts` | 러너 본체. 삭제·연쇄 로직 **재구현 금지** | FR-005 |
| `packages/memento-core` `ForgetTool` | 실제 삭제. **수정 없음** | FR-005, FR-005d |
| SQLite FK·트리거 | 연쇄 정리 | FR-006, FR-006e |
| `npm run db:backup` | 사본 A 생성 | FR-007 |
| `npm run db:pre-docker-deploy` | 무결성 점검 | FR-008 |
| `.local/quarantine-065/` | 리포트·진행 기록·내보내기 | FR-006b |

## Data flow

```text
[서버 ON]
  db:backup ──────────────► 사본 A (= 백업 = 롤백 근거)
  cp 사본 A ──────────────► 사본 B
  사본 A + 서버 ──────────► before.json      (FR-003a 3)
  사본 B + 러너 ──────────► 전량 리허설       (FR-006c: 소요·회수량·재개)
  사본 B + 서버 ──────────► after.json       (FR-003a 5)
  ── 게이트 8종 전부 통과? ──► No → 중단 (라이브 삭제 0건)
[서버 정지]                                   (FR-008b)
  재집계 ±5% ─────────────► FR-004b
  exportRelations ────────► relations.jsonl  (FR-006i)
  runQuarantine ──────────► forget × 241배치 (FR-005)
  cleanupResidue ─────────► outbox + forgetting_event
  vacuumAndMeasure ───────► 크기 기록
[서버 재기동]                                 (FR-008c)
```

## Phases

### Phase 0 — 조사

`research.md` 참조. spec이 plan으로 넘긴 유일한 항목(FR-005d 호출 방식)과, 러너가 의존하는
기존 도구·제약의 확인 결과를 담는다.

### Phase 1 — 설계 산출물

- `data-model.md` — 스키마 변경은 없으므로 **산출물 스키마**(dry-run 리포트·진행 기록·관계
  내보내기·전후 프로브 기록)와 대상/제외 집합의 정의를 담는다
- `contracts/runner-cli.md` — 러너의 CLI 계약(하위 명령·플래그·종료 코드·중단 게이트 매핑)
- `quickstart.md` — 운영자 실행 절차

### Phase 2 — 작업 분해

`/speckit.tasks`가 생성한다. 이 명령의 범위 밖이다.

## Project Structure

```text
specs/065-804-triple-semantic-quarantine/
├── spec.md              # 1,294줄, FR 70 / SC 26 / Edge Cases 28
├── plan.md              # 이 파일
├── research.md          # Phase 0
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
├── contracts/
│   └── runner-cli.md
└── checklists/
    └── requirements.md

scripts/
└── quarantine-pipeline-semantic.ts     # 유일한 코드 산출물

.local/quarantine-065/                  # 커밋 금지 (FR-006b)
├── dry-run-report.md
├── relations.jsonl
├── progress.jsonl
├── before.json
└── after.json
```

## 재확인 (Phase 1 이후)

Constitution Check 재평가: 설계가 `scripts/` 러너 하나와 문서로 국한되고 `packages/` 아래를
건드리지 않으므로 **게이트 판정 불변**. graphify는 여전히 비적용, Test-First는 러너에 적용된다.
