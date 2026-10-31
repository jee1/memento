# 운영 recall 주간 감사 (M5 1단계, #1562)

주 5건의 private recall을 무작위 추출하고 서로 다른 모델의 머슴 2명이 독립 판정한다. 결과 출처는 `agent_panel`이다. 사람 정답, 실제 사용률, 자동 적용 승인이나 운영 안전 인증으로 부르지 않는다. `memory.search.selected`는 반환 이벤트다. feedback도 recall request_id에 연결된 사용 증거가 아니므로 정답률로 바꾸지 않는다. 클라이언트 사용 ack는 이번 범위에서 보류한다.

## 1. 모집단과 추출

1. UTC 기준 연속 7일의 `[period_start, period_end)`와 대상 client·owner·project 범위를 **결과를 보기 전에** 고정한다. 한 표본 단위는 고유 recall 요청 1건이다. 한 요청의 반환 기억 여러 개를 독립 표본으로 늘리지 않는다.
2. 허가된 기존 client 기록에서 해당 범위의 recall 요청 목록을 만든다. 성공·빈 검색·실패·fallback을 모두 포함한다. 같은 요청의 여러 telemetry 이벤트는 request_id로 중복 제거한다. 반환 이벤트만으로 모집단을 만들면 실패와 빈 검색이 빠지므로 금지한다. privacy_scope는 요청 당시 확인한 scope이며 현재 기억 행의 scope로 추정하지 않는다. 혼합·불명확한 scope나 누락이 있으면 완전한 private 모집단으로 선언하지 않는다.
3. 원문·질의·응답·owner 값은 입력 목록에 넣지 않는다. 목록에는 요청 참조 ID·요청 시각·확인한 privacy_scope만 넣는다. private 원문과 원본 참조 연결표, scope 확인 근거는 gitignored `.local/recall-audit/`에만 둔다. 아래 예시는 전부 합성이다.

```json
{
  "period_start": "2026-10-24T00:00:00.000Z",
  "period_end": "2026-10-31T00:00:00.000Z",
  "frame_complete": true,
  "requests": [
    {
      "request_id": "synthetic-request-1",
      "occurred_at": "2026-10-25T12:00:00.000Z",
      "privacy_scope": "private"
    }
  ]
}
```

`frame_complete: true`는 담당자의 완전성 확인이다. 도구가 원본 기록의 완전성을 증명하지 않는다. client 기록이 없거나 scope·기간·요청 수를 확인하지 못하면 false로 남기고 추출을 중단한다. 미측정 이유와 누락 범위를 기록한다. telemetry에는 기본적으로 질의 해시만 남고 응답 원문·반환 ID 전체·private 여부는 완전하게 남지 않는다. 해시만으로 원문이나 실제 사용을 복원하지 않는다. 이 작업 때문에 plaintext 계측을 켜거나 새 수집 서버를 추가하지 않는다.

```bash
mkdir -p .local/recall-audit/week-2026-10-24
# frame.json은 위 형식으로 허가된 기존 기록에서 작성한다.
node scripts/sample-recall-audit.mjs \
  --input .local/recall-audit/week-2026-10-24/frame.json \
  > .local/recall-audit/week-2026-10-24/sample.json
```

도구는 DB·네트워크에 접근하지 않는다. 입력·파일을 변경하지 않고 stdout으로 해시·집계만 쓴다. 필드 누락·추가 원문 필드·중복 request_id·불완전한 모집단·잘못된 UTC 시각을 거부한다. 시각 형식은 밀리초를 포함한 `YYYY-MM-DDTHH:mm:ss.sssZ`다. 입력은 JSON 하나이며 privacy_scope는 private/team/public만 받는다.

private이며 기간 안인 요청 전체를 대상으로 새 32바이트 seed와 HMAC-SHA256 순서로 비복원 5건을 뽑는다. 5건 미만이면 전부 뽑고 `shortfall`을 기록한다. 모집단 0건이면 표본 0건이다. 입력 원본 바이트와 runner SHA, seed, 기간, eligible_count, sample_count를 함께 동결한다. 판정 결과에 따라 seed를 다시 뽑거나 표본을 교체하지 않는다. 재현은 같은 파일에 `--seed <sample.json의 seed>`를 넘긴다. 입력 행 순서가 바뀌어도 선택은 같지만 frame_sha256은 달라진다.

`samples[].request_sha256`은 UTF-8 request_id의 SHA256이다. 담당자는 입력 ID를 같은 방식으로 해시해 원본 참조와 연결한다. 이 연결표와 원문은 `.local/`에만 둔다. 해시는 익명화 보장이 아니므로 추측 가능한 ID의 연결표를 공개하지 않는다. 공개 산출물은 해시와 집계만 허용하며 request_id·owner·project·판정 이유 원문을 싣지 않는다.

## 2. 오류 발견 묶음

