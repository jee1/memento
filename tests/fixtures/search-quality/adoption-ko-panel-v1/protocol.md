# #1545 판정 전 고정 계약

상태: 후보 60건, 정답 0건. 구현자는 입력과 rubric만 작성했다. 패킷 준비 후 멈춘다. 마름이 서로 다른 모델의 머슴4와 머슴1에게 별도로 의뢰한다. 이 문서와 manifest, split, 결과 양식은 판정자에게 배포하지 않는다. 각 판정자에게 해당 reviewer 폴더만 전달한다.

## 입력과 split

후보는 새로 작성한 한국어 합성 60개 episode/사실 계열이다. 운영 private 기억, LoCoMo, 외부 코퍼스 원문을 사용하지 않았다. 사례별 원문 두 건(120건), 질의 하나(60건), 질의 시점·scope·전체 퇴역 대상·근거 ID·본문 SHA를 제공한다. 부분 수정에서도 퇴역 대상은 기억 **전체**다. 같은 대상의 문장을 바꿔 test/dev에 나누지 않는다.

구성 목표는 명시적 변경 후보 30건과 양립/암시/부분 변경/늦은 증거/동명·다른 조건 각각 6건이다. 이는 입력 수집용 계획이다. 실제 retire/retain/ambiguous 수량이나 기대 라벨이 아니다. 구성 비율을 판정자에게 알리거나 정답을 수량에 맞추지 않는다. 장문·실제 사용자 말투·운영 빈도의 대표성은 검증하지 않았다. 범위 없는 pin 우선순위나 원본 삭제 정책을 새로 결정하지 않는다.

기존 knowledge_update 24쌍과 #1470 review-draft의 48쌍은 dev/회귀 전용이다. `pairs.json`의 구 28쌍을 승인된 48쌍으로 세지 않는다. 원본 파일 바이트 SHA와 이번 main SHA를 split/manifest에 기록했다. 기존 24개 사실 주제와 48쌍의 원문을 대조해 새 사례를 작성했다. 자동 검사는 원문 동일성·식별자 충돌을 검출한다. 의미상 누수 부재를 자동 증명하지 않는다. 합성 주제를 새로 만들었어도 문장 패턴은 반복돼 독립 동일분포 표본으로 취급하지 않는다.

현재 split은 test_candidate다. 두 판정 제출과 합의 처리 후 gold 판본을 동결해야 test가 된다. 구현자는 판정에 참여하지 않는다. 이 단계에서 결과나 gold를 보지 않는다. 향후 개별 실패를 보고 바꾼 사례는 dev로 이동하고 새 후보로 test를 보충한다. 숫자 60을 맞추려 불일치 사례를 제거하지 않는다.

## 독립 판정과 합의

각 reviewer 폴더의 packet/rubric/blank만 배포한다. 두 packet은 같은 원문과 case_id를 담고 순서만 다르다. 원문의 전체 내용과 사건/등록 시각은 가리지 않는다. 시스템 이름·arm·검색 순위·기존/예상 라벨·작성자 층은 입력에서 제외했다. 기대 결과와 rationale은 구현자가 쓰지 않았다. 프로세스상 블라인드이며 파일 접근 통제를 제공하지 않는다.

판정자는 서로의 답과 시스템 결과를 보지 않고 reviewer_id, 실제 모델/버전, UTC 시각, 입력 SHA를 적어 제출한다. 같은 모델 두 번을 서로 다른 모델 판정으로 세지 않는다. 답이 없는 건은 pending이고 gold로 집계하지 않는다. 배포한 입력/rubric/blank SHA가 달라지면 해당 제출은 이전 판본으로 남긴다.

마름이 두 제출의 label, 근거 연결, expected/forbidden 계약을 대조한다. 라벨과 계약이 모두 일치한 사례만 agent_panel gold다. 이유의 문구 차이는 근거·계약의 실질 일치 여부와 구분하되, 일치를 확정하지 못하면 ambiguous로 남긴다. 라벨만 같고 현재 값·조건 보존·금지 결과가 다르면 ambiguous다. 어느 한쪽이 ambiguous이거나 누락이면 강제 합의하지 않는다. 구현자는 tie-break를 하지 않는다. 원본 판정 두 개와 불일치 사유를 보존한다. 사람 gold나 자동 폐기 승인이라고 부르지 않는다.

case_id, event/query/recorded 시각, scope, episode/family, source/data SHA, split, rubric 판본은 입력에 있다. expected/forbidden/rationale/reviewer/model/judged_at은 제출 이후 채운다. corpus/query/gold/prompt/model/runner SHA는 결과 manifest로 연결한다. 미확정 값을 임의 작성하지 않는다. gold 파일은 아직 만들지 않는다.

## 측정 분리와 분모

평가 실행은 이 단계 범위가 아니다. 결과 양식은 네 단계를 분리한다. gold 없는 필드는 null/unmeasured로 남긴다. 서버 lifecycle의 후보 평가를 측정하며 에이전트 툴 루프나 자동 적용 경로를 추가하지 않는다.

