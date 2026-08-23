# 코드 리뷰: 자동 triple semantic 격리 러너

**범위**: `323e9f39..b8411ca0` — `scripts/` 신규 10파일 1,738줄 · `package.json` · `.gitignore`
**일자**: 2026-08-23 · **기준**: [spec.md](./spec.md) · [contracts/runner-cli.md](./contracts/runner-cli.md) · 헌법 v1.2.0

신뢰도 80 미만 항목은 생략했다. 리뷰는 인라인 점검과 별도 리뷰 에이전트 두 경로로 수행했고,
두 경로가 독립적으로 같은 Critical 을 짚었다.

**2026-08-23 후속: 아래 항목 전부 수정 완료.** 커밋 `beeb0edc`(Critical + Suggestion),
`0c6a4a1`(I-1 · I-3). 전체 테스트 5,031건 통과.

---

## Critical

### C-1 `rehearse` 가 게이트를 전부 우회한다 (신뢰도 98)

`scripts/quarantine-pipeline-semantic.ts:157-161`

```ts
if (options.command === 'rehearse' || options.command === 'execute') {
  const db = openForWrite(dbPath);
  try {
    if (options.command === 'execute') {          // ← rehearse 는 여기 안 들어온다
      const failure = runGates(buildExecuteGates(collectGateInputs(...)));
```

`rehearse` 는 `execute` 와 **완전히 같은 파괴적 루프**를 돌면서 중단 게이트를 하나도 평가하지 않는다.
운영자가 `DB_PATH` 를 사본 B 로 바꾸는 것을 잊으면 라이브 24,113행이 **백업 확인 없이, 서버 정지
확인 없이, 확인 프롬프트 없이** 삭제된다.

토이 DB 실측으로 확인했다 — `rehearse` 는 게이트 메시지 없이 곧바로 `forget` 을 호출했다.

게이트 설계 전체가 막으려던 사고를 `rehearse` 가 옆문으로 통과시킨다. 리허설은 절차상 **라이브
실행보다 먼저** 일어나므로, 이 시점에는 백업조차 검증되지 않았을 수 있다.

**수정안**: `rehearse` 가 대상 경로를 프로덕션 DB 로 판별하면 거부한다.

```ts
// rehearse 는 사본 전용이다. 라이브를 가리키면 즉시 중단한다.
if (options.command === 'rehearse') {
  const productionPath = resolve(homedir(), '.memento/data/memory.db');
  if (realpathSync(dbPath) === productionPath) {
    throw new QuarantineGateError(12, `rehearse 는 사본 전용입니다 — DB_PATH 가 프로덕션입니다: ${dbPath}`);
  }
}
```

`MEMENTO_PRODUCTION_DB` 같은 환경 변수로 경로를 주입받게 하면 배포 환경 차이도 흡수한다.

---

## Important

### I-1 dry-run 리포트에 요구 항목 5종이 빠져 있다 (신뢰도 95)

`scripts/lib/quarantine-report.ts:31-140`

`data-model.md` §2.1 이 열거한 14개 항목 중 5개가 리포트에 없다.

| 빠진 항목 | 조항 | 영향 |
|---|---|---|
| importance 구간 분포 | FR-003 | `importanceBuckets` 를 **import 만 하고 호출하지 않는다** (죽은 import) |
| 코퍼스 대조 (대상 ∩ episodic·procedural = 0) | FR-004 (a) | 미구현 |
| 형태 (2) 원본 episodic 생존 여부 | FR-004c | 미구현 |
| 고아가 될 `memory_forgetting_event` 행 수 | FR-006d | `cascadeImpact` 가 `pragma_foreign_key_list` 를 쓰는데 이 테이블엔 **FK 가 없어 구조적으로 안 잡힌다** |
| 백필 버스트 구간(2026-04·05) 안/밖 분리 집계 | FR-002b | 미구현 |

**SC-003b 는 현재 통과할 수 없다** — "대상을 백필 버스트 구간 안/밖으로 나눈 재집계 건수와
구간별 형태 분포를 포함한다"를 리포트가 만족하지 않는다. SC-003c 도 구간별 분포 부분이 미충족이다.