장애·fallback·빈 검색을 보고 의도적으로 고른 사례는 별도 `error_discovery` 묶음에 기록한다. 원본 참조 해시·선정 이유·기간·판정 근거를 보존하되 무작위 표본 분모나 운영 오류율에 합치지 않는다. 무작위 추출에서 자연스럽게 나온 장애·빈 검색은 `weekly_random` 표본에 그대로 남긴다. 두 묶음에 같은 요청이 나오면 해시로 중복을 표시하고 무작위 분모에서는 한 번만 센다. 오류 발견 묶음을 5건 충원용으로 쓰지 않는다.

## 3. 블라인드 패킷과 판정 rubric

[#1545](https://github.com/jee1/memento/issues/1545)의 rubric v1과 maintainer protocol의 독립 판정·근거 연결·일치 채택·불일치 보류 계약을 재사용한다. 운영 감사 판본은 `recall-audit-v1`이다. #1545 원본 계약 경로는 `~/.claude/mseum/r1545/panel/maintainer/protocol.md`, 원본 rubric은 같은 panel의 `reviewer-a/rubric.md`다. 이 로컬 파일들은 저장소나 판정자 패킷에 통째로 복제하지 않는다.

담당자는 `.local/recall-audit/<week>/maintainer/`에 범위·모집단 확인 근거·추출 manifest·표본 연결표와 SHA를 동결한다. 구현자는 판정하지 않는다. 서로 다른 실제 모델을 쓰는 두 판정자에게 자기 reviewer 폴더만 전달한다. 판정자는 상대 답·담당자 메모·예상 라벨을 읽지 않으며 상의하지 않는다. 파일 접근 통제가 아닌 배포 절차로 블라인드를 유지한다.

각 패킷에는 다음만 담고, 두 패킷은 같은 사례·근거를 다른 순서로 제공한다.

- 요청 해시를 case_id로 사용한다. 요청 당시 query_at·질의 전체·과제 맥락·owner/project/조건·필터를 보존한다.
- 실제 반환 기억 전체와 당시 응답을 제공한다. 사건 시각(event_at)·등록 시각(recorded_at)·효력 기간과 원본 evidence_id·SHA를 연결한다. 검색 순위·점수·시스템/arm 이름·기존 판정은 가린다. 순위가 아닌 evidence_id로 근거를 찾는다.
- 당시 확인 가능한 정정·대체·삭제·권한 근거를 제공한다. 지금 원본이 바뀌었거나 요청 당시 상태를 복원하지 못하면 그 항목을 missing으로 적는다. 오늘 상태를 과거 상태로 소급하지 않는다.
- 실제 최종 답이나 실행 로그가 없으면 각각 `unmeasured`다. 기억 검색 성공을 최종 답·절차 실행 성공으로 바꾸지 않는다. 누락된 원문을 구현자가 새로 써서 채우지 않는다.

두 판정자는 실제 오늘 날짜 대신 query_at을 기준으로 다음을 따로 판정한다.

| 차원 | 라벨 | 필요한 근거 |
|---|---|---|
| `task_support` | `supported` / `unsupported` / `hold` | 반환 근거가 질의·과제의 답을 뒷받침하는지. 쓸모 없는 반환·필요 근거 누락·답할 정보가 없는 빈 검색은 이유와 함께 판단한다. 정당한 답변 보류와 누락은 구분하며 모르면 hold다. 실제로 사용했다는 판정이 아니다. |
| `currentness` | `violation` / `no_violation` / `hold` / `unmeasured` | current-only 응답인지와 확정 대체·삭제·owner-scope 계약을 query_at 기준으로 확인한다. 필요한 상태/계약이 없으면 unmeasured 또는 hold다. `no_violation`은 필요한 근거를 모두 대조한 경우에만 쓴다. |
| `final_answer` / `execution` | 근거 있는 계약 충족 여부 / `unmeasured` | 실제 답·실행 증거가 있는 경우에만 별도 기록한다. 반환 여부로 추정하지 않는다. |

공통 판정 규칙은 #1545와 같다. 같은 scope·대상·조건·유효 기간에서 직접 근거가 기억 **전체**의 주장을 확정 대체해야 전체 superseded로 본다. 일부 수정은 남은 유효 조건을 보존하고 expected/forbidden에 수정 부분을 나눈다. 제안·전언·실험을 승인으로 올리지 않는다. 오래됨·등록 순서·pin·유사도·관계 점수만으로 stale이라고 판정하지 않는다. 권한·지시 대상·효력이 불명확하면 hold와 필요한 추가 근거를 적는다.

각 제출은 reviewer_id·실제 model/version·judged_at(UTC)·rubric_version·packet_sha256과 case별 차원 라벨, expected_outcome, forbidden_outcome, rationale, evidence_refs, hold_reason을 포함한다. 판정자가 이유와 기대·금지 계약을 직접 작성한다. packet/rubric SHA가 바뀌면 이전 제출은 새 판본 판정으로 재사용하지 않는다.

담당자는 두 제출의 모델 차이·입력 SHA·사례 누락을 확인하고 차원별로 라벨과 근거·expected/forbidden 계약까지 대조한다. 모두 일치한 차원만 채택한다. 라벨만 같고 조건·현재 값·금지 결과가 다르거나 어느 한쪽이 hold면 보류한다. 누락은 pending이며 강제 합의하지 않는다. 구현자는 tie-break하지 않는다. 두 원본 제출과 불일치 사유를 private 폴더에 보존한다.

## 4. 기록과 분모

매주 모집단 범위·관측 기간·모집단 수·표본 수·부족 수와 원본/runner/패킷/rubric/제출 SHA를 기록한다. 결과 표는 묶음과 차원을 나누고 다음 필드를 채운다. 판정 전에는 채택 0, pending=표본 수이며 비율은 null이다.

| 항목 | 정의 |
|---|---|
| N | 해당 묶음의 고유 표본 요청 수. 무작위는 최대 5. |
| A | 두 판정의 라벨과 계약이 일치하여 채택한 해당 차원의 이진 판정 수. |
| H | 불일치·명시적 hold로 보류한 수. |
| P | 제출 누락·미완료 수. |
| U | 필요한 증거·current-only 계약이 없어 unmeasured인 수. |
| 대조식 | 차원별 `N = A + H + P + U`. `H/P/U`를 무오류로 세지 않는다. |
| 판정 coverage | `A / N`과 두 건수. N=0이면 null 및 사유. |
| 과제 지지 비율 | task_support에서 합의 supported 수 / A. 실제 사용률·정답률이라는 이름을 쓰지 않는다. |
| 현재성 위반 비율 | currentness에서 합의 violation 요청 수 / A. 한 요청에서 위반 ID가 여럿이어도 요청 분자는 1. 위반 종류·ID 수는 별도. |

서로 다른 차원의 A를 섞지 않는다. 비율마다 분자·분모·기간을 붙이고 A=0이면 null과 미측정 이유를 쓴다. 오류 발견 묶음은 그 묶음의 건수만 보고하며 운영 오류율이라고 부르지 않는다. 5건과 agent_panel의 오류 가능성 때문에 모집단 안전성을 주장하지 않는다. 구간을 보고할 때는 #1545 protocol의 95% Wilson 양측 구간을 쓰고, 반복 요청·연속 주차를 독립 표본으로 임의 합산하지 않는다.

공개 결과 형식은 기간, sample_origin, N/A/H/P/U, 분자/분모/비율 또는 null 사유, 판본 SHA, 요청 해시다. 판정 rationale·expected/forbidden 원문은 private 자료다. 보고서를 새로운 telemetry 저장소에 넣지 않는다.

## 5. 현재성 자동 검사의 선행 조건

현재 단계의 자동 검사 상태는 `unmeasured`, 사유는 `awaiting_1551_1552`다. 자동 검사·주기 작업·서버 계측을 추가하지 않는다. #1551의 확정 대체 근거와 #1552의 current-only 응답 계약이 생긴 뒤 다음 절차를 자동화한다.

1. 요청 당시 current-only 응답의 반환 ID 전체를 원본 응답과 연결한다. historical/all-versions 요청을 섞지 않는다.
2. query_at의 확정 superseded ID·deleted ID·호출자 owner-scope 허용 집합과 대조한다. 확정 근거 ID·판본·효력 시각을 보존한다. 일부 정정·단순히 오래된 기억은 전체 superseded 집합에 넣지 않는다.
3. 검사 가능한 요청 수를 분모로, 세 집합 중 하나라도 위반한 요청 수를 분자로 보고한다. 종류별 위반 ID 수와 교집합을 별도로 남긴다. 상태·반환 ID가 빠진 요청은 검사 불가 수로 빼고 전체 대비 coverage를 기록한다.
4. 무작위/오류 발견 묶음·agent_panel/자동 검사 결과를 나누고, 불일치와 근거 결측을 보존한다. 검사 실패가 recall 실패로 번지지 않게 후처리한다.

LLM 평가 API를 이 도구가 호출하지 않는다. 별도 실호출이 필요해지면 기존 기능과 공유하는 모델별 하루 20회 예산 안에서 시도별 UTC·feature·provider·model·outcome을 기록한다. 429면 미루며 provider를 몰래 바꾸지 않는다. 일일 cap이나 예약 시스템을 새로 구현하지 않는다.

## 검증

```bash
npx vitest run scripts/sample-recall-audit.spec.ts
```

합성 메타데이터로 5건 비복원 추출·seed 재현·기간 경계·privacy 필터·자연 발생 실패/빈 검색 포함·0건·부족 수·중복/원문/불완전 입력 거부·입력 불변을 확인한다. 실제 운영 표본·판정 품질·현재성 자동 검사는 이 테스트가 검증하지 않는다.
