# benchmark-v3 macro_category 정의

`tests/fixtures/search-quality/benchmark-v3` 의 26개 질의는 네 개의 macro_category 로 묶여
`npm run quality -- benchmark category-report` 의 게이트(`MRR >= 0.5`) 단위가 됩니다. 매핑은
`category-mapping.json` 이 micro-category 를 통해 관리합니다.

| macro_category | micro-category | 재는 것 |
|---|---|---|
| `incident_ops` | `incident`, `operations` | 장애·운영 기억의 내용 검색 |
| `procedural` | `procedure`, `procedural`, `database`, `build` | 절차·실행 순서 검색 |
| `conceptual` | `search`, `memory`, `anchor`, `embedding`, `relation`, `security`, `forgetting` | 개념 설명 검색 |
| `tag_filter` | `config`, `dev`, `resilience`, `testing` | 태그성 좁은 주제 검색 |

## `incident_ops` 는 왜 recency 를 재지 않나 (#1074)

이 범주는 `episodic_recent` 라는 이름이었습니다. 그 이름은 recency 가 이 범주의 정당한 랭킹
신호라는 전제를 담고 있었지만, 측정해 보면 그 전제는 이 픽스처에서 성립할 수 없습니다.

**첫째, 질의에 시간 의도가 없습니다.** 네 질의 중 「최근」을 묻는 것이 하나도 없습니다.

- q_001 `HTTP 서버 에러 처리`
- q_005 `Memento MCP 서버는 어떻게 실행하나`
- q_012 `로그 및 모니터링`
- q_031 `docker 컨테이너가 readonly database 로 죽은 원인`

시간을 묻지 않은 질의의 정답에 recency 부양을 주면 그것은 측정이 아니라 인공물입니다.

**둘째, 정적 픽스처는 움직이는 시계에 대해 recency 를 인코딩할 수 없습니다.** recency 는
`exp(-ln2 · ageDays / halfLife)` 이고 episodic 의 halfLife 는 30일입니다. 코퍼스에서 가장
최근 문서(2026-03-18)조차 6 반감기 넘게 지났으므로 감쇠가 이미 바닥입니다. 시드된 3,461건의
`β·recency` 실측 범위는 이렇습니다.

| type | β·recency 범위 | 건수 |
|---|---|---|
| `episodic` | 0.000046 ~ 0.002695 | 2,180 |
| `semantic` | 0.049555 ~ 0.097879 | 1,110 |
| `procedural` | 0.012286 ~ 0.041461 | 151 |

episodic 안에서 코퍼스의 날짜 범위 176일 전체가 기여 폭 **0.0026** 으로 뭉갭니다. 날짜를
어떻게 배치하든 이 폭 안에서는 아무것도 구분되지 않습니다. 표에서 보듯 `β·recency` 의 실제
분산은 날짜가 아니라 **type** 이 만듭니다.

**셋째, 예전 숫자는 이 부양이 만든 것이었습니다.** #973 이전 합성 문서 21건은 `created_at` 이
전부 `2026-09-11` 이었고, 이는 당시 기준 9일 전이라 `β·recency ≈ 0.162` 를 받았습니다. 실제
문서의 0.0026 대비 **62배** 입니다. 이 범주 4개 질의 중 3개가 합성 정답이라 그 부양이 그대로
지표가 됐습니다.

그래서 이 범주는 `incident_ops` 로 이름을 바꿨고, **내용 검색만** 잽니다.

## recency 를 재려면 무엇이 필요한가

이 범주를 고치는 것으로는 안 됩니다. 새 범주가 필요합니다.

1. **시간 의도가 있는 질의.** 「최근에 무슨 장애가 있었나」처럼 질의 자체가 최신성을 요구해야
   합니다.
2. **내용이 같고 날짜만 다른 쌍.** 그래야 recency 를 끄고 켤 때 지표가 움직입니다.
3. **시드 시점 기준 상대 날짜.** 고정 타임스탬프는 시간이 지나면 전부 반감기 바닥으로
   내려가므로, `created_at` 을 시드 시각에서 역산해야 합니다.
4. **episodic 반감기(30일) 안쪽의 날짜.** 그 밖이면 어떤 배치도 0.003 폭 안에서 뭉갭니다.

## 남은 0 을 기록한다

`incident_ops` 는 개명 시점에도 게이트를 통과하지 못합니다. 0 자체는 실패가 아니라 측정값이며,
그 원인은 이 범주의 픽스처가 아니라 랭킹 쪽에 있습니다. #1079(BM25 시그모이드 포화)를 고친
뒤 MRR 은 0.0000 에서 0.1375 로 올라갔고, importance 항의 과대 가중이 남은 절반입니다.
