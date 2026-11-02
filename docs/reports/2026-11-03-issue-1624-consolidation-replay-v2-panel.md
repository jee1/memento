# #1624 consolidation-replay-v2 판정 합산: gold 단계에서 inconclusive

새 합성 test 가족 `consolidation-replay-v2`의 정답 계약을 두 판정자와 두 조정자로 확정했다. 사전등록, 패킷, 봉인본, 합산은 [consolidation-replay-v2](../../tests/fixtures/search-quality/consolidation-replay-v2/README.md)에 있다.

- 계약 gold 86/120, 보류 34/120. 두 조정자 모두 true이고 두 판정이 `resolved`인 시점만 gold다.
- test complete 10/35. conditional 5/7, task_noise 5/7, correction, generalization, source_preservation은 0/7이다.
- 사전등록 관문 G1(짝 16 이상, 층마다 2 이상)을 gold 단계에서 이미 못 넘는다. 산출물 패널 보류는 짝을 줄일 뿐이라 A/B/D 결과와 무관하게 결론은 **`inconclusive`** 다.
- 그래서 A, B, D arm을 실행하지 않았다. 모델 호출 0회, 운영 변경 없음.
- 보류 시점에서 조정자가 가장 많이 적은 경계는 B5(과거 회차 관찰, 64회)다. v1.1의 빈칸을 규칙으로 정했지만 불일치는 그 자리에 남았다.
- 판정과 조정은 서로 다른 모델 에이전트의 `agent_panel` 결과다. 사람 gold가 아니다.

## 결과

| 층 | 시점 gold | stage 1 | stage 2 | stage 3 | test complete | dev complete |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| conditional | 22/24 | 8/8 | 6/8 | 8/8 | 5/7 | 1/1 |
| correction | 13/24 | 8/8 | 2/8 | 3/8 | 0/7 | 1/1 |
| generalization | 15/24 | 8/8 | 0/8 | 7/8 | 0/7 | 0/1 |
| task_noise | 22/24 | 8/8 | 8/8 | 6/8 | 5/7 | 1/1 |
| source_preservation | 14/24 | 8/8 | 2/8 | 4/8 | 0/7 | 1/1 |
| 합계 | 86/120 | 40/40 | 18/40 | 28/40 | 10/35 | 4/5 |

- 조정자 true: adj-1 89, adj-2 88. 두 조정자가 갈린 시점은 5/120이다.
- 관련 근거 집합은 두 판정자가 78/120에서 같았다. gold 86건 중 69건에서 동결했고 17건은 계약 gold를 유지한 채 근거를 null로 두었다(protocol 「판정과 조정」 7). v1.1과 달리 이 분기가 실제 데이터에서 걸렸다.
- 사전 추정과 비교: protocol은 test complete 비율을 층 평균 0.667(기대 23.3/35)로 추정했다. 실제는 0.286이다. conditional과 task_noise는 추정(0.8, 0.83)에 가깝고 나머지 세 층은 0이다.

## 보류는 어디서 나왔나

아래는 조정 봉인본의 `fact_alignment` 행을 기계적으로 센 것이다. 판정 내용을 다시 판정하지 않았다.

| stage | 층 | 맞춘 행 | A만 | B만 | 갈린 탐침(adj-1/adj-2) |
| --- | --- | ---: | ---: | ---: | ---: |
| 1 | 모든 층 | 83 | 0 | 0 | 0/0 |
| 2 | correction | 24 | 0 | 4~5 | 7/10 |
| 2 | generalization | 24 | 0 | 8 | 9/16 |
| 2 | source_preservation | 27 | 2 | 3 | 14/22 |
| 3 | correction | 37~38 | 1 | 1 | 6/10 |
| 3 | source_preservation | 38~39 | 0 | 3~4 | 8/8 |

(범위는 두 조정자의 행 구성 차이다.)

- stage 1은 40시점 모두 두 계약이 같았다.
- stage 2의 보류는 대부분 **B만 필수로 둔 사실**에서 나왔다. 판정자 A가 쓰지 않은 사실을 B가 따로 요구한 경우다. 보류 시점에서 조정자가 적은 경계 ID는 B5가 가장 많다.
- generalization은 stage 2에서 0/8이었다가 stage 3에서 7/8로 돌아왔다. stage 3에서는 한쪽만 둔 행이 0이다. 원인은 모른다.

