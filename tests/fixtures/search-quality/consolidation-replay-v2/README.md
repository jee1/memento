# 수면 통합 재생 v2 (#1624)

상태: **agent_panel 계약 gold 86/120, test complete 10/35. 사전등록 관문 G1 미달로 `inconclusive`, A/B/D 미실행, 모델 호출 0회.** 결과와 해석은 [보고서](../../../../docs/reports/2026-11-03-issue-1624-consolidation-replay-v2-panel.md).

A(통합 없음), B(묶기만), D(현행 Gemini 요약/병합) 비교에 쓰는 새 held-out 합성 test 가족이다. 다섯 층(conditional, correction, generalization, task_noise, source_preservation)에 층당 8시퀀스(dev 1, test 7), 관찰 240건, 시점 120건이다. 설계, 크기 근거, 판정 규칙은 [protocol.md](protocol.md)에 있다.

| 파일 | 역할 |
| --- | --- |
| [protocol.md](protocol.md) | 질문, 크기와 MDE, 분할과 누수 규칙, rubric v2 요약, 판정과 조정, 지표 M1~M3, 결론 규칙, D arm 호출 예측 |
| [rubric.md](rubric.md) | 판정자 지침. v1.1 rubric 원문 + B5(과거 회차 관찰)와 `P_omit` 정의 |
| [registration.json](registration.json) | 입력 생성 전 protocol/rubric SHA, 시각, base commit, 검출력 표, 제외 subject |
| [inputs.source.json](inputs.source.json) | 손으로 쓴 합성 관찰 문장. 정답 후보가 아니다. **판정자 배포 금지** |
| `sequences.json`, `split.json` | 생성기가 붙인 ID, 시각, 해시와 층/분할. **판정자 배포 금지** |
| `reviewer-a/`, `reviewer-b/` | 시점별 `packet.json`, `rubric.md`, `answers.blank.json`. 시퀀스 순서만 다르다 |
| [manifest.json](manifest.json) | 생성 파일과 원천의 SHA, seed, 배포 순서. **판정자 배포 금지** |

판정 뒤 자산:

| 파일 | 역할 |
| --- | --- |
| `adjudication/stage{1,2,3}-{a,b}-answers.sealed.json` | 원 판정 6건 봉인본(A 머슴1 Composer 2.5, B 머슴5 Claude Opus 5.5) |
| `adjudication/seals/` | 판정 입력과 제출 SHA |
| `adjudication/input/stage-N-part-M/` | 조정 입력 묶음 6개(20시점씩): 패킷 원문과 A/B 계약, rubric, 동등성 검사, `fact_alignment`가 있는 빈 양식. 판정자는 A/B로만 나온다 |
| `adjudication/adj-{1,2}-stage-N-part-M.sealed.json`, `adjudication/seals/adj-*.sha256` | 조정 봉인본 12건(adj-1 GPT-6.1-Sol high, adj-2 Claude Sonnet 5.5) |
| [panel-result.json](panel-result.json), `adjudication/source-pins.json` | 합산 결과. gold, 관련 근거 동결, 층/split coverage, G1 gold 단계 판정 |

조정 기록은 봉인 전에 `npx tsx scripts/build-consolidation-replay-v2-adjudication.ts --check <file> --bundle <묶음>`으로 형식, fact_key 대응, 탐침 구성, `contract_agreement`와 탐침 일치를 검사한다.

구현자 정답 후보(`author-candidates.json`)는 만들지 않는다. 배포는 v1.1과 같다. 마름이 각 판정자에게 자기 reviewer의 stage-1 폴더 파일 3개만 주고, 두 제출을 봉인한 뒤 stage-2, 같은 절차 뒤 stage-3을 준다.

재생성과 검증:

```bash
npx tsx scripts/build-consolidation-replay-v2-panel.ts
npx tsx scripts/build-consolidation-replay-v2-adjudication.ts
npx tsx scripts/aggregate-consolidation-replay-v2-panel.ts
npx vitest run tests/consolidation-replay-v2-fixture.spec.ts scripts/lib/consolidation-panel-decision.spec.ts
```

검증은 생성기 출력과 커밋된 바이트의 일치, 등록 SHA, v1.1 rubric 문단 보존, 층별 8시퀀스와 dev 1/test 7, 문장 길이와 날짜와 subject 규칙, v1 관찰과의 문장/해시/20자 연속 일치 0건, v1 subject 이름과 rubric 예제 작업 미사용, 배포 파일의 층/분할 비노출, 빈 양식 상태를 확인한다. DB, 네트워크, LLM을 호출하지 않는다.
