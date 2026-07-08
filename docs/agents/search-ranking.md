# 검색 랭킹 공식

Memento의 검색 결과 정렬은 아래 가중합 공식으로 점수를 계산합니다. 가중치는 `config/ranking-weights.toml`에서 읽어 옵니다.

```
S = α·relevance + β·recency + γ·importance + δ·usage + ζ·relation_weight + ζ_fb·(feedback_norm − 0.5) − ε·duplication_penalty
```

각 계수의 기본값과 역할은 다음과 같습니다. `α`(0.45)는 검색어와의 관련성으로 가장 큰 비중을 차지합니다. `β`(0.20)는 최신성, `γ`(0.20)는 중요도, `δ`(0.10)는 사용 빈도입니다. `ζ`(0.15)는 관계 그래프에서 연결된 기억의 가중치이고, `ζ_fb`(0.05)는 사용자 피드백을 반영합니다. `ε`(0.10)은 중복 기억에 패널티를 주어 결과의 다양성을 높입니다.

검색 품질 튜닝 방법은 [recall-performance-tuning.md](../guides/ko/recall-performance-tuning.md)에서 다룹니다.

## 런타임 가중치 재로드 (Issue #667)

`ζ`(relation_weight) 같은 랭킹 계수는 `config/ranking-weights.toml`에서 읽히므로, 코드 배포 없이 TOML 파일만 수정해 계수를 바꿀 수 있습니다. 방법은 간단합니다. `MEMENTO_RANKING_WEIGHTS_PATH` 환경변수로 TOML 파일의 절대 경로를 지정하거나, 미설정 시에는 기본값인 `config/ranking-weights.toml`이 사용됩니다. 파일을 수정한 뒤에는 **Memento 프로세스를 재시작**해야 합니다. 가중치는 프로세스 기동 시 캐시되며 현재 hot reload는 지원하지 않습니다.

관계 MCP 도구·타입 표준은 [relation-graph-api.md](../api/ko/relation-graph-api.md)에, 관련 이슈는 GitHub [#657](https://github.com/jee1/memento/issues/657)에서 확인할 수 있습니다.
