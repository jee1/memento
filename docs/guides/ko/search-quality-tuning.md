# 검색 품질 튜닝 가이드

검색 랭킹 가중치를 벤치마크 데이터셋 기반으로 자동 탐색·비교하는 autoresearch 하네스 사용 가이드입니다.

## 개요

랭킹 가중치(`alpha`, `beta`, `gamma`, `delta`, `zeta`, `epsilon`, `theta`, `zeta_fb`)를 조정해 검색 품질(NDCG, MRR, Recall)을 개선하고 레이턴시 예산을 유지합니다.

**스크립트 3종:**

| npm 스크립트 | 파일 | 역할 |
|---|---|---|
| `quality:benchmark:compare-profiles` | `scripts/compare-weight-profiles.ts` | 두 프로파일 A/B 비교 |
| `quality:benchmark:tune-weights` | `scripts/tune-weights.ts` | 후보 N개 생성·평가, 최선 후보 선택 |
| `quality:benchmark:tune-report` | `scripts/tune-report.ts` | 튜닝 run 결과 리포트 출력 |

**벤치마크 데이터셋:** `tests/fixtures/search-quality/benchmark-v3/`

---

## 사전 조건

```bash
npm run build -w @memento/core   # dist/ 생성 (최초 1회 또는 소스 변경 후)
```

---

## 1. 두 프로파일 비교

기존 프로파일 간 검색 품질을 통계적으로 비교합니다.

```bash
npm run quality:benchmark:compare-profiles -- \
  --profile-a default \
  --profile-b feedback-heavy
```

**출력 (JSON stdout):**

```json
{
  "mrr_significant": true,
  "mrr_p_value": 0.023,
  "verdict": "a_better"
}
```

| `verdict` 값 | 의미 |
|---|---|
| `a_better` | profile-a가 통계적으로 유의하게 우수 |
| `b_better` | profile-b가 통계적으로 유의하게 우수 |
| `inconclusive` | 유의한 차이 없음 (p ≥ 0.05) |

> 프로파일 파일 경로: `config/ranking-profiles/<name>.toml`

---

## 2. 가중치 튜닝

baseline 프로파일을 기준으로 N개 후보를 랜덤 생성·평가하여 최선 후보를 찾습니다.

```bash
npm run quality:benchmark:tune-weights -- \
  --candidates 50 \
  --seed 42 \
  --baseline-profile default
```

### 옵션

| 옵션 | 기본값 | 설명 |
|---|---|---|
| `--candidates` | `30` | 생성할 후보 수 (많을수록 탐색 범위↑, 시간↑) |
| `--seed` | `Date.now()` | PRNG 시드 — 같은 값이면 동일한 후보 재현 가능 |
| `--baseline-profile` | `default` | 기준 프로파일명 (`config/ranking-profiles/*.toml`) |
| `--benchmark-dir` | `tests/fixtures/.../benchmark-v3` | 벤치마크 디렉터리 |
| `--output-dir` | `tmp/tune-weights/` | 결과 저장 경로 |

### 게이트 기준 (자동 거부 조건)

| 조건 | 이유 |
|---|---|
| `p95_latency_ms > 2000ms` | 레이턴시 예산 초과 |
| `ndcg_at_10 < baseline − 0.05` | NDCG 회귀 허용 한계 초과 |

### 복합 점수 공식

```
composite = 0.45 × ndcg_at_10
          + 0.30 × mrr
          + 0.15 × recall_at_10
          − 0.07 × (p95_latency / baseline_p95)
          − 0.03 × empty_result_rate
```

### 출력 구조

```
tmp/tune-weights/
└── run-42/
    ├── summary.json          ← 핵심 결과 요약
    └── candidates/
        ├── candidate-0.toml  ← 후보 가중치 설정
        ├── candidate-0.json  ← 후보 평가 결과
        ├── candidate-1.toml
        └── ...
```

**`summary.json` 주요 필드:**

