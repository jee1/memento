# relation BFS 검색 효용 측정 (#1555 3단계)

라벨: agent_panel (relation-ko-panel-v1, not human gold)

고정 BFS 설정(dev 튜닝 결과, held-out 재튜닝 없음): maxHops=1, maxSeeds=3, bfsLimit=15

후보 풀=30, 토큰 예산=4096, k=5/10.

## 결론

`do_not_expand` — held-out Recall@10 delta=0.000, 회귀(held-out, A hit B miss @10)=0건.

## dev (n=25)

### hybrid 단독

| category | n | Recall@5 | Recall@10 | nDCG@5 | nDCG@10 | p50 ms | p95 ms | mean tokens |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| single_fact | 8 | 0.750 | 0.875 | 0.487 | 0.531 | 15.6 | 30.0 | 521.3 |
| multi_hop | 8 | 0.000 | 0.000 | 0.000 | 0.000 | 17.9 | 20.4 | 722.6 |
| irrelevant_trap | 9 | 1.000 | 1.000 | 1.000 | 1.000 | 13.8 | 22.7 | 463.2 |

### hybrid + BFS

| category | n | Recall@5 | Recall@10 | nDCG@5 | nDCG@10 | p50 ms | p95 ms | mean tokens |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| single_fact | 8 | 0.750 | 0.875 | 0.487 | 0.531 | 7.6 | 12.2 | 522.5 |
| multi_hop | 8 | 0.000 | 0.000 | 0.000 | 0.000 | 8.6 | 9.4 | 722.6 |
| irrelevant_trap | 9 | 1.000 | 1.000 | 1.000 | 1.000 | 6.5 | 7.3 | 466.2 |

회귀 query_id (A hit, B miss @10): 없음

## held-out (n=50)

### hybrid 단독

| category | n | Recall@5 | Recall@10 | nDCG@5 | nDCG@10 | p50 ms | p95 ms | mean tokens |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| single_fact | 17 | 0.941 | 0.941 | 0.567 | 0.567 | 14.9 | 15.8 | 526.1 |
| multi_hop | 17 | 0.000 | 0.000 | 0.000 | 0.000 | 17.7 | 25.7 | 723.8 |
| irrelevant_trap | 16 | 1.000 | 1.000 | 1.000 | 1.000 | 13.0 | 15.6 | 464.7 |

### hybrid + BFS

| category | n | Recall@5 | Recall@10 | nDCG@5 | nDCG@10 | p50 ms | p95 ms | mean tokens |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| single_fact | 17 | 0.941 | 0.941 | 0.567 | 0.567 | 3.6 | 7.1 | 526.1 |
| multi_hop | 17 | 0.000 | 0.000 | 0.000 | 0.000 | 3.9 | 4.9 | 723.8 |
| irrelevant_trap | 16 | 1.000 | 1.000 | 1.000 | 1.000 | 3.1 | 3.2 | 466.9 |

회귀 query_id (A hit, B miss @10): 없음

## 한계

합성 relation-ko-panel-v1 그래프는 운영 관계 분포를 대표하지 않는다. 본 숫자는 fixture 재현 비교이며 운영 검색 품질 향상 주장에 쓰지 않는다.
