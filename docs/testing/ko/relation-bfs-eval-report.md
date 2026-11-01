# relation BFS 검색 효용 측정 (#1555 3단계)

라벨: agent_panel (relation-ko-panel-v1, not human gold)

고정 BFS 설정(dev 튜닝 결과, held-out 재튜닝 없음): maxHops=2, maxSeeds=3, bfsLimit=15

후보 풀=30, 토큰 예산=4096, k=5/10.

memory_relation 적재 건수(relations.jsonl): 205

## 결론

`exploratory` — 오염된 held-out: 1차 측정에서 held-out을 본 뒤 점수식·그리드·선택 규칙을 바꿨고 진단도 held-out 기준이었다. held-out Recall@10 delta=0.060(참고용), 회귀@10=0건. 운영 확대 판단 없음.

운영 BFS 확대 여부는 본 PR에서 판단하지 않는다. 숫자는 fixture 재현용 탐색(exploratory) 결과다.

## held-out 오염 (프로토콜)

1차 측정에서 held-out split을 본 뒤 BFS 점수식·dev 그리드·`pickBestHyperparamsOnDev` 규칙·multi_hop 진단을 수정했다. 아래 held-out 표는 **오염된 held-out** 참고용이며, 깨끗한 held-out 일반화 주장에 쓰지 않는다.

## 안전 (harness vs 운영)

본 harness는 `expandPoolWithBfs`·`filterHybridItemsForBfsArm`·`finalizeRanked`에서 query별 forbidden·scope owner·삭제/교체 메타를 **반환 풀**에서 제거한다. 운영 `relation-graph-traversal.ts`의 `getRelatedMemories`와 hybrid recall 경로에는 동일 필터가 없다. fixture에서 safety violation 0( forbidden·foreign owner·deleted/교체 집계)은 **고정 fixture + harness 후처리**일 뿐 운영 안전성 증명이 아니다.

## 1차 측정이 multi_hop 0이었던 원인 (harness, 재측정 전)

1차 run은 BFS가 동작해도 지표가 0으로 나왔다. 원인과 수정은 다음과 같다.

| 구분 | 1차 문제 | 수정 (ad92a548) |
|---|---|---|
| 관계 적재 | fixture DB에 `memory_relation` 미적재·건수 불일치 가능 | `seedRelationGraphFromCorpusAndJsonl`, relations.jsonl **205**건=DB (`relation-bfs-eval-diagnostic.spec.ts`) |
| BFS 병합·점수 | hybrid 30 뒤에 BFS append 후 trim → BFS 전량 탈락; `0.5^hop`·첫 seed만 점수 유지 → gold merged idx 34 | merge 후 score 정렬; `scoreBfsCandidate`(경로 edge confidence×type boost); seed 간 **max** `finalScore` |
| 그리드 | maxHops 1~2, multi_hop 2-hop 미도달 | maxHops **1~3**, dev **multi_hop R@10** 우선 튜닝 |
| 실행 순서 | hybrid 전량 선행 → B 지연·토큰 왜곡 | warm-up, hybrid cache, 그리드 latency off, A/B **교대** latency |

## multi_hop held-out R@10=0.176에 그친 이유 (진단)

held-out multi_hop 17건: **hop_obs는 hybrid top-3 시드 17/17** (시드 3개에 출발 노드 누락 아님). BFS @10 hit **3/17**. 나머지는 2-hop gold가 merged pool에는 들어와도 동일 hybrid 점수대의 타 클러스터 `hop_obs`·trap·direct가 상위 30·@10을 채워 `hop_ans`가 밀린다.

## dev BFS 그리드 (held-out 미사용)

dev 18조합 중 **h2/h3**, **s3/s5**, **l15~l35**는 multi_hop·overall R@10이 각각 동일해 판별력이 없다(동점 시 key tie-break).

