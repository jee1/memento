# DB 보존 정책

`memory.db` 의 부가 테이블은 기억 본체(`memory_item`)보다 훨씬 빨리 자랍니다. 어떤 테이블을 언제까지 두는지, 누가 지우는지, 그리고 **왜 어떤 테이블은 안 지우는지**를 한곳에 적습니다. (이슈 #908)

## 보존 기간

| 테이블 | 보존 | 환경 변수 | 지우는 잡 |
|---|---|---|---|
| `memory_forgetting_event` | 90일 | `FORGETTING_EVENT_RETENTION_DAYS` | `forgetting_event_cleanup_batch` |
| `telemetry_events` | 90일 | `TELEMETRY_RETENTION_DAYS` | `telemetry_cleanup_batch` |
| `job_run` | 90일 + 잡별 성공 실행 최신 3000건 | `JOB_RUN_RETENTION_DAYS` | `job_run_cleanup_batch` |
| `quality_measurement_history` | 90일 | `QUALITY_MEASUREMENT_HISTORY_RETENTION_DAYS` | `quality_measurement_batch` 안에서 정리 |
| `audit_log` | **지우지 않습니다** | — | 없음 — [아래 이유](#audit_log-을-지우지-않는-이유) |

네 잡 모두 배치 스케줄러에 등록되어 있고, 실행 기록은 `job_run` 테이블에 남습니다.

`quality_measurement_history` 만 전용 cleanup 잡이 아니라 측정 배치 안에서 정리합니다. 이 테이블의 유일한 기록자가 그 배치이고, DELETE 한 줄 때문에 스케줄러 등록 지점을 여섯 군데 더 만들 이유가 없기 때문입니다.

## job_run 성공 실행 상한

`job_run` 은 나이만으로는 줄지 않습니다. 30초·60초 주기 하트비트 잡(`reflexion_healthcheck`·`lock_monitor`·`reflexion_cleanup`)이 하루 수천 행씩 쌓기 때문입니다. 2026-10-01 운영 DB 에서 `job_run` 161,336행 중 87% 가 이 3종의 성공·무처리 실행이었고, 테이블이 생긴 지 25일이라 90일 규칙은 한 번도 지운 적이 없었습니다(#1199).

그래서 `job_run_cleanup_batch` 는 90일 정리 뒤에 **잡마다 성공 실행을 최신 3000건만 남깁니다**(`JOB_RUN_SUCCESS_KEEP_PER_JOB`). 3000건은 30초 하트비트의 25시간 분량이고, 일 단위 잡에는 사실상 90일 규칙만 적용됩니다. 실패 실행은 이 상한으로 지우지 않습니다. `job_run_log` 는 FK `ON DELETE CASCADE` 로 함께 지워집니다.

운영 DB 사본에서 첫 정리는 1.2초에 `job_run` 161,336 → 22,349행, `job_run_log` 321,586 → 44,582행이었고, 이어서 `VACUUM` 하면 파일이 420 MB → 282 MB 로 줄었습니다. Admin status 의 `batchImpact.successRunCount`(30일 창)는 하트비트 성공 횟수가 상한만큼만 집계됩니다.

## 실행 확인

정리가 실제로 돌았는지는 `job_run` 으로 확인합니다.

```sql
SELECT job_name, COUNT(*) AS runs, SUM(success) AS ok, MAX(started_at) AS last_run
FROM job_run
WHERE job_name IN (
  'forgetting_event_cleanup_batch',
  'telemetry_cleanup_batch',
  'job_run_cleanup_batch',
  'quality_measurement_batch'
)
GROUP BY job_name;
```

**행이 많이 남아 있다고 해서 정리가 안 도는 것은 아닙니다.** 보존 기간보다 젊은 행은 지울 대상이 아닙니다. 예를 들어 2026-09-19 측정에서 `memory_forgetting_event` 는 104,177 행이었지만 90일을 넘긴 행은 0건이었고, `forgetting_event_cleanup_batch` 는 72회 실행에 72회 성공이었습니다. 잡은 정상이고 데이터가 아직 안 늙었을 뿐입니다.

## 타임스탬프 비교 주의

`quality_measurement_history.measured_at` 은 `2026-09-19T12:25:52.925Z` 형태로 저장되는데, SQLite `datetime('now', '-90 days')` 는 `2026-06-21 14:30:00` 을 돌려줍니다. 같은 날짜에서 `'T'`(0x54) 가 공백(0x20) 보다 크므로 문자열끼리 그대로 비교하면 커트오프가 어긋납니다. 프로덕션 DB 실측에서 이 차이가 **240행** 이었습니다.

그래서 정리 쿼리는 양쪽을 `datetime()` 으로 정규화합니다.

```sql
DELETE FROM quality_measurement_history
WHERE datetime(measured_at) < datetime('now', '-90 days')
```

`measured_at` 이 NULL 이거나 파싱되지 않으면 `datetime()` 이 NULL 을 돌려주므로 그 행은 지워지지 않습니다. 나이를 판정할 수 없는 행을 지우지 않는 쪽이 안전합니다.

## audit_log 을 지우지 않는 이유

`audit_log` 는 `timestamp` 컬럼이 있어 나이 기반 정리를 **짤 수는 있습니다.** 하지만 짜면 안 됩니다.

각 행은 `previous_hash` 와 `current_hash` 로 앞 행에 연결된 해시 체인입니다(`audit-hash-chain-service.ts` 의 `verify()`). 오래된 행을 지우면 그 뒤 행의 `previous_hash` 가 존재하지 않는 행을 가리키게 되어, 남은 구간 전체의 검증이 깨집니다. 2026-09-19 기준 28,914 행 중 28,913 행이 앞 행을 가리키고 있었습니다 — 끊긴 데가 없는 체인입니다.

용량이 문제가 되면 지우지 말고 **오래된 구간을 통째로보낸 뒤 체크포인트를 새로 시작하는** 방식을 설계해야 합니다. 그건 이 문서의 범위가 아니라 별도 이슈입니다.

## VACUUM

대량 삭제 뒤에는 `npm run db:vacuum` 으로 free page 를 회수합니다. 회수할 게 있는지는 먼저 확인하십시오.

```sql
PRAGMA freelist_count;
```

2026-09-19 측정에서는 이 값이 0이었습니다. 삭제가 없었으면 VACUUM 도 할 일이 없습니다.