| 단계 | 보고할 내용 | 분모·판정 계약 |
|---|---|---|
| retrieval | Recall@10, MRR@10, 관련 근거 누락, 기존 24쌍의 pair outcome(창 20) | 패널이 관련 근거를 확정한 query. 퇴역 라벨을 retrieval 정답으로 대체하지 않는다. 기존 fresh-only 포함 지표는 stale 미노출 증명이 아니다. |
| gate | retire precision, detection, false-retire, 보류/coverage | 아래 TP/FP/FN/TN과 표본 수·CI. 전체 입력의 정확도 하나로 합치지 않는다. |
| final_answer | expected 계약 충족, forbidden 주장 노출 | 현재 답/조건에 두 패널이 합의한 query 중 실제 답이 생성된 건과 누락을 별도로 보고. 근거 검색 성공으로 답 성공을 추정하지 않는다. |
| execution | 실제 성공/실패/미실행/증거 없음 | 허용된 절차 실행 증거가 있는 사례만 성공률 분모. 이 60건에는 실행 로그가 없으므로 성공률은 미측정. 문장상 절차 확정이 실행 성공은 아니다. |

gate의 gold retire를 positive, gold retain을 negative로 둔다. gold ambiguous는 이진 분모에서 제외하고 전체 60건 대비 개수/coverage를 반드시 보고한다. 시스템의 defer는 오퇴역이 아니지만 positive의 탐지 누락(FN)이다. 시스템 출력 누락/오류는 별도 건수로 보고하고 positive 탐지를 성공으로 세지 않는다. 누락을 negative로 조용히 변환하지 않는다.

- retire precision = TP / (TP + FP). 분모는 시스템이 retire한 판정 가능 사례 수다.
- detection = TP / N_positive. FN에는 시스템 retain/defer/오류/누락을 포함한다.
- 성급한 폐기율(false-retire) = FP / N_negative. 분모는 gold retain 수다. (1 − precision)과 구분한다.
- 보류율 = 시스템 defer / 전체 실행 입력. agent_panel ambiguous 비율, 실행 성공 coverage, 판정 가능 coverage도 따로 낸다.
- 각 비율에 numerator/denominator를 함께 낸다. 분모 0은 null과 사유를 보고하고 0%로 채우지 않는다.

비율의 기본 구간은 95% Wilson 양측 구간(z=1.959963984540054)으로 사전 고정한다. 중심은 (p+z²/(2n))/(1+z²/n), 반폭은 z*sqrt(p*(1-p)/n+z²/(4n²))/(1+z²/n)이다. 오류 0건의 단측 95% 정확 상한은 1−0.05^(1/n)도 별도로 보고한다. 예컨대 **판정 가능한 negative가 실제로 30건일 경우에만** FP=0의 상한은 약 9.5%다. 60건 모두를 negative 분모로 쓰거나 같은 사례 반복을 독립 n으로 세지 않는다. 합성 층화·의존·agent_panel 오류로 운영 모집단 해석이 성립하지 않을 수 있다.

전후 비교는 같은 case/family를 맞춘다. 이진 paired 결과는 discordant 사례 기반 exact McNemar, MRR/비용 차이는 family 단위 paired CI를 사용하되 runner와 반복 수를 결과 열람 전에 확정한다. 판정 계약이 바뀌거나 튜닝하면 새 실험 판본이다. 자동화 fixture 무오류를 운영 안전성이나 채택 근거 하나로 쓰지 않는다.

## 실험 전 등록과 후속 구현

`result-manifest.blank.json`의 baseline/candidate/runner SHA, prompt SHA, 실제 provider/model, 대상 case ID SHA, 반복 횟수, 허용 회귀, 임계값, 최대 호출 수를 **held-out 결과 열람 전에** 채우고 별도 바이트 SHA로 동결한다. 이 빈 양식은 완료된 사전 등록이 아니다. primary endpoint는 gate.false_retire_rate로 고정했고 나머지는 공동 보고 항목이다. 안전한 자동 적용 임계값은 이 작업이 정하지 않는다. 이후 자동 적용은 별도 사용자 결정이다.

실제 LLM 평가 호출은 이번 단계 0회다. 향후 실호출은 기존 기능과 공유하는 모델별 일일 20회 예산을 고려하고 시도별 UTC 시각/feature/provider/model/outcome을 기록한다. quota는 Google 429를 권위로 삼고 실패/429면 미룬다. 코드에 일일 cap을 새로 넣거나 provider를 몰래 전환하지 않는다.

기존 corpus/query 형식을 재사용했다. `search-quality-review-checklist.ts`는 정답을 표시하고 본문을 160자로 잘라 블라인드 도구로 사용하지 않았다. 현 strict benchmark는 snapshot/human-labeled를 요구하므로 미판정 합성 agent_panel을 억지로 strict 승인하지 않는다. gold가 생긴 뒤 기존 harness의 필요한 경계만 확장한다. 새 프레임워크는 만들지 않았다.

코드 기준 7007fe7c 대비 최신 main 6f2416d3에서 위 checklist와 pair-rank 타입 위치/동작은 동일하다. #1470은 최신 main에 merge되어 review-draft 48쌍이 존재한다. 브리프 당시 PR 대기 상태와 달라진 부분이며 후속 PR 본문에 기록한다.

현재 tracked 변경·커밋·PR은 없다. CHANGELOG/사용자 가이드/실제 harness 확장은 독립 판정 후 필요한 구현과 함께 수행한다. 이 단계의 완료는 패킷 준비이며 #1545 전체 완료가 아니다.