```json
{
  "seed": 42,
  "candidates_evaluated": 50,
  "candidates_rejected": 8,
  "best_composite_score": 0.6124,
  "best_candidate_index": 17,
  "best_toml_path": "tmp/tune-weights/run-42/candidates/candidate-17.toml",
  "mrr_p_value": 0.031,
  "mrr_significant": true,
  "mrr_verdict": "best_better",
  "top_candidates": [...]
}
```

---

## 3. 튜닝 결과 리포트

마지막(또는 지정) run의 결과를 표로 출력합니다.

```bash
# 최신 run 자동 탐색
npm run quality:benchmark:tune-report

# 특정 run 지정
npm run quality:benchmark:tune-report -- --run-dir tmp/tune-weights/run-42
```

**출력 예시:**

```
=== Tuning Run Report ===
Seed:                    42
Candidates:              50 evaluated, 8 rejected
Baseline composite score: 0.5891
Best composite score:    0.6124
MRR p-value:             0.0310
MRR significant:         true
MRR verdict:             best_better

┌──────┬──────────────────┬───────────────────┬────────┬────────────┬─────────────┬──────────────────┐
│ rank │ candidate_index  │ composite_score   │ mrr    │ ndcg_at_10 │ recall_at_10│ p95_latency_ms   │
├──────┼──────────────────┼───────────────────┼────────┼────────────┼─────────────┼──────────────────┤
│    1 │               17 │ 0.6124            │ 0.7210 │ 0.6830     │ 0.8100      │ 412.3            │
│    2 │                3 │ 0.6051            │ 0.7100 │ 0.6720     │ 0.8050      │ 398.7            │
│  ... │              ... │ ...               │ ...    │ ...        │ ...         │ ...              │
└──────┴──────────────────┴───────────────────┴────────┴────────────┴─────────────┴──────────────────┘

Best candidate TOML: tmp/tune-weights/run-42/candidates/candidate-17.toml
```

---

## 4. 튜닝 결과 적용

### Step 1 — 후보 TOML 확인

```bash
cat tmp/tune-weights/run-42/candidates/candidate-17.toml
```

```toml
[ranking_weights]
alpha = 0.51
beta = 0.18
gamma = 0.22
delta = 0.09
zeta = 0.17
epsilon = 0.08
theta = 0.11
zeta_fb = 0.06

[relation_weights]
max_relations = 5
```

### Step 2 — 두 파일에 동일하게 반영

> **주의:** 아래 두 파일은 항상 `[ranking_weights]` 값이 동일해야 합니다.
> 하나만 바꾸면 런타임과 벤치마크가 다른 가중치를 사용합니다.

- `config/ranking-weights.toml` — 서버가 실제로 로드하는 파일
- `config/ranking-profiles/default.toml` — 벤치마크 baseline 프로파일

`[ranking_weights]` 섹션만 교체하고 `[relation_weights]`와 주석은 유지합니다.

### Step 3 — 적용 전 검증

```bash
# 새 가중치로 별도 프로파일 저장 후 비교
cp tmp/tune-weights/run-42/candidates/candidate-17.toml \
   config/ranking-profiles/tuned-v1.toml

npm run quality:benchmark:compare-profiles -- \
  --profile-a default \
  --profile-b tuned-v1
```

`verdict: b_better` 확인 후 반영. `inconclusive`이면 개선이 없으므로 적용 보류.

### Step 4 — PR로 머지

```bash
git add config/ranking-weights.toml config/ranking-profiles/default.toml
git commit -m "perf(ranking): tune weights — seed 42, candidate 17, composite +0.0233"
```

CI는 머지된 TOML을 읽어 회귀를 검증합니다.

---

## 전체 워크플로우 요약

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

---

## 팁

- **재현성**: `--seed` 값을 기록해두면 동일한 후보 집합을 언제든 재생성 가능
- **탐색 범위**: `--candidates 100` 이상으로 늘리면 더 좋은 후보를 찾을 가능성↑ (run당 수분 소요)
- **sum_warning**: 가중치 합이 1.5 초과 시 경고 — 복합 점수는 정상이지만 상대적 의미 해석에 주의
- **`no_candidates_passed_gate`**: 게이트 통과 후보 없음 → `--candidates` 증가 또는 `--baseline-profile` 재검토