| key | maxHops | maxSeeds | bfsLimit | multi_hop R@10 | single_fact R@10 | trap R@10 | overall R@10 |
|---|---:|---:|---:|---:|---:|---:|---:|
| h1-s3-l15 | 1 | 3 | 15 | 0.125 | 0.875 | 1.000 | 0.680 |
| h1-s3-l25 | 1 | 3 | 25 | 0.125 | 0.875 | 1.000 | 0.680 |
| h1-s3-l35 | 1 | 3 | 35 | 0.125 | 0.875 | 1.000 | 0.680 |
| h1-s5-l15 | 1 | 5 | 15 | 0.125 | 0.875 | 1.000 | 0.680 |
| h1-s5-l25 | 1 | 5 | 25 | 0.125 | 0.875 | 1.000 | 0.680 |
| h1-s5-l35 | 1 | 5 | 35 | 0.125 | 0.875 | 1.000 | 0.680 |
| h2-s3-l15 | 2 | 3 | 15 | 0.250 | 1.000 | 1.000 | 0.760 |
| h2-s3-l25 | 2 | 3 | 25 | 0.250 | 1.000 | 1.000 | 0.760 |
| h2-s3-l35 | 2 | 3 | 35 | 0.250 | 1.000 | 1.000 | 0.760 |
| h2-s5-l15 | 2 | 5 | 15 | 0.250 | 1.000 | 1.000 | 0.760 |
| h2-s5-l25 | 2 | 5 | 25 | 0.250 | 1.000 | 1.000 | 0.760 |
| h2-s5-l35 | 2 | 5 | 35 | 0.250 | 1.000 | 1.000 | 0.760 |
| h3-s3-l15 | 3 | 3 | 15 | 0.250 | 1.000 | 1.000 | 0.760 |
| h3-s3-l25 | 3 | 3 | 25 | 0.250 | 1.000 | 1.000 | 0.760 |
| h3-s3-l35 | 3 | 3 | 35 | 0.250 | 1.000 | 1.000 | 0.760 |
| h3-s5-l15 | 3 | 5 | 15 | 0.250 | 1.000 | 1.000 | 0.760 |
| h3-s5-l25 | 3 | 5 | 25 | 0.250 | 1.000 | 1.000 | 0.760 |
| h3-s5-l35 | 3 | 5 | 35 | 0.250 | 1.000 | 1.000 | 0.760 |

## dev (n=25)

### hybrid 단독

| category | n | Recall@5 | Recall@10 | nDCG@5 | nDCG@10 | p50 ms | p95 ms | mean tokens |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| single_fact | 8 | 0.875 | 0.875 | 0.706 | 0.706 | 6.0 | 7.7 | 500.9 |
| multi_hop | 8 | 0.000 | 0.000 | 0.000 | 0.000 | 7.1 | 8.6 | 678.9 |
| irrelevant_trap | 9 | 1.000 | 1.000 | 1.000 | 1.000 | 5.3 | 5.7 | 419.2 |

### hybrid + BFS

| category | n | Recall@5 | Recall@10 | nDCG@5 | nDCG@10 | p50 ms | p95 ms | mean tokens |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| single_fact | 8 | 1.000 | 1.000 | 0.760 | 0.760 | 6.3 | 7.0 | 524.6 |
| multi_hop | 8 | 0.125 | 0.250 | 0.063 | 0.104 | 7.2 | 13.5 | 710.1 |
| irrelevant_trap | 9 | 1.000 | 1.000 | 1.000 | 1.000 | 5.4 | 5.9 | 462.1 |

회귀 query_id (A hit, B miss @10): 없음

## held-out (n=50)

### hybrid 단독

| category | n | Recall@5 | Recall@10 | nDCG@5 | nDCG@10 | p50 ms | p95 ms | mean tokens |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| single_fact | 17 | 0.941 | 0.941 | 0.768 | 0.768 | 5.9 | 7.3 | 507.1 |
| multi_hop | 17 | 0.000 | 0.000 | 0.000 | 0.000 | 6.6 | 12.9 | 679.8 |
| irrelevant_trap | 16 | 1.000 | 1.000 | 1.000 | 1.000 | 5.1 | 5.7 | 420.6 |

### hybrid + BFS

| category | n | Recall@5 | Recall@10 | nDCG@5 | nDCG@10 | p50 ms | p95 ms | mean tokens |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| single_fact | 17 | 0.941 | 0.941 | 0.761 | 0.761 | 6.2 | 11.6 | 529.4 |
| multi_hop | 17 | 0.059 | 0.176 | 0.037 | 0.076 | 6.8 | 7.4 | 714.1 |
| irrelevant_trap | 16 | 1.000 | 1.000 | 1.000 | 1.000 | 5.5 | 5.9 | 462.6 |

회귀 query_id (A hit, B miss @10): 없음

### held-out @10 회귀 외 지표 (single_fact, 오염된 held-out)

| slice | metric | hybrid | hybrid+BFS | 비고 |
|---|---|---:|---:|---|
| single_fact held-out | Recall@5 | 0.941 | 0.941 | 유지/상승 |
| single_fact held-out | nDCG@10 | 0.768 | 0.761 | 하락 |

지연은 warm-up 이후 쿼리별 A/B **교대** 재측정(`measurePairedSearchLatencies`) 값이다.

## 한계

합성 relation-ko-panel-v1 그래프는 운영 관계 분포를 대표하지 않는다. 본 숫자는 fixture 재현 비교이며 운영 검색 품질 향상 주장에 쓰지 않는다.
