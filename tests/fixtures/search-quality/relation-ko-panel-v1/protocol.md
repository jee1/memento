# relation-ko-panel-v1 계약 (#1555)

상태: **agent_panel gold 75건 동결(#1555 2단계)**. 합성만 사용. 운영 기억 원문·private 데이터 없음. `agent_panel`은 사람 gold가 아니다.

## 출처

운영 관계 **유형 비율·연결 깊이 모양**만 참고했다. nightly 백업에서 relation_type 집계 숫자만 읽었고 content/summary 등 텍스트 컬럼은 SELECT 하지 않았다. 본 코퍼스 문장은 전부 새로 쓴 한국어 합성이다.

## 라벨링

정답은 구현자가 확정하지 않는다. 서로 다른 모델 reviewer 2명이 rubric만 보고 각 질의의 **정답 기억 id 목록**을 독립 제출한다. 불일치는 보류(ambiguous)로 남긴다. agent_panel은 사람 gold가 아니다.

## 크기

질의 유형별 25 / 25 / 25 (single_fact / multi_hop / irrelevant_trap). 코퍼스 178건, 관계 230건.

## 누수 방지

`split.json` SHA256(판정 전 봉인): `2582d083f8975dd26a9eb041367d875be8eb292f481d04d81e38cb36a5f8bf43`

dev 25건, held_out 50건. BFS·탐색 깊이·confidence 컷 등 **하이퍼파라미터 선택은 dev만** 사용한다. held_out 은 agent_panel gold 동결 후 2단계 측정.

`generator-key.json`은 구현 의도 감사용이다. **판정자에게 주지 않는다.**

## 함정

owner scope 밖 기억(`owner_rkpanel_foreign`), status deleted/superseded 정점을 그래프에 포함했다. 정답 목록에 유출 0이어야 한다(#1555 완료 기준).

## agent_panel 판정 결과 (#1555 2단계)

블라인드 패킷 SHA256: `cf614cce0a837d93aa5061566115f101cd3eeb615143d9c04387c289733a508d`

| reviewer | 모델 | answers SHA256 |
|---|---|---|
| reviewer-a (머슴4) | Gemini 4 Argon (High) | `2851ba72e8d118335a55be31c6452c5505e640517939b5caa244c8fbc245d5ad` |
| reviewer-b (머슴5) | claude-sonnet-5-5 | `b7339a20da122d9e8fea778596c74a33e1628313df3cf4faef6c9d2c54877421` |

질의 75건 전원 라벨·정답 id 집합 일치. `generator-key.json`과 동일(구현 의도 감사용, 판정자 미배포). forbidden id를 정답에 선택한 건 0건. 보류(ambiguous) 0건.

유형별 gold: single_fact 25, multi_hop 25, irrelevant_trap 25. `ground-truth.json`·`panel-result.json` SHA는 `panel-result.json`의 `ground_truth_sha256`에 기록.

## 한계

합성 그래프는 운영 34k 관계를 대표하지 못한다. 유형 비율은 근사 스케일링이다. 운영 검색 품질을 단정하지 않는다.

**75/75 전원 일치는 문항 난이도가 낮았거나 rubric이 충분히 명시적이었을 가능성을 뜻한다.** 판별력·운영 대표성 증명이 아니다. held_out 50건으로 BFS·깊이·confidence 등 하이퍼파라미터를 고르지 말 것(dev 25만).
