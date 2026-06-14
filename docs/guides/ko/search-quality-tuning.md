# 검색 품질 튜닝 가이드

Memento의 recall은 여러 신호를 가중합산하여 최종 점수를 결정합니다. 이 가중치가 적절하지 않으면 관련성 높은 결과가 하위에 밀리거나, 오래된 정보가 상위에 노출되는 문제가 발생합니다. 이 문서는 벤치마크 데이터셋을 기반으로 가중치를 자동 탐색·비교하는 autoresearch 하네스의 사용법을 설명합니다.

## 랭킹 공식과 가중치 파일

recall의 최종 점수는 다음 공식으로 계산됩니다.

```
S = α·relevance + β·recency + γ·importance + δ·usage
    + ζ·relation_weight + ζ_fb·(feedback_norm − 0.5) − ε·duplication_penalty
```

가중치 기본값은 `config/ranking-weights.toml`에 저장되어 있으며, 서버가 시작할 때 이 파일을 로드합니다. 서로 다른 가중치 조합은 `config/ranking-profiles/` 디렉터리에 프로파일 파일로 저장하여 비교할 수 있습니다.

## 사전 조건

튜닝 스크립트를 실행하기 전에 `@memento/core`를 빌드해야 합니다. 소스를 변경한 경우에도 마찬가지입니다.

```bash
npm run build -w @memento/core
```

벤치마크 데이터셋은 `tests/fixtures/search-quality/benchmark-v3/`에 있습니다.

## 스크립트 세 가지

autoresearch 하네스는 세 개의 npm 스크립트로 구성됩니다.

### 1. 두 프로파일 비교

기존 프로파일 파일 두 개를 통계적으로 비교하려면 `quality:benchmark:compare-profiles`를 사용합니다.

```bash
npm run quality:benchmark:compare-profiles -- \
  --profile-a default \
  --profile-b feedback-heavy
```

출력은 JSON 형식으로, MRR(Mean Reciprocal Rank) p-value와 verdict를 포함합니다.

```json
{
  "mrr_significant": true,
  "mrr_p_value": 0.023,
  "verdict": "a_better"
}
```

`verdict`가 `a_better`이면 profile-a가 통계적으로 유의하게 우수하고, `b_better`이면 profile-b가 우수하며, `inconclusive`이면 p ≥ 0.05로 유의한 차이가 없습니다. 프로파일 파일의 경로는 `config/ranking-profiles/<name>.toml`입니다.

### 2. 가중치 자동 탐색

baseline 프로파일을 기준으로 랜덤하게 N개의 후보 가중치를 생성·평가하려면 `quality:benchmark:tune-weights`를 사용합니다.

```bash
npm run quality:benchmark:tune-weights -- \
  --candidates 50 \
  --seed 42 \
  --baseline-profile default
```

주요 옵션은 다음과 같습니다.

| 옵션 | 기본값 | 설명 |
|------|--------|------|
| `--candidates` | `30` | 생성할 후보 수. 많을수록 탐색 범위가 넓어지고 시간이 늘어납니다. |
| `--seed` | `Date.now()` | PRNG 시드. 같은 값이면 동일한 후보 집합을 재현할 수 있습니다. |
| `--baseline-profile` | `default` | 기준 프로파일명 (`config/ranking-profiles/*.toml`) |
| `--benchmark-dir` | `tests/fixtures/.../benchmark-v3` | 벤치마크 데이터셋 경로 |
| `--output-dir` | `tmp/tune-weights/` | 결과 저장 경로 |

후보가 다음 게이트 기준 중 하나라도 위반하면 자동으로 거부됩니다.

| 조건 | 이유 |
|------|------|
| `p95_latency_ms > 2000ms` | 레이턴시 예산 초과 |
| `ndcg_at_10 < baseline − 0.05` | NDCG 회귀 허용 한계 초과 |

게이트를 통과한 후보는 복합 점수로 순위가 매겨집니다.

```
composite = 0.45 × ndcg_at_10
          + 0.30 × mrr
          + 0.15 × recall_at_10
          − 0.07 × (p95_latency / baseline_p95)
          − 0.03 × empty_result_rate
```

결과는 `tmp/tune-weights/run-{seed}/` 아래에 저장됩니다. `summary.json`에 전체 요약이, `candidates/` 폴더에 각 후보의 TOML 설정과 평가 결과 JSON이 저장됩니다.

### 3. 튜닝 결과 리포트

마지막 run의 결과를 표 형식으로 확인하려면 `quality:benchmark:tune-report`를 사용합니다.

```bash
# 최신 run 자동 탐색
npm run quality:benchmark:tune-report

# 특정 run 지정
npm run quality:benchmark:tune-report -- --run-dir tmp/tune-weights/run-42
```

리포트는 seed·평가된 후보 수·거부된 후보 수·baseline 복합 점수·최고 복합 점수와 함께, 상위 후보들을 MRR·NDCG·Recall·레이턴시 기준으로 정렬한 표를 출력합니다.

## 튜닝 결과 적용

새 가중치 후보가 충분히 우수하다고 판단되면, 다음 단계로 적용합니다.

먼저 best 후보 TOML을 새 프로파일로 저장합니다.

```bash
cp tmp/tune-weights/run-42/candidates/candidate-17.toml \
   config/ranking-profiles/tuned-v1.toml
```

그 다음 비교 스크립트로 실제 개선 여부를 확인합니다.

```bash
npm run quality:benchmark:compare-profiles -- \
  --profile-a default \
  --profile-b tuned-v1
```

`verdict: b_better`가 확인되면 아래 두 파일에 `[ranking_weights]` 섹션을 동시에 업데이트합니다. 두 파일이 항상 같은 값을 가져야 런타임과 벤치마크가 동일한 가중치를 사용합니다.

- `config/ranking-weights.toml` — 서버가 런타임에 로드하는 파일
- `config/ranking-profiles/default.toml` — 벤치마크 baseline 프로파일

변경을 커밋하면 CI가 머지된 TOML을 읽어 회귀를 자동으로 검증합니다.

```bash
git add config/ranking-weights.toml config/ranking-profiles/default.toml
git commit -m "perf(ranking): tune weights — seed 42, candidate 17, composite +0.0233"
```

## 전체 워크플로 요약

```
1. npm run quality:benchmark:tune-weights -- --candidates 50 --seed 42
         ↓
2. npm run quality:benchmark:tune-report
   (best_toml_path 확인, mrr_verdict 확인)
         ↓
3. best TOML → config/ranking-profiles/<name>.toml 저장
         ↓
4. npm run quality:benchmark:compare-profiles -- --profile-a default --profile-b <name>
   (verdict: b_better 확인)
         ↓
5. ranking-weights.toml + default.toml 동시 업데이트
         ↓
6. PR 생성 → CI 통과 → 머지
```

## 주의사항

`--seed` 값을 기록해두면 동일한 후보 집합을 언제든 재현할 수 있습니다. `--candidates 100` 이상으로 늘리면 더 좋은 후보를 찾을 가능성이 높아지지만 run당 수 분이 소요됩니다. 가중치 합이 1.5를 초과하면 `sum_warning` 경고가 출력되는데, 복합 점수 자체는 정상이지만 가중치 값의 상대적 의미를 해석할 때 주의가 필요합니다. 게이트 통과 후보가 없을 때(`no_candidates_passed_gate`)는 `--candidates`를 늘리거나 `--baseline-profile`을 재검토하십시오.
