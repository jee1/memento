# relation-ko-panel-v1 판정 전 계약 (#1555 1단계)

상태: **후보 75건(질의), 정답 0건(agent_panel 미실행)**. 합성만 사용. 운영 기억 원문·private 데이터 없음.

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

## 한계

합성 그래프는 운영 34k 관계를 대표하지 못한다. 유형 비율은 근사 스케일링이다. 운영 검색 품질을 단정하지 않는다.
