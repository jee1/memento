# 수면 통합 재생 rubric v1.1 (#1574)

상태: **rubric 사전등록, 판정 패킷 준비, agent_panel 미판정(gold 0), 시스템 미실행.**

`consolidation-replay-v1`의 작업 잡음 6시퀀스와 원본 보존 6시퀀스를 경계를 명시한 rubric으로 다시 판정받는 별도 판본이다. 세 시점 전체 36건이다. 원문, 시각, 질의는 v1과 같고 ID만 새로 붙였다. 12시퀀스 모두 dev이며 새 held-out test가 아니다. v1 자산은 바꾸지 않았다.

| 파일 | 역할 |
| --- | --- |
| [protocol.md](protocol.md) | 범위, 경계 B1~B4와 기본 금지 주장 DF1~DF5, 계약 동등성 탐침, 판정/조정 절차, 알려진 노출 한계 |
| [rubric.md](rubric.md) | 판정자 지침. v1 rubric 문단 그대로 + v1.1 경계와 가상 작업 예제 |
| [registration.json](registration.json) | 패킷 생성 전 protocol/rubric SHA, 시각, base commit, 작성자 열람 범위 |
| `reviewer-a/`, `reviewer-b/` | 시점별 `packet.json`, `rubric.md`, `answers.blank.json`. 시퀀스 순서만 다르다 |
| [id-map.json](id-map.json) | v1.1 ID와 v1 ID, v1 층/split 대응. **판정자 배포 금지** |
| [manifest.json](manifest.json) | 생성 파일과 원천의 SHA, seed, 배포 순서. **판정자 배포 금지** |

배포는 v1과 같다. 마름이 각 판정자에게 자기 reviewer의 stage-1 폴더 파일 3개만 주고, 두 제출을 봉인한 뒤 stage-2, 같은 절차 뒤 stage-3을 준다. 판정자는 새 세션에서 기억 검색과 파일 검색 없이 받은 파일만 읽는다. 원문이 v1과 같아 저장소의 v1 봉인본을 원문으로 찾을 수 있으므로 블라인드는 배포 절차에 의존한다.

재생성과 검증:

```bash
npx tsx scripts/build-consolidation-replay-v11-panel.ts
npx vitest run tests/consolidation-replay-v11-fixture.spec.ts
```

검증은 생성기 출력과 커밋된 바이트의 일치, 등록 SHA, v1 rubric 문단 보존, 12시퀀스/36시점과 층 구성, 시점 prefix와 원문 동일성, v1 ID와 층/split 이름의 비노출, 빈 양식 상태를 확인한다. DB, 네트워크, LLM을 호출하지 않으며 판정의 의미나 운영 안전성을 증명하지 않는다.