`memory_forgetting_event` 누락은 실무적으로도 크다. 실측 225,601행(37.7MB)이 정리 대상인데
리포트가 그 규모를 보여주지 않아, 운영자가 `cleanup` 을 건너뛰고 `vacuum` 했을 때 감소량이
왜 작은지 알 수 없다(FR-010 의 순서 근거가 리포트에 드러나지 않는다).

**수정안**: `buildDryRunReport` 에 절 5개 추가 + `quarantine-targets.ts` 에 대응 함수 3개
(`corpusOverlap`, `fallbackOriginSurvival`, `orphanForgettingEvents`, `burstIntervalSplit`) 추가.

### I-2 `--yes` 플래그가 완전히 죽어 있다 (신뢰도 90)

`scripts/quarantine-pipeline-semantic.ts:44-60`

`parseOptions` 가 `yes` 를 계산하지만 **어디서도 읽지 않는다.** 계약은 `--yes` 를 "대화형 확인
생략"으로 정의하지만 **대화형 확인 자체가 구현돼 있지 않다.** 즉 `rehearse`·`cleanup`·`vacuum` 은
확인 절차 없이 곧바로 DB 를 쓴다.

계약과 구현이 어긋난 상태다. 둘 중 하나를 골라야 한다 — 확인 프롬프트를 넣거나, 계약에서
`--yes` 를 빼거나. C-1 과 묶어 판단하는 게 낫다.

### I-3 `createForgetFn` 에 테스트가 없다 (신뢰도 85)

`scripts/lib/quarantine-run.ts:44-53` · `scripts/lib/quarantine-run.spec.ts`

실제로 삭제를 일으키는 유일한 함수인데 spec 파일에 `createForgetFn` 이 **0회** 등장한다.
`parseBatchResult` 만 테스트됐고, `runQuarantine` 테스트는 전부 가짜 `forget` 함수를 쓴다.

토이 DB 스모크로 `executeTool` → `ForgetTool` 도달은 확인했으나 자동화된 회귀 방어가 없다.
`@memento/core` 의 export 표면이나 `forget` 의 반환 형태가 바뀌면 **테스트는 전부 통과하고
실행만 깨진다** — 이 저장소에서 이미 한 번 밟은 함정이다(vitest 는 `src`, tsx 는 `dist`).

**수정안**: 최소 스키마 DB 에 `createForgetFn` 을 실제로 태우는 통합 테스트 1건. `memory_item_tag`·
`memory_link`·`feedback_event`·`memory_forgetting_event`·`event_outbox` 를 픽스처에 추가하면 된다
(토이 DB 실험에서 이들이 없어 실패했다).

---

## Suggestion

### S-1 `vacuumAndMeasure` 가 WAL 사이드카를 세지 않는다 (신뢰도 85)

`scripts/lib/quarantine-run.ts:180-188`

`statSync(dbPath).size` 만 재므로 `-wal` 이 빠진다. 현재 라이브 `-wal` 은 2.6MB 로 작지만,
24,113건 삭제 직후에는 커질 수 있다. SC-007 의 감소량이 실제와 어긋날 수 있다.
`-wal`·`-shm` 을 합산하거나 측정 전에 `PRAGMA wal_checkpoint(TRUNCATE)` 를 걸면 된다.

### S-2 러너가 소요 시간을 재지 않는다 (신뢰도 85)

SC-007a("리허설 소요 시간이 실측으로 기록되고")를 운영자가 `time` 으로 감싸야만 만족한다.
`runQuarantine` 이 `elapsedMs` 를 반환하고 진행 기록에 남기면 서버 정지 창구 산정의 근거가
사람 손을 안 타게 된다.

### S-3 종료 코드 `1` 을 게이트성 실패에 재사용한다 (신뢰도 85)

`quarantine-report.ts:26` · `quarantine-pipeline-semantic.ts:191`

계약은 `1` 을 "예기치 못한 오류"로 예약했는데, 산출물 경로 위반과 `QUARANTINE_STARTED_AT` 누락에
쓰고 있다. 둘 다 명확한 사전 조건 위반이므로 10~21 대역의 새 코드를 주는 편이 원인 식별에 낫다.

### S-4 게이트 평가 순서가 계약과 어긋난다 (신뢰도 82)

`quarantine-pipeline-semantic.ts:105-110`

