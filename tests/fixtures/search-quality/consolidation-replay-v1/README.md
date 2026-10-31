# 수면 통합 재생 입력 v1 (#1553)

상태: **agent_panel 계약 gold 58건·보류 32건 동결. complete test 10/25로 inconclusive. A/B/D 실행 0회.**

서로 다른 owner의 새 합성 시퀀스 30개다. 각 시퀀스는 episodic 원본 6건과 관찰 수 2·4·6에서의 질의 세 개를 가진다. 조건부 사실·정정·일반화·작업 잡음/과제 전환·원본 보존 층마다 dev 1개/test 후보 5개다. 판정 전의 90개 질의와 구현자 후보를 확정 정답으로 쓰지 않는다. 기존 `adoption-ko-panel-v1`을 그대로 보존하며 그 문장을 복제하지 않았다.

| 파일 | 역할 |
| --- | --- |
| [protocol.md](protocol.md) | 표본·검출 한계·A/B/D·예산·분모·노출·실패·중단·후속 판정의 사전 계약 |
| [design-registration.json](design-registration.json) | 입력 생성 코드 전에 작성한 설계 시각/초기 SHA와 배포 전 개정 이력 |
| [design-check.json](design-check.json) | test 25개일 때 이상적 80% 검출 효과 약 34.05%p 계산; 운영 power 보장 아님 |
| [sequences.json](sequences.json) | 180개 새 합성 원본·scope·시각·본문 SHA·90개 시점 질의 |
| [split.json](split.json) | family 전체로 나눈 dev/test 후보와 시나리오 층; 판정자에게 비공개 |
| [author-candidates.json](author-candidates.json) | 구현자의 시점별 후보 사실/금지 주장; **gold 아님·배포 금지** |
| [execution-registration.blank.json](execution-registration.blank.json) | 패널 합산 후 별도 동결할 실행 등록 빈 양식; null로 실행 금지 |
| [manifest.json](manifest.json) | 입력·설계·패킷·빈 양식의 바이트 SHA와 이전 대조 판본 연결 |

`reviewer-a/`와 `reviewer-b/`는 입력 순서만 다른 패킷이다. 각 reviewer의 stage-1/2/3 폴더에는 해당 시점의 `packet.json`, `rubric.md`, `answers.blank.json`만 담는다. 사건 순서는 바꾸지 않으며 앞선 시점에 뒤의 원본을 넣지 않는다. 판정자는 사실/조건·금지 주장·근거를 직접 작성한다. 후보 정답·층·split·시스템 출력은 패킷에 없다. 디렉터리 분리는 접근 통제가 아니다.

마름은 두 모델에 **각자의 stage-1 폴더만** 전달한다. 각 stage의 원 제출·SHA를 봉인한 뒤 다음 stage만 전달한다. reviewer 전체 폴더를 한 번에 주면 미래 관찰이 보인다. 판정 불일치/누락은 보류하며 구현자 후보로 중재하지 않는다. 모델/버전·시각·입력 SHA를 제출에 적는다. 최종 독립 판정 180건은 두 판정자의 90건씩이며, 표본 n은 여전히 최대 test 25시퀀스다.

이번 패킷은 정답 계약만 판정한다. 원본 약화·429 등 배치 실행 계약은 추후 임시 DB의 반증 검사로 검증한다. 입력이 재통합 기회를 제공하더라도 실제 MiniLM/Jev 군집·Gemini merge 성공은 아직 미측정이다. 실행 후 별도 블라인드 산출물 판정도 필요하다. 원문 근거 충분성을 최종 답 정확도나 절차 실행 성공으로 부르지 않는다.

검증:

```bash
npx vitest run tests/consolidation-replay-fixture.spec.ts tests/adoption-panel-fixture.spec.ts
```

이 검증은 SHA·시점 prefix·누수·분모·blank 상태를 확인한다. DB·네트워크·LLM을 호출하지 않으며 gold의 의미나 운영 안전성을 증명하지 않는다. 신규 runner·npm 명령·자동 적용 설정은 이 준비 단계에서 추가하지 않는다.

## 조정 후 동결 (2026-10-31)

사용자 지침에 따라 Sonnet 5.5·Opus 5.5 조정자 두 명이 모두 true인 시점만 계약 gold로 채택했다. 58/90건이며 나머지 32건은 보류다. 두 조정자는 Claude 공급사를 공유하므로 공급사 간 독립 검증이나 사람 gold가 아니다. 원 판정 두 계약을 수정 없이 참조하며 새 정답 문장을 쓰지 않았다.

- `adjudication/`: 원 판정 제출 6개·조정 봉인본 2개·조정 입력 audit·SHA 및 변경 전 프로토콜/등록/manifest.
- `panel-result.json`, `ground-truth.json`: 교집합 결과와 58개 계약의 원 제출 참조. 관련 근거 집합이 같을 때만 별도 동결.
- `coverage.json`, `split.frozen.json`: 전체 시점/시퀀스·층별 분모와 보류. complete dev 2/5, test 10/25(40%).
- `result-manifest.json`: 결과와 실행 미수행 상태의 SHA. 실행 등록의 빈 양식은 계속 null이며 실행 허가가 아니다.

작업 잡음·원본 보존 층의 complete test가 각각 0/5라 계획한 다섯 층의 채택 판단을 지지하지 못한다. 남은 10개를 모두 D 승리로 가정해도 보류 15개를 포함한 예정 25개의 paired 차이 최악 경계는 −20%p다. 실제 성능을 측정한 수치가 아니다. 숫자 최소 coverage 문턱을 사후 추가하지 않고 사전등록의 보류 경계/충분한 complete-sequence 계약에 따라 inconclusive로 멈춘다. B 전환·D 불필요성의 근거로 쓰지 않는다.

오프라인 재현:

```bash
npx tsx scripts/aggregate-consolidation-replay-panel.ts
```

원래 입력·패킷·author 후보·split은 그대로이며, 이전 `gold 0` 표기는 판정 전 상태를 뜻한다. 동결 후 재배포에는 원래 reviewer 패킷만 사용하고 이 디렉터리의 gold/조정 결과는 가린다.
