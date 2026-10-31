# relation-ko-panel-v1 판정 전 계약 (#1555 1단계)

상태: **후보 75건(질의), 정답 0건(agent_panel 미실행)**. 합성만 사용. 운영 기억 원문·private 데이터 없음.

## 출처

운영 관계 **유형 비율·연결 깊이 모양**만 참고했다. nightly 백업에서 relation_type 집계 숫자만 읽었고 content/summary 등 텍스트 컬럼은 SELECT 하지 않았다. 본 코퍼스 문장은 전부 새로 쓴 한국어 합성이다.

## 라벨링

정답은 구현자가 확정하지 않는다. 서로 다른 모델 reviewer 2명이 rubric만 보고 각 질의의 **정답 기억 id 목록**을 독립 제출한다. 불일치는 보류(ambiguous)로 남긴다. agent_panel은 사람 gold가 아니다.

## 크기

질의 유형별 25 / 25 / 25 (single_fact / multi_hop / irrelevant_trap). 코퍼스 178건, 관계 205건.

## 누수 방지

`split.json` SHA256(판정 전 봉인): `2582d083f8975dd26a9eb041367d875be8eb292f481d04d81e38cb36a5f8bf43`

dev 25건, held_out 50건. BFS·탐색 깊이·confidence 컷 등 **하이퍼파라미터 선택은 dev만** 사용한다. held_out 은 agent_panel gold 동결 후 2단계 측정.

`generator-key.json` SHA256(판정 전 봉인): `0f66ebe30bca4ea30052911643ab6e5e8b9ace1432988d2fdaed87545fd1f493`

블라인드 판정 패킷 SHA256(corpus + relations(note 제외) + queries에서 category/split/cluster_id 제외): `6bd3e09f9ac2b42752c0b244e63fdcf477a7962f1a0f09a0e750cfdefa32d094`

## 1차 agent_panel 판정본 폐기

2026-11-01 PR #1579 머슴3 리뷰: multi_hop 25건 전부 hop_ans 본문에 장소명·「최종 규격」 계열 어휘가 남아 관계 없이 본문 검색만으로 정답 도달 가능했다(2~3 hop 필수 계약 위반). 머슴4·머슴5 75/75 일치본(커밋 8c846644)과 ground-truth·panel-result·reviewer 제출은 폐기했다. 이전 블라인드 패킷 SHA256: `cf614cce0a837d93aa5061566115f101cd3eeb615143d9c04387c289733a508d`. 마름이 새 패킷으로 재판정 예정.

## 함정

owner scope 밖 기억(`owner_rkpanel_foreign`), status deleted/superseded 정점을 그래프에 포함했다. 정답 목록에 유출 0이어야 한다(#1555 완료 기준).

## 한계

합성 그래프는 운영 34k 관계를 대표하지 못한다. 유형 비율은 근사 스케일링이다. 운영 검색 품질을 단정하지 않는다.