`collectGateInputs` 가 `QUARANTINE_EXPECTED_TARGETS` 누락 시 게이트 1~9 를 평가하기 **전에**
코드 19 로 던진다. 계약은 "순서대로 평가"를 규정한다. 서버가 켜져 있는데도(게이트 3, 코드 12)
운영자는 19(재집계 편차)를 보게 되어 원인을 오인할 수 있다.

### S-5 게이트 1 은 도달 불가능하다 (신뢰도 90)

`quarantine-gates.ts:97-98`

`main` 이 이미 `assertAbsoluteDbPath` 로 던지므로 `buildExecuteGates` 의 게이트 1 은 항상
`true` 다. 해롭진 않지만 계약 문서와 코드 중 한쪽이 거짓말을 하고 있다.

### S-6 쓰기 연결에 `busy_timeout` 이 없다 (신뢰도 80)

`quarantine-gates.ts:36-44`

`execute` 는 게이트 3 이 서버 정지를 요구하지만 `rehearse`·`cleanup`·`vacuum` 에는 그 게이트가
없다. 다른 프로세스가 붙어 있으면 `SQLITE_BUSY` 로 즉시 실패한다. `PRAGMA busy_timeout = 5000`
정도면 산발 실패가 진행 기록을 덮는 일을 줄인다.

---

## 통과 확인된 항목

| 요구 | 확인 방법 | 결과 |
|---|---|---|
| SC-004 dry-run 무변경 | 라이브 `report`+`export-relations` 실행 전후 타입별 건수 diff, 파일 크기 | **통과** (551,211,008 불변) |
| FR-005 삭제는 `forget` 만 | `DELETE FROM memory_item` 전수 grep | **통과** (0건) |
| FR-002i `LIKE` 금지 | `quarantine-targets.ts` 의 `LIKE` 사용처 3곳 검토 | **통과** (교차검증용 이스케이프 LIKE 1곳, 리터럴 패턴 1곳) |
| FR-006 FK 확인 | `openForWrite` 가 설정 후 되읽어 검증 | **통과** |
| FR-006f 정리 범위 | `cleanupResidue` 가 ID 목록으로만 삭제 | **통과** (`NOT IN` 미사용) |
| FR-006b 산출물 경로 | `resolveOutDir` + `.gitignore` 이중 방어 | **통과** |
| FR-009 절대 경로 | 상대·`~`·미설정 3케이스 테스트 | **통과** |
| 게이트 종료 코드 매핑 | 12종 파라미터화 테스트 + 실측(코드 12, 삭제 0건) | **통과** |
| FR-005b 재개 | 판별식 재평가 + 영구 실패 건너뛰기 | **통과** (단위 테스트) |
| 헌법 I Test-First | 전 커밋 RED→GREEN 순서 | **통과** |
| 헌법 IV 품질 게이트 | lint 0 errors · type-check · 5,012 테스트 · 파일 크기 최대 278줄 | **통과** |
| 헌법 IV graphify | `packages/` 무변경 | **비적용** |

---

## 리뷰 에이전트가 추가로 잡은 것 (인라인 점검이 놓침)

### A-1 `event_outbox` 정리가 항상 0행을 지우고 성공한다 (신뢰도 95) — **Critical 급**

`scripts/lib/quarantine-run.ts` (수정 전)

```sql
DELETE FROM event_outbox WHERE event_type = 'memory.forgotten' AND created_at >= ?
```

`event_outbox.created_at` 은 `EventOutboxService.enqueue` 의 INSERT 컬럼 목록에 **없어**
`DEFAULT CURRENT_TIMESTAMP` 를 탄다 → `'2026-08-23 12:00:00'` (공백 구분).
운영자가 넘기는 `date -Iseconds` 는 `'2026-08-23T12:52:08+09:00'` (T 구분).
공백(0x20) < `T`(0x54) 이므로 **문자열 비교가 언제나 거짓**이다.

라이브에서 실측 확인했다:

```
sqlite> SELECT '2026-08-23 12:00:00' >= '2026-08-23T12:52:08+09:00';
0
```

