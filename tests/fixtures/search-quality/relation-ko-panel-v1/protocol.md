# relation-ko-panel-v1 계약 (#1555)

상태: **agent_panel gold 75건 동결(2차 판정, #1555 2단계)**. 합성만 사용. 운영 기억 원문·private 데이터 없음. `agent_panel`은 사람 gold가 아니다.

## 출처

운영 관계 **유형 비율·연결 깊이 모양**만 참고했다. nightly 백업에서 relation_type 집계 숫자만 읽었고 content/summary 등 텍스트 컬럼은 SELECT 하지 않았다. 본 코퍼스 문장은 전부 새로 쓴 한국어 합성이다.

## 라벨링

서로 다른 모델 reviewer 2명이 rubric만 보고 각 질의의 **정답 기억 id 목록**을 독립 제출했다. 불일치는 보류(ambiguous)로 남긴다.

## 크기

질의 유형별 25 / 25 / 25 (single_fact / multi_hop / irrelevant_trap). 코퍼스 178건, 관계 205건.

## 누수 방지

`split.json` SHA256(판정 전 봉인): `2582d083f8975dd26a9eb041367d875be8eb292f481d04d81e38cb36a5f8bf43`

`generator-key.json` SHA256(판정 전 봉인): `0f66ebe30bca4ea30052911643ab6e5e8b9ace1432988d2fdaed87545fd1f493`

dev 25건, held_out 50건. BFS·탐색 깊이·confidence 컷 등 **하이퍼파라미터 선택은 dev만** 사용한다. held_out 은 agent_panel gold 동결 후 2단계 측정.

## 1차 agent_panel 판정본 폐기

2026-11-01 PR #1579 머슴3 리뷰: multi_hop 25건 전부 hop_ans 본문에 장소명·「최종 규격」 계열 어휘가 남아 관계 없이 본문 검색만으로 정답 도달 가능했다(2~3 hop 필수 계약 위반). 머슴4·머슴5 75/75 일치본(커밋 8c846644)과 ground-truth·panel-result·reviewer 제출은 폐기했다. 블라인드 패킷 SHA256: `cf614cce0a837d93aa5061566115f101cd3eeb615143d9c04387c289733a508d`.

## 2차 agent_panel 판정 결과

블라인드 패킷 SHA256: `a5df6eac4931b578ad946cf672c85170a1ff66a58cb72a7e5f9183893d859c10`

| reviewer | 모델 | answers SHA256 |
|---|---|---|
| reviewer-a | Gemini 4 Argon (High) | `d150b75610b14b675d0609cede0d6c1df74594b60aeec4c0991edabe1c1a0418` |
| reviewer-b | claude-sonnet-5-5 | `f258b04fca03f7bd5805cae574e04a7f4b0f53c8f41abb423500c317a118bcda` |

질의 75건 전원 라벨·정답 id 집합 일치. `generator-key.json`과 동일. forbidden id를 정답에 선택한 건 0건. 보류 0건. 유형별 gold: single_fact 25, multi_hop 25, irrelevant_trap 25.

## 함정

owner scope 밖 기억(`owner_rkpanel_foreign`), status deleted/superseded 정점을 그래프에 포함했다. 정답 목록에 유출 0이어야 한다(#1555 완료 기준).

## 한계

합성 그래프는 운영 34k 관계를 대표하지 못한다. 유형 비율은 근사 스케일링이다. 운영 검색 품질을 단정하지 않는다.

**75/75 전원 일치는 문항 난이도가 낮았거나 rubric이 충분히 명시적이었을 가능성을 뜻한다.** 판별력·운영 대표성 증명이 아니다. held_out 50건으로 BFS·깊이·confidence 등 하이퍼파라미터를 고르지 말 것(dev 25만).
