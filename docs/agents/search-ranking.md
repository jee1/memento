# 검색 랭킹 공식

Memento의 검색 결과 정렬은 아래 가중합 공식으로 점수를 계산합니다. 가중치는 `config/ranking-weights.toml`에서 읽어 옵니다.

```
S = α·relevance + β·recency + γ·importance + δ·usage + ζ·relation_weight + ζ_fb·(feedback_norm − 0.5) − ε·duplication_penalty
```

각 계수의 기본값과 역할은 다음과 같습니다. `α`(0.45)는 검색어와의 관련성으로 가장 큰 비중을 차지합니다. `β`(0.20)는 최신성, `γ`(0.20)는 중요도, `δ`(0.10)는 사용 빈도입니다. `ζ`(0.15)는 관계 그래프에서 연결된 기억의 가중치이고, `ζ_fb`(0.05)는 사용자 피드백을 반영합니다. `ε`(0.10)은 중복 기억에 패널티를 주어 결과의 다양성을 높입니다.

검색 품질 튜닝 방법은 [recall-performance-tuning.md](../guides/ko/recall-performance-tuning.md)에서 다룹니다.

## 벡터 similarity 계약: cosine (Issue #713)

`relevance`에 들어가는 벡터 유사도는 **cosine similarity** 하나로 고정돼 있습니다. 모든 sqlite-vec 가상 테이블은 `vec0(embedding float[N] distance_metric=cosine)`로 생성되며, metric을 생략하면 sqlite-vec 기본값인 L2가 적용되어 계약이 깨집니다. 대상 테이블은 legacy 384 공용 테이블인 `memory_item_vec`과 제공자별 `memory_item_vec_{tfidf,minilm,openai,gemini,mock}`이고, 정의는 `packages/memento-core/src/infrastructure/database/database/vec-schema.ts`의 `VEC_TABLES` 하나에서만 관리합니다. `schema.sql`(신규 DB)·마이그레이션 041·`migrate.ts`가 모두 이 정의를 따릅니다.

검색 결과 매핑은 `similarity = clamp(1 − cosine_distance, 0, 1)`입니다. cosine distance는 [0, 2] 범위이므로 양의 비례 벡터는 similarity 1.0, 직교는 0, 반대 방향(distance 2)은 하한 clamp로 0이 됩니다. 앵커 slot threshold 0.8/0.6/0.4도 이 cosine similarity 기준입니다.

vec 인덱스 적재량을 점검할 때는 raw provider 행 수와 1:1로 비교하면 안 됩니다. 각 테이블의 트리거 조건(`embedding_provider` + `dimensions` + `projection_type = 'native'`, legacy 384 테이블은 `dimensions = 384`)을 그대로 쓰는 `checkVecCardinality()`를 사용하세요.

## FTS5 BM25 계약 (Issue #787)

SQLite FTS5 `rank`(기본 bm25)는 **낮을수록 더 좋은 매치**이고 값은 **음수일 수 있습니다**. 빈 쿼리·LIKE fallback SQL은 `0 as fts_rank`를 쓰므로 `0`은 BM25 없음(lexical relevance)입니다.

텍스트 후보 SQL은 `ORDER BY fts_rank ASC, m.created_at DESC LIMIT ?`입니다. `applyRanking`은 유한이고 0이 아닌 rank를 `1 / (1 + exp(rank))`로 (0, 1) relevance에 올린 뒤 기존 가중합에 넣습니다. `ftsRank > 0`만 BM25로 보거나 raw rank를 `ftsRank * 0.7`로 섞으면 음수 매치가 빠지거나 점수가 뒤집힙니다.

FTS 쿼리 combinator(짧은 AND / 토큰 5개 초과 시 앞 8개 OR)는 `search-engine-fts-query.ts`의 현재 값을 유지합니다. LoCoMo ablation 전까지 `config/ranking-weights.toml`도 재튜닝하지 않습니다.

## Hybrid fusion relevance (Issue #788)

combiner는 overlap 후보에 `textScore * textWeight + vectorScore * vectorWeight`를 넣습니다. `HybridResultRanker`의 relevance 슬롯은 이 값을 보존해야 합니다. `vectorScore || textScore`로 덮으면 벡터가 있는 순간 텍스트 증거가 사라지고, `0`도 결측으로 취급됩니다. importance/recency/usage/feedback는 가중합의 다른 항이지 relevance에 다시 넣지 않습니다. text-only·vector-only는 해당 채널 점수 × 그 채널 가중치입니다.

## 런타임 가중치 재로드 (Issue #667)

`ζ`(relation_weight) 같은 랭킹 계수는 `config/ranking-weights.toml`에서 읽히므로, 코드 배포 없이 TOML 파일만 수정해 계수를 바꿀 수 있습니다. 방법은 간단합니다. `MEMENTO_RANKING_WEIGHTS_PATH` 환경변수로 TOML 파일의 절대 경로를 지정하거나, 미설정 시에는 기본값인 `config/ranking-weights.toml`이 사용됩니다. 파일을 수정한 뒤에는 **Memento 프로세스를 재시작**해야 합니다. 가중치는 프로세스 기동 시 캐시되며 현재 hot reload는 지원하지 않습니다.

관계 MCP 도구·타입 표준은 [relation-graph-api.md](../api/ko/relation-graph-api.md)에, 관련 이슈는 GitHub [#657](https://github.com/jee1/memento/issues/657)에서 확인할 수 있습니다.