`QUARANTINE_STARTED_AT` 을 fail-closed 로 강제한 앞선 수정이 **바로 이 실패를 막으려던 것인데,
같은 실패가 형식 불일치라는 다른 옷을 입고 그대로 남아 있었다.** SC-005a 는 "정리 후 0행"을
요구하므로 검증조차 통과했을 것이다 — 애초에 적재된 적이 없으니까.

**수정**: 시간 범위를 버리고 `target_uri` 의 ID 접미사 등호 비교로 교체.
`target_uri` 는 `memento://<owner>/memory/<id>` 형태라 ID 가 항상 맨 뒤다.
`LIKE` 를 쓰지 않는 이유는 판별식과 같다 — ID 에 `_` 가 들어 있다.
`QUARANTINE_STARTED_AT` 요구도 함께 제거했다(더 이상 입력이 아니다).

### A-2 `rehearse` 와 `execute --resume` 이 진행 기록을 공유한다 (신뢰도 90)

같은 `--out` 으로 리허설 후 `execute --resume` 하면 `readDeletedIds` 가 리허설 ID 까지 세어
`alreadyDeleted` 를 과대계산한다. `expected` 가 0 이하로 내려가면 편차가 고정돼 게이트 10 이 오발한다.

**수정**: 진행 기록을 `<command>.progress.jsonl` 로 분리. `cleanup` 은 `execute.progress.jsonl` 만 읽는다.

### A-3 `--sample-size -1` 이 표본을 전수로 부풀린다 (신뢰도 85)

SQLite 에서 `LIMIT -1` 은 "제한 없음"이다. `batchSize` 에는 범위 검증이 있는데 `sampleSize` 에는
없었다. 리포트에 기억 본문 24,113건이 통째로 실릴 수 있었다.

**수정**: `parseOptions` 에 `sampleSize < 1` 검사 추가.

### A-4 게이트 2(`foreignKeysOn`)도 도달 불가능하다 (신뢰도 85)

`openForWrite` 가 이미 확인하고 코드 11 로 던지므로 `collectGateInputs` 시점엔 항상 1이다.
S-5(게이트 1)와 같은 계열. **미수정** — 계약 문서의 12종과 1:1 대응을 유지하는 편이
읽는 사람에게 낫다고 판단했다. 집행점이 다른 곳이라는 주석만 남겼다.

---

## 수정 중 새로 드러난 사실

### `event_outbox` 는 기본적으로 꺼져 있다

`isEventOutboxEnabled()` 는 `MEMENTO_EVENT_OUTBOX_ENABLED === 'true'` 일 때만 참이고
**기본값은 off** 다(`event-outbox-service.ts:40-42`). 라이브 `event_outbox` 가 0행인 것이
이것으로 설명된다.

따라서 **FR-009a 는 이 플래그가 켜진 배포에서만 의미가 있다.** 꺼진 상태에서 `cleanup` 이
`outbox 0행` 을 보고하는 것은 정상이며 실패가 아니다. 통합 테스트는 플래그를 켜고 돌려
실제 적재→정리 경로를 검증한다.

### 폴백 급증이 실시간으로 관측된다

리포트를 2시간 간격으로 두 번 돌린 결과 `subject` 보유 semantic 이 24,233 → 24,251 (+18),
그중 형태 (2) 가 120 → 138 (**+18, 신규분 전량**). FR-001c 의 11.6% 추세가 현재 진행형이다.
FR-001b 의 제외 근거(비중이 작다)는 이 속도면 오래 못 간다.

---

## 수정 후 리포트 실측 (2026-08-23)

| 새 절 | 값 |
|---|---|
| importance 구간 | 0.8~1.0 **8,615** · 0.6~0.8 6,472 · 0.0~0.2 6,414 · 0.4~0.6 2,562 · 0.2~0.4 50 |
| 백필 버스트 구간 | 안 20,965(전량 형태 1) · 밖 3,286(형태 1 3,148 / 형태 2 138) |
| 코퍼스 대조 | 대상 24,113 · episodic 3,458 · procedural 249 · **교집합 0** |
| 형태 (2) 원본 생존 | **137/138**, 원본 없는 1건 `mem_1783174053795_wo8uu343w` |
| `memory_forgetting_event` 고아 | **225,601행** (이제 연쇄 영향 표에 등장) |

형태 (2) 가 전량 버스트 구간 밖이라는 FR-002c 의 실측이 재확인됐다.
