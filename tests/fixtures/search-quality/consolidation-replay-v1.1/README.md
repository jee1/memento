# 수면 통합 재생 rubric v1.1 (#1574)

상태: **agent_panel 계약 gold 23건, 보류 13건 동결. dev 재주석, 시스템 미실행.** 결과와 해석은 [보고서](../../../../docs/reports/2026-11-02-issue-1574-rubric-v11.md).

`consolidation-replay-v1`의 작업 잡음 6시퀀스와 원본 보존 6시퀀스를 경계를 명시한 rubric으로 다시 판정받는 별도 판본이다. 세 시점 전체 36건이다. 원문, 시각, 질의는 v1과 같고 ID만 새로 붙였다. 12시퀀스 모두 dev이며 새 held-out test가 아니다. v1 자산은 바꾸지 않았다.

| 파일 | 역할 |
| --- | --- |
| [protocol.md](protocol.md) | 범위, 경계 B1~B4와 기본 금지 주장 DF1~DF5, 계약 동등성 탐침, 판정/조정 절차, 알려진 노출 한계 |
| [rubric.md](rubric.md) | 판정자 지침. v1 rubric 문단 그대로 + v1.1 경계와 가상 작업 예제 |
| [registration.json](registration.json) | 패킷 생성 전 protocol/rubric SHA, 시각, base commit, 작성자 열람 범위 |
| `reviewer-a/`, `reviewer-b/` | 시점별 `packet.json`, `rubric.md`, `answers.blank.json`. 시퀀스 순서만 다르다 |
| [id-map.json](id-map.json) | v1.1 ID와 v1 ID, v1 층/split 대응. **판정자 배포 금지** |
| [manifest.json](manifest.json) | 생성 파일과 원천의 SHA, seed, 배포 순서. **판정자 배포 금지** |

판정과 조정 뒤 자산:

| 파일 | 역할 |
| --- | --- |
| `adjudication/stage{1,2,3}-{a,b}-answers.sealed.json` | 원 판정 6건 봉인본 |
| `adjudication/input/` | 조정 입력(시점 36건 패킷 원문, A/B 원 계약, rubric, 동등성 검사 발췌, 빈 양식) |
| `adjudication/adj-{1,2}.sealed.json` | 조정 봉인본 2건 |
| `adjudication/seals/`, `adjudication/source-pins.json` | 입력, 제출, 조정 SHA |
| [panel-result.json](panel-result.json) | 합산 결과. 두 조정자 모두 true인 시점만 gold, 관련 근거는 두 원 판정자 집합이 같을 때만 동결, v1 대비 상태 |

`registration.json`과 `manifest.json`은 패킷 배포 당시 바이트 그대로다.

배포는 v1과 같다. 마름이 각 판정자에게 자기 reviewer의 stage-1 폴더 파일 3개만 주고, 두 제출을 봉인한 뒤 stage-2, 같은 절차 뒤 stage-3을 준다. 판정자는 새 세션에서 기억 검색과 파일 검색 없이 받은 파일만 읽는다. 원문이 v1과 같아 저장소의 v1 봉인본을 원문으로 찾을 수 있으므로 블라인드는 배포 절차에 의존한다.

재생성과 검증:

```bash
npx tsx scripts/build-consolidation-replay-v11-panel.ts
npx tsx scripts/build-consolidation-replay-v11-adjudication.ts
npx tsx scripts/aggregate-consolidation-replay-v11-panel.ts
npx vitest run tests/consolidation-replay-v11-fixture.spec.ts
```

검증은 생성기 출력과 커밋된 바이트의 일치, 등록 SHA, v1 rubric 문단 보존, 12시퀀스/36시점과 층 구성, 시점 prefix와 원문 동일성, v1 ID와 층/split 이름의 비노출, 빈 양식 상태를 확인한다. DB, 네트워크, LLM을 호출하지 않으며 판정의 의미나 운영 안전성을 증명하지 않는다.
