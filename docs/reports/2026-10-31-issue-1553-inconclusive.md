# #1553 수면 통합 비교 v1 — inconclusive 종료

2026-10-31 사용자 결정에 따라 `consolidation-replay-v1`을 **inconclusive**로 닫는다. 운영 설정을 바꾸지 않고 D 현행을 유지한다. 이 결과는 D의 이득·불필요성·A/B와의 동등성이나 B 전환의 근거가 아니다. A/B/D 실행과 성능 측정은 하지 않았다.

## 동결 결과

새 합성 30시퀀스·180 episodic 관찰·90시점이다. Gemini 4 Argon high와 composer-2.5가 각 시점 계약을 독립 작성했다. 사용자 지침에 따라 Sonnet 5.5·Opus 5.5 조정자가 모두 true로 판정한 시점만 agent_panel 계약 gold로 삼았다. 조정자 둘은 Claude 공급사를 공유하므로 공급사 간 독립 검증이나 사람 gold가 아니다.

| 항목 | 동결 결과 |
| --- | ---: |
| 계약 gold / 보류 | 58 / 32 |
| 시점 1·2·3 gold | 24 / 22 / 12 (각 분모 30) |
| 세 시점 모두 확정된 dev | 2 / 5 |
| 세 시점 모두 확정된 test | 10 / 25 (40%) |
| 조건부·정정·일반화 complete test | 4/5 · 2/5 · 4/5 |
| 작업 잡음·원본 보존 complete test | 0/5 · 0/5 |
| A/B/D 실행·모델 호출 | 0 / 0 |
| 성능·최종 답·실제 절차 실행 | 미측정(null) |

보류 시점을 교체하거나 확정 시점만 모아 시퀀스 성공으로 세지 않았다. 사전등록에 숫자형 최소 coverage 문턱은 없으며 사후 문턱도 추가하지 않았다. test 60%가 보류이고 결손 두 층의 complete test가 전무하므로, 계획한 다섯 층의 채택 판단을 지지하지 못한다. 확정 10개가 모두 D의 일방 승리여도 전체 예정 25개에 대한 보류 포함 paired 차이의 최악 경계는 (10−15)/25=−20%p다. 이는 coverage 한계의 계산이며 실제 성능이 아니다. 유리한 하위 집합 실험은 시작하지 않았다.

## 자산과 재현

모두 [consolidation-replay-v1](../../tests/fixtures/search-quality/consolidation-replay-v1/README.md)에 보존했다.

| 자산 | 역할 |
| --- | --- |
| `sequences.json`, `split.json`, 시점별 reviewer 패킷 | 원문·시각·질의·split. 준비 당시 바이트 유지 |
| `protocol.md`, `design-registration.json` | 사전등록, 사용자 지정 조정 절차 변경과 같은 공급사 한계 |
| `adjudication/pre-adjudication-*` | 변경 전 프로토콜·등록·manifest |
| `adjudication/*sealed.json`, `panel-audit.json` | 원 판정 6개·조정 봉인본 2개·조정 입력과 양쪽 계약 |
| `adjudication/seals/*.sha256`, `source-pins.json` | 마름의 원 봉인 SHA 목록과 저장소 파일 대응 |
| `ground-truth.json`, `panel-result.json` | 교집합 gold와 두 원 제출의 참조. 새 정답 문장 없음 |
| `coverage.json`, `split.frozen.json` | 전체 예정 분모, 층별 coverage, 보류 ID |
| `result-manifest.json`, `manifest.json` | 결과·소스·자산 SHA와 미실행 상태 |

```bash
npx tsx scripts/aggregate-consolidation-replay-panel.ts
npx vitest run tests/consolidation-replay-fixture.spec.ts tests/adoption-panel-fixture.spec.ts
```

합산기는 오프라인 평가 도구다. 서비스·검색·배치·provider·운영 설정을 바꾸지 않는다. 입력과 봉인 SHA, 교집합 승인, 중복/누락 ID, 근거 집합, 전체 coverage를 검증한다. 이전 `adoption-ko-panel-v1`도 바꾸지 않았다.

## 불일치 원인: 입력 부족과 rubric 모호성을 구분

아래는 원문·원 판정·두 조정 기록을 대조한 해석이다. 보류를 해소하거나 v1 gold를 다시 쓰는 판정이 아니다. 모든 불일치를 두 원인이나 rubric 모호성으로 환원하지 않는다.

### 별개 작업 Y: 범위 지시는 명확하고, 필요 근거의 역할 구분은 보완 대상

[원 rubric](../../tests/fixtures/search-quality/consolidation-replay-v1/reviewer-a/stage-1/rubric.md)은 owner/project/subject에 맞는 질의를 판정하고 “무관 입력을 필요 근거로 넣지 않는다”고 명시한다. 질의도 “별개 작업을 섞지 말라”고 한다. 따라서 Y의 구체 지시를 X 답의 필수 사실로 요구한 판단을 입력의 불명확성만으로 설명하기는 어렵다.

예: `cr_02ed2463abff_t2`. [입력](../../tests/fixtures/search-quality/consolidation-replay-v1/sequences.json)의 o1/o2는 모형 J 명찰 작업 X, o3/o4는 X와 무관하다고 명시한 우편 작업 Y다. [A 제출](../../tests/fixtures/search-quality/consolidation-replay-v1/adjudication/stage2-a-answers.sealed.json)은 X만 required_facts로 두고 Y를 X에 적용하는 주장을 금지한다. [B 제출](../../tests/fixtures/search-quality/consolidation-replay-v1/adjudication/stage2-b-answers.sealed.json)은 Y의 뒷면·녹색 지시도 필수 사실에 넣고 관련 근거를 o1~o4로 넓혔다. 두 조정자 모두 “X만 답하면 A는 통과, B는 필수 사실 누락으로 실패”라며 false로 판정했다. 같은 양상은 작업 잡음 층 6시퀀스의 시점 2·3, 총 12건에 반복된다.

