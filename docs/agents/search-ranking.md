# 검색 랭킹 공식

검색 결과 정렬 가중치 (`config/ranking-weights.toml`):

```
S = α·relevance + β·recency + γ·importance + δ·usage + ζ·relation_weight + ζ_fb·(feedback_norm − 0.5) − ε·duplication_penalty
```

| 계수 | 값 |
|------|-----|
| α (relevance) | 0.45 |
| β (recency) | 0.20 |
| γ (importance) | 0.20 |
| δ (usage) | 0.10 |
| ζ (relation_weight) | 0.15 |
| ζ_fb (feedback) | 0.05 |
| ε (duplication) | 0.10 |

튜닝: [recall-performance-tuning.md](../guides/ko/recall-performance-tuning.md)

## 런타임 가중치 재로드 (Issue #667)

`ζ`(relation_weight) 등 랭킹 계수는 `config/ranking-weights.toml`에서 읽습니다. 코드 배포 없이 TOML만 바꾸려면:

1. `MEMENTO_RANKING_WEIGHTS_PATH` 환경 변수로 TOML 절대 경로 지정 (미설정 시 `config/ranking-weights.toml`)
2. 파일 수정 후 **Memento 프로세스 재시작** — 가중치는 프로세스 기동 시 캐시되며, hot reload는 지원하지 않습니다

관계 MCP 도구·타입 표준: [relation-graph-api.md](../api/ko/relation-graph-api.md) · GitHub [#657](https://github.com/jee1/memento/issues/657)
