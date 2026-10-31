# 한국어 채택 계약 agent_panel v1 (#1545)

새로 작성한 합성 입력 60건과 근거 120건을 두 모델이 독립 판정했다. private 원문·외부 코퍼스는 포함하지 않는다. **사람 gold가 아니며 자동 폐기 승인도 아니다.**

- `candidates.json`, `corpus.jsonl`, `queries.json`: 원 입력. 모든 근거 본문은 19–71자, 사례마다 2건이다.
- `reviewer-a/`·`reviewer-b/`: 순서가 다른 원 패킷과 제출 답안. SHA를 바꾸지 않았다. 실제 모델은 Gemini 3.8 Flash (High), composer-2.5다. 두 판정자에게 자기 패킷만 배포했다(프로세스상 블라인드, 파일 접근 통제 없음).
- `rubric.md`·`protocol.md`: 판정 전에 고정한 원 계약. protocol의 «정답 0건/준비 후 중단»은 준비 시점의 상태다. 이번 합산 결과는 아래 별도 산출물에 남긴다.
- `contract-review.json`: 구현자는 정답을 쓰지 않고 현재 값·조건·금지 결과의 실질 합의만 대조했다. 비퇴역 `evidence_refs`가 한쪽에서 비어 있는 차이는 원본대로 보존한다. 새로운 퇴역 근거를 추가하지 않는다.
- `panel-result.json`: 두 원 판단과 합산 결과. 라벨 60/60 일치, 답 계약 gold 57건(퇴역 30·유지 27), 보류 3건. 보류 사례는 두 판정 모두 ambiguous이며 현재 답/금지 결과도 달라 강제 합의하지 않았다.
- `ground-truth.json`: 기존 retrieval 로더용 55건. 관련 근거 집합이 다른 5건은 교집합/합집합을 골라 정답으로 만들지 않았다. 3건은 답 계약 보류, 나머지 2건은 중복 안내·장갑 재질 사례다. 유지 기억에는 정정된 일부 주장이 남기도 하므로 문서 전체를 stale로 표시하지 않는다.
- `split.json`: 원 test_candidate 기록과 dev SHA. 기존 knowledge_update 24쌍·#1470 검토 48쌍은 dev 전용이다. `split.frozen.json`이 60개 episode/family의 test 승격과 gold 여부를 기록한다. 결과를 보고 고친 사례는 dev로 옮기고 새 test로 보충한다.
- `manifest.json`: 공개 파일 바이트 SHA와 판본. `result-manifest.json`은 gold·corpus·query·split·합산 runner SHA를 연결한다. 시스템 runner commit·prompt·provider/model·사전 등록 값은 미확정이므로 null이다. 다음 실험은 `result-manifest.blank.json`을 채워 결과 열람 전에 별도 SHA로 동결한다.

## 재현과 분모

```bash
npx tsx scripts/aggregate-adoption-panel.ts > .local/issue-1545-panel-result.json
npx vitest run scripts/__tests__/adoption-panel.spec.ts tests/adoption-panel-fixture.spec.ts
```

첫 명령의 JSON은 `panel-result.json`과 같아야 한다. 고정 fixture만 읽으며 DB·네트워크·LLM 호출·파일 쓰기를 하지 않는다. 입력/제출/패킷 SHA가 다르면 실패한다. 자유 문장의 동의 여부는 자동 추론하지 않고 해시로 연결한 수동 계약 대조를 사용한다.

라벨 일치율은 60/60, 판정 가능 coverage는 57/60, 패널 보류는 3/60이다. retrieval 계약 coverage는 55/60이다. **시스템 성능은 모두 미측정이다.** retire precision은 TP/(TP+FP), 탐지율은 TP/30, false-retire는 FP/27이며 실제 실행 전 TP·FP·관측 분모·CI를 0으로 채우지 않는다. 시스템 defer/오류/누락은 positive 탐지 실패에 포함하고, 보류율·실행 coverage는 따로 보고한다. 실행 증거는 0건이므로 실행 성공률도 null이다. 95% Wilson 구간과 오류 0건의 단측 상한은 protocol 식을 따른다. 이 60개를 독립 운영 표본으로 해석하지 않는다.

기존 `loadBenchmarkCorpus`·`loadBenchmarkQueries`·`loadBenchmarkGroundTruth`를 그대로 쓴다. `strict_ci=false`, `ground_truth_reviewed=false`, `labeling_policy=agent_panel`이므로 기존 strict 사람 gold 검사를 통과하지 않는다. 전체 query 60건 중 retrieval gold 없는 5건을 실패/무관으로 채점하지 말고, 합의한 query ID 55개로 먼저 제한한다.

## 판별력 점검과 다음 판본

| 입력 층 | 건수 | 합산 라벨 |
|---|---:|---|
| 명시 변경 | 30 | retire 30 |
| 양립 | 6 | retain 6 |
| 암시 | 6 | retain 3·ambiguous 3 |
| 부분 변경 | 6 | retain 6 |
| 늦은 증거·기간 종료 | 6 | retain 6 |
| 같은 이름·다른 조건 | 6 | retain 6 |

`difficulty-audit.json`은 **판정 후 기술 통계**다. 계획한 층은 모두 포함하지만 명시 변경 층과 retire가 완전히 겹친다. «종료/철회/변경 없음/미승인»처럼 답을 드러내는 표현이 잦고 모든 입력이 짧은 근거 2개다. rationale 문장은 동일 0건이지만 이것만으로 복사 부재·독립성·정답성을 증명하지 않는다. 100% 라벨 일치는 쉬운 셋이나 공통 모델 편향에서도 생긴다. 어려운 사례를 판별한다는 근거는 부족하다.

이번 PR은 판정받은 60건을 바꾸거나 증설하지 않는다. 후속 판본은 장문에 섞인 정정, 3회 이상 변경, 권한·유효 기간·조건이 교차하는 최소 대조쌍, 일부만 맞는 절차와 실패 실행 증거를 별도 episode/family로 새로 만든다. 시스템 결과와 기대 라벨을 감춘 채 두 모델이 먼저 독립 판정하고, 입력·rubric·분모·runner·허용 회귀·호출 예산을 동결한 뒤 실행한다. 현 실패를 보고 변형한 사례는 dev 전용으로 둔다. 새 어려운 사례에서 판별력을 확인하기 전에는 채택·자동 적용 임계값을 정하지 않는다.