보완할 경계는 **X를 복구하는 필수 근거**와 **Y를 X에 잘못 적용하면 안 된다는 금지 주장 근거**의 구분이다. A도 Y를 forbidden_claims의 evidence_refs에는 쓰고 relevant_evidence_refs에는 쓰지 않았다. v1.1은 두 집합의 목적을 예제로 분리하고, 무관 작업의 상세 내용을 나열하지 않은 답을 실패로 세지 않는다고 명시해야 한다. 이는 기존 범위 지시를 검산 가능한 예제로 보강하는 제안이지 v1의 보류를 소급 true로 바꾸는 근거가 아니다.

### 원본 보존: 명시된 사실의 누락이며, 답 계약과 DB 검증의 혼동 가능성은 남음

예: `cr_668798d106b4_t3`. 입력 o6은 “원본 절차표를 함께 보존한다”고 명시한다. [A 제출](../../tests/fixtures/search-quality/consolidation-replay-v1/adjudication/stage3-a-answers.sealed.json)은 원본 절차표 보존을 필수 사실에 포함했지만 [B 제출](../../tests/fixtures/search-quality/consolidation-replay-v1/adjudication/stage3-b-answers.sealed.json)은 선행 두 단계·별표·도면 봉투만 필수로 뒀다. 두 조정자는 원본 보관을 빠뜨리거나 부정한 답의 통과 여부가 달라진다고 판정했다. 원본 보존 층의 시점 3, 총 6건에서 같은 이유로 모두 false다.

원문에 보존 지시가 없어서 생긴 모호성은 아니다. v1.1은 해당 작업의 **내용상 보존 지시를 답에서 복구하는 계약**과 **Memento DB가 원본을 물리적으로 보존·조회·복구하는 실행 검증**을 분리해야 한다. 전자는 명시된 현재 지침이면 필수 사실로 다루고, 후자는 실제 DB 반증 검사 없이는 unmeasured다. B가 둘을 혼동해 생략했는지는 제출만으로 확정하지 못한다. 그 설명은 가설로 남긴다.

### 그 밖의 경계

같은 결손 두 층의 시점 1에서도 보류 6건이 남는다. 조정자들은 대상 밖 일반화 금지 또는 실제 실행 성공 주장 금지의 누락을 다르게 해석했다. 한쪽 필수 사실의 반대가 상대 금지 주장과 동등한지, `execution_evidence=unmeasured` 메타데이터만으로 응답 속 성공 단정을 금지한 계약이 되는지도 v1.1 예제가 필요하다. 이 문제를 그대로 둔 채 위 18건만 고치면 complete-sequence 결손이 남는다.

근거는 [Sonnet 조정 봉인본](../../tests/fixtures/search-quality/consolidation-replay-v1/adjudication/adj-m5.sealed.json), [Opus 조정 봉인본](../../tests/fixtures/search-quality/consolidation-replay-v1/adjudication/adj-m2.sealed.json)의 checkpoint_id별 비교 사유다.

## 후속 범위 초안: v1.1 rubric 명확화와 결손 두 층 재주석

후속 이슈는 마름이 등록한다. 현재 PR에서 재판정·새 입력 생성·실험을 시작하지 않는다.

1. 위 네 경계(질의 범위/금지 근거, 명시적 보존/DB 검증, 일반화 금지, 실행 성공 단정)에 대해 정·오답 및 계약 동등성 예제를 먼저 사전등록한다. 입력 밖 사실이나 새 정책을 정답에 보충하지 않는다.
2. 재주석 범위는 `task_noise` 6시퀀스 + `source_preservation` 6시퀀스의 **세 시점 전체 36건**(기존 dev 2/test 후보 10시퀀스)이다. 시점 2·3의 공통 불일치 18건만 선택하거나 gold 회복을 목표로 정하지 않는다. 나머지 세 층은 이번 초안 범위 밖이다.
3. 기존 v1 원문·gold·보류·split·SHA는 그대로 보존한다. v1.1은 새 판본과 이전 ID 매핑을 만든다. 사전등록의 “결과 후 입력/계약 수정 시 dev 이동”을 따라 재주석 12시퀀스는 rubric 개발/검증용으로만 취급한다. 이미 본 사례를 새 held-out test로 주장하지 않는다. 결손 층의 독립 채택 실험이 필요하면 새 가족의 합성 test와 표본 근거를 별도로 사전등록한다.
4. 서로 다른 모델 두 명을 마름이 배정한다. 새 격리 세션에 이전 답·조정 결과·구현자 후보·시스템 출력·split을 주지 않고 stage 순차 배포·봉인을 지킨다. 동등성 조정도 사전 절차와 모델 한계를 고정하며 둘 모두 true인 경우만 인정한다. 불일치는 계속 보류한다.
5. 완료 기준은 36건의 원 판단·SHA·일치/보류와 전체 시퀀스/층 coverage, v1 대비 계약 변경 이유의 추적이다. 합의율 목표로 불일치를 강제 해소하지 않는다. A/B/D 실행·운영 정책 변경은 별도 사전등록과 결정으로 남긴다.
