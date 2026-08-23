# 계약: 격리 러너 CLI

**Plan**: [../plan.md](../plan.md) | **Date**: 2026-08-22

`scripts/quarantine-pipeline-semantic.ts`의 외부 계약. 이 작업이 노출하는 유일한 인터페이스다
(MCP 도구·HTTP 엔드포인트를 추가하지 않는다).

## 호출

```bash
DB_PATH=/absolute/path/to/memory.db \
  npm run memory:quarantine-065 -- <command> [flags]
```

npm script 를 쓰는 이유는 그것이 `npm run build -w @memento/core` 를 선행하기 때문이다.
`@memento/core` 는 실행 시 패키지 `exports` 맵을 거쳐 `dist/` 로 해석되므로, 빌드가 낡으면
`executeTool` 이 없다.

`DB_PATH`는 **절대 경로여야 한다**. `~`는 확장되지 않으므로 상대 경로나 `~` 포함 시 즉시
종료한다(FR-009).

## 하위 명령

| 명령 | 쓰기 | 설명 | 조항 |
|---|---|---|---|
| `report` | 없음 | dry-run 리포트 생성. 대상 DB를 읽기만 한다 | FR-003, SC-004 |
| `export-relations` | 없음 | `relations.jsonl` 생성 | FR-006i |
| `rehearse` | 사본 B | 전량 격리 + 소요·회수량·재개 검증 | FR-006c, SC-008b |
| `execute` | 대상 DB | 라이브 격리. 게이트 전부 통과해야 진행 | FR-005 |
| `cleanup` | 대상 DB | `event_outbox` + `memory_forgetting_event` 잔재 정리 | FR-009a, FR-006d |
| `vacuum` | 대상 DB | 공간 회수 + 전후 크기 기록 | FR-010 |

`execute`는 내부적으로 `report`의 게이트를 재평가한 뒤에만 삭제를 시작한다.

## 플래그

| 플래그 | 기본 | 설명 |
|---|---|---|
| `--out <dir>` | `.local/quarantine-065` | 산출물 경로. 저장소 안이면 `.local/` 아래여야 한다 (FR-006b) |
| `--batch-size <n>` | `100` | `forget`의 상한. 100을 넘길 수 없다 |
| `--sample-size <n>` | `50` | 표본 A 크기 (FR-002d) |
| `--drift-tolerance <pct>` | `5` | 재집계 허용 편차 (FR-004b) |
| `--resume` | off | 중단 지점부터 재개. 판별식 재평가로 남은 대상만 처리 (FR-005b) |
| (`--yes` 는 폐지) | — | 대화형 확인이 구현된 적이 없어 죽은 플래그였다. 보호는 중단 게이트가 한다 |

### 필수 환경 변수 (파괴적 명령)

| 변수 | 쓰는 명령 | 없으면 |
|---|---|---|
| `QUARANTINE_EXPECTED_TARGETS` | `execute` | 종료 코드 19 — 재집계 대조를 건너뛸 수 없다 |
| (`QUARANTINE_STARTED_AT` 은 폐지) | — | outbox 정리가 시간 범위 대신 격리 ID 로 대상을 고른다. `execute.progress.jsonl` 이 유일한 입력이다 |
| `QUARANTINE_SERVER_STOPPED`·`_INTEGRITY_OK`·`_BACKUP_OK`·`_BACKUP_RATIO`·`_BACKUP_SIDECARS_CLEAN`·`_COPY_A_BOOTED`·`_REHEARSAL_OK` | `execute` | 해당 게이트 실패 (코드 12~16) |

전부 fail-closed 다. 확인하지 않은 항목에 `1` 을 넣으면 게이트가 장식이 된다.

`QUARANTINE_BACKUP_SIDECARS_CLEAN` 의 뜻은 **백업(사본 A)의 `-wal` 이 없거나 0바이트**다.
sidecar 의 *존재* 가 아니다 — 읽기 전용으로 한 번만 열어도 `-wal`·`-shm` 은 생긴다.
확인은 `test ! -s "<사본 A 경로>-wal"` 로 한다(성공 = clean). `-shm` 은 판정에 쓰지 않는다.

### `rehearse` 는 사본 전용이다

`rehearse` 는 `execute` 와 같은 파괴적 루프를 돌지만 **중단 게이트를 평가하지 않는다.**
따라서 대상 경로가 프로덕션이면 종료 코드 12 로 거부한다. 프로덕션 경로는
`MEMENTO_PRODUCTION_DB` 로 덮어쓸 수 있고, 기본값은 `~/.memento/data/memory.db` 다.
심링크·상대 표기 우회를 막으려고 `realpath` 로 비교한다.

### 진행 기록 파일

명령별로 분리한다 — `execute.progress.jsonl` · `rehearse.progress.jsonl`.
공유하면 `execute --resume` 이 리허설 삭제분까지 세어 편차 게이트가 오발한다.

### 종료 코드 추가

| 코드 | 뜻 |
|---:|---|
| 23 | 산출물 경로가 저장소 안 `.local/` 밖 |

## 중단 게이트

`execute`는 아래를 순서대로 평가하고 **하나라도 실패하면 삭제를 0건 수행한 채 비영점 코드로
종료한다**.

| # | 게이트 | 조항 | 종료 코드 |
|---:|---|---|---:|
| 1 | `DB_PATH`가 절대 경로 | FR-009 | 10 |
| 2 | `PRAGMA foreign_keys = ON` | FR-006 | 11 |
| 3 | 러너 외 쓰기 프로세스 없음 (서버 정지 확인) | FR-008a | 12 |
| 4 | `npm run db:pre-docker-deploy` 통과 | FR-008 | 13 |
| 5 | 백업 존재 + 크기 대조 + 백업 `-wal` 비어 있음 | FR-007c | 14 |
| 6 | 사본 A 구동 검증 통과 | FR-007b | 15 |
| 7 | 사본 B 리허설 통과 | FR-006g | 16 |
| 8 | 오탐 전수 검증 0건 | FR-002j | 17 |
| 9 | `kg_triple` 보존율 100% | SC-004a | 18 |
| 10 | 재집계 편차 ≤ `--drift-tolerance` | FR-004b | 19 |
| 11 | `relations.jsonl` 존재 | FR-006i | 20 |
| 12 | `before.json` 존재 | FR-003a | 21 |

종료 코드 `0` = 성공, `1` = 예기치 못한 오류, `10~21` = 위 게이트 실패.

## 출력 계약

- **stdout**: 진행 상황과 집계. 기억 본문을 절대 쓰지 않는다.
- **stderr**: 경고·오류.
- **파일**: `--out` 아래에만 쓴다. 표본과 리포트에 본문이 포함되므로 저장소 안이면 `.local/`
  하위여야 하며 커밋되지 않는다(FR-006b, SC-007b).

## 불변식

1. `report`·`export-relations`는 **어떤 행도 변경하지 않는다**(SC-004).
2. 삭제는 `ForgetTool`만 수행한다. 러너는 `DELETE FROM memory_item`을 직접 실행하지 않는다
   (FR-005).
3. 격리 대상이 아닌 기억은 건수·내용·recall 메타데이터가 불변이다(FR-011).
4. 중단 후 `--resume` 재실행은 남은 대상만 처리하고, 최종 잔여가 0건이어야 한다(SC-006a).