## 해석

- 결손 세 층은 B5(과거 회차 관찰을 필수 사실로 둘지)와 관찰/지시 경계에서 두 판정자의 필수 사실 범위가 갈렸다. rubric v2의 B5는 "회차가 붙은 관찰은 필수"라고 정했지만, 무엇이 회차가 붙은 관찰인지(시험 한 번의 결과, 받은 물품의 상태, 시범 하루의 결과)를 두 판정자가 다르게 읽은 것으로 보인다. 이는 경계 ID 집계와 한쪽 행 수에서 나온 추정이며 조정 사유 문장은 읽지 않았다.
- conditional과 task_noise는 v1.1(task_noise 17/18)과 비슷하게 안정적이다.
- 이 결과는 판정자 두 명, 조정자 두 명의 기술 통계다. 다른 판정자에서의 합의율이 아니다.

## 실행하지 않은 것과 이유

| 항목 | 상태 | 근거 |
| --- | --- | --- |
| A, B arm test 실행 | 미실행 | G1 실패로 결론이 이미 `inconclusive`. protocol "유리한 하위 집합으로 다시 계산하지 않는다", v1 "결손 층을 버린 유리한 하위 집합 실험을 시작하지 않는다". 실행하면 complete 10시퀀스가 시스템 결과에 노출돼 이후 판본의 held-out으로 쓸 수 없다 |
| A, B dev 실행 | 미실행 | dev는 test 실행 선택을 고정하는 용도다 |
| M1/M2 채점 | 해당 없음 | protocol상 산출물 패널(서로 다른 모델 두 명)의 일이며 구현자가 하지 않는다 |
| D arm, 하네스 dry-run | 미실행 | 등록 상한은 최대 200 logical(시퀀스당 5 × 40)이고 가족이 바뀌지 않았다. 하네스는 실행 가능한 가족이 생길 때 만든다 |
| 실행 등록(G3) | 미동결 | test를 실행하지 않는다 |

`registration.json`은 고치지 않았다. 바뀐 규칙이 없다.

## 한계

- **공급사.** adj-2(Claude Sonnet 5.5)는 판정자 B(Claude Opus 5.5)와 공급사가 같고 같은 터미널의 다른 세션이었다. adj-1(GPT-6.1-Sol high, Codex)과 adj-2는 공급사가 다르다.
- **작성자.** 등록, 입력 문장, 합산을 같은 작성자(머슴2)가 했다. 합산은 스크립트로 재현되며 판정과 조정 문장을 쓰지 않았다.
- **판정자 노출.** 판정자 두 명은 v1, v1.1에서 같은 rubric 계열을 봤다.
- **stage 2 이상치.** 관찰만 했고 원인을 확인하지 않았다.
- **판정 속도.** 판정자 제출 간격은 stage당 수 분이었다(봉인 시각). 판정 품질과의 관계는 모른다.

## 다음 결정 (마름, 사용자)

1. 결손 세 층(correction, generalization, source_preservation)을 위한 새 판본(v3)을 만들지. 만든다면 B5의 "회차가 붙은 관찰" 정의를 예제로 더 좁히는 일이 설계 입력이다.
2. 이 가족의 complete test 10시퀀스(conditional 5, task_noise 5)를 시스템 결과에 노출하지 않은 채 v3 test로 남길지, dev로 돌릴지.
3. 2026-10-31 결정("D가 낫지 않으면 B로")에 대해 이 측정은 근거를 주지 못한다. D 유지나 B 전환은 이 결과로 정하지 않는다.

## 재현

```bash
npx tsx scripts/aggregate-consolidation-replay-v2-panel.ts
npx vitest run tests/consolidation-replay-v2-fixture.spec.ts scripts/lib/consolidation-panel-decision.spec.ts
```

합산기는 조정 입력이 생성기 출력과 같은지, 봉인 SHA, 조정 기록 검사(`checkV2Adjudication`)를 확인한 뒤 계산한다. DB, 네트워크, LLM을 호출하지 않는다.
