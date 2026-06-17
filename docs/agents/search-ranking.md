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
