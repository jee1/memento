# 공개 벤치마크 데이터셋 재현 절차 (LongMemEval-S · LoCoMo)

**하는 일**: 외부 공개 데이터셋을 기존 품질 하네스에 연결해 재현 가능한 검색 지표를 뽑는 절차.
**연관**: [longmemeval-s-validation.md](./longmemeval-s-validation.md)(판정자 기반 정답률), [search-ranking.md](../../../agents/search-ranking.md)(랭킹 공식).

---

## 1. 이 문서가 다루는 것과 다루지 않는 것

여기서 뽑는 숫자는 **검색 품질(retrieval)** 입니다. recall@5·recall@10·MRR·nDCG@10을 카테고리별로 나누고, 각 행에 그 카테고리의 **쿼리당 주입 토큰 수**를 함께 적습니다. 정확도만 단독으로 읽으면 "토큰을 더 넣어 점수를 올린" 경우와 구분되지 않기 때문에, 두 값은 항상 같은 행에 둡니다.

`memento_prod`는 세션 단위 검색 엔진 primitive(`hybridSearchEngine.search`)입니다. 공식 LoCoMo QA(판정자 정답률)와 숫자가 같아 보이지 않습니다. 실제 `memory_injection` 경로는 scoped candidate multiplier·다른 기본 가중치·요약·token selection을 거치므로, 그 경로는 `buildKnowledgeContextBundle` 전략으로 따로 재고 engine ID → 주입 본문 provenance로 연결합니다 (#790).

LLM 판정자가 매기는 **정답률(accuracy)** 은 별도 경로입니다. LongMemEval-S에 대해서만 `npm run quality:longmemeval:validate`로 운영하며, 이 문서의 작업에서 LoCoMo로 확장하지 않았습니다. 1,986개 질문에 판정자를 붙이는 일은 자체 벤치마크 설계에 가깝고, 이슈 #767의 비범위입니다.

## 2. 라이선스 — LoCoMo는 비상업(NonCommercial)

| 데이터셋 | 라이선스 | 상업적 사용 | 저장소 커밋 |
|----------|----------|-------------|-------------|
| LongMemEval-S (`xiaowu0162/longmemeval-cleaned`) | MIT (업스트림 저장소) | 가능 | 하지 않음 |
| LoCoMo (`snap-research/locomo`) | **CC BY-NC 4.0** | **불가** | 하지 않음 |

LoCoMo는 Creative Commons Attribution-**NonCommercial** 4.0입니다. 실무적으로 세 가지 규칙을 지킵니다.

1. **원본·파생 코퍼스를 커밋하지 않습니다.** 내려받는 위치 `.local/locomo/`는 `.gitignore`에 있고, 취득 스크립트는 `acquisition-receipt.json`에 `vendored: false`와 SHA-256을 남깁니다.
2. **테스트 픽스처는 전부 합성입니다.** `tests/fixtures/agent-memory-benchmark/locomo-shape-sample.json`은 스키마만 흉내 낸 창작 대화이며 실제 LoCoMo 행을 옮겨 적지 않았습니다. 실제 행을 픽스처에 복사하는 순간 NC 데이터를 저장소에 벤더링하는 셈이 됩니다.
3. **공개 문서에는 집계·ID·해시만 싣습니다.** 질문·답변·대화 본문은 인용하지 않습니다.

어댑터 매니페스트에도 같은 사실이 `license`(`CC BY-NC 4.0 …`)와 `commercial_use: false`로 남습니다. 이 수치를 상업적 마케팅 근거로 쓸 수 없다는 뜻이며, 공개 여부는 이 제약을 전제로 판단합니다.

## 3. 재현

```bash
# 1) 데이터셋 취득 (고정 revision, 원본은 .local/ 밖으로 나가지 않음)
npm run quality:longmemeval:acquire       # .local/longmemeval/longmemeval_s_cleaned.json
npm run quality:locomo:acquire            # .local/locomo/locomo10.json

# 2) 베이스라인만 (grep · fts_only · vector · rrf_sim) — 약 15초
npm run quality:locomo:benchmark

# 3) 프로덕션 경로 포함 (memento_prod = HybridSearchEngine, 임시 DB에 적재) — 수 분
npm run build -w @memento/core
npx tsx scripts/agent-memory-benchmark.ts \
  --locomo .local/locomo/locomo10.json \
  --production \
  --output docs/_work/testing/locomo/latest/results.json

# 4) 테스트
npm run quality:locomo:test
```

`--fixture` · `--longmemeval-s` · `--locomo`는 상호 배타입니다. 리포트의 `scorecard.dataset_revision`은 데이터셋 옆의 `acquisition-receipt.json`에서 읽으므로, 실제로 내려받은 파일의 revision이 그대로 기록됩니다.

## 4. 어댑터가 데이터를 다루는 방식

LoCoMo는 대화 세션 단위로 문서를 만듭니다. 표본(`sample_id`) 하나가 19~32개 세션을 갖고, 문서 ID는 `conv-26:session_7` 꼴이며 `scopeId`는 표본 ID입니다. 쿼리는 자기 표본 안에서만 검색되므로 베이스라인과 프로덕션 경로가 같은 후보 집합을 봅니다.

정답 근거는 **세션 단위로만** 해석합니다. 업스트림 `evidence`가 `"D9:1 D4:4 D4:6"`처럼 여러 참조를 한 문자열에 담거나, `"D"`처럼 잘려 있거나, 실제로 존재하지 않는 발화 번호(`D10:19`)를 가리키는 경우가 실측 2,815건 중 9건 있었습니다. 어댑터는 문자열에서 `D<세션>:<발화>` 패턴을 모두 뽑아 세션 번호만 사용하고, 하나도 해석되지 않으면 그 질문을 검색 쿼리에서 제외한 뒤 `manifest.skipped_query_count`에 셉니다(실측 4건, 전부 open-domain).

**적대적(category 5) 질문 446개는 검색 채점에서 뺍니다.** 이 질문들의 `evidence`는 *틀린* 답이 유도되는 발화를 가리키므로, 그것을 정답 문서로 놓고 recall을 재면 아무 의미가 없습니다. 대신 `taskCases`에 `abstention: true`로 남겨 판정자 경로에서 쓸 수 있게 합니다.

카테고리 라벨은 업스트림 채점기(`task_eval/evaluation.py`)의 분기에서 확인한 값입니다.

| category | 라벨 | 근거 |
|---|---|---|
| 1 | `multi_hop` | 답을 하위 항목으로 쪼개 부분 F1 |
| 2 | `temporal_reasoning` | 단순 F1 |
| 3 | `open_domain_knowledge` | 정답이 `;`로 여러 개 — 첫 항목만 사용 |
| 4 | `single_hop` | 단순 F1 |
| 5 | `adversarial` | "no information available" 선택 여부로 채점 |

## 5. 측정 결과 (2026-08-16)

데이터셋 revision `3eb6f2c5…`, 문서 272개, 채점 쿼리 1,536개, `top_k=10`, 토큰 예산 4,096, 임베딩 `tfidf`. 전체 수치는 [locomo/latest/results.json](../locomo/latest/results.json)에 있습니다.

| 베이스라인 | recall@5 | recall@10 | MRR | nDCG@10 | 쿼리당 토큰 | p95 지연 |
|---|---|---|---|---|---|---|
| grep | 0.301 | 0.531 | 0.222 | 0.280 | 3,721 | 0.8 ms |
| fts_only | 0.797 | 0.882 | 0.713 | 0.735 | 3,794 | 0.3 ms |
| vector | 0.771 | 0.875 | 0.671 | 0.700 | 3,799 | 0.1 ms |
| rrf_sim | 0.798 | 0.888 | 0.703 | 0.729 | 3,796 | 0.4 ms |
| **memento_prod** | **0.307** | **0.381** | **0.227** | **0.257** | **1,787** | 66.6 ms |

프로덕션 경로가 `fts_only`보다 recall@10 기준 0.501 낮고, `production_vs_fts` 게이트는 지연 항목만 통과하고 품질 세 항목이 모두 실패합니다. 같은 방향의 격차가 LongMemEval-S에서도 작게 나타났었고(0.9333 vs 0.9510), LoCoMo에서 크게 벌어졌습니다. 주입 토큰도 베이스라인의 절반 이하(1,787 vs 3,794)입니다 — 같은 4,096 토큰 예산에서 프로덕션 경로가 그만큼 적게 채운다는 뜻입니다. 원인 분석과 랭킹 조정은 이슈 #767의 비범위입니다(측정이 먼저).

카테고리별로는 프로덕션 경로가 `single_hop`에서 가장 낫고 `multi_hop`에서 가장 나쁩니다.

| 카테고리 | 쿼리 수 | fts_only recall@10 | memento_prod recall@10 | memento_prod 쿼리당 토큰 |
|---|---|---|---|---|
| single_hop | 841 | 0.967 | 0.485 | 2,110 |
| temporal_reasoning | 321 | 0.894 | 0.275 | 1,148 |
| multi_hop | 282 | 0.681 | 0.223 | 1,530 |
| open_domain_knowledge | 92 | 0.687 | 0.283 | 1,860 |

**재현성 주의**: 베이스라인 네 개는 완전 결정적입니다. 프로덕션 경로는 단독으로 연속 실행하면 품질 지표가 소수점까지 같지만(지연만 다름), 다른 벤치마크 프로세스와 **동시에** 돌리면 값이 흔들립니다(관측 범위 recall@10 0.367~0.387). 수치를 비교할 때는 다른 작업 없이 단독으로 실행하세요.

## 6. 공개 여부

이슈 #767은 "수치가 낮으면 공개하지 말고 내부 개선 지표로만 사용"을 완료 조건에 두었습니다. 위 수치는 프로덕션 경로가 단순 FTS 베이스라인에 크게 못 미치므로 **대외 공개 대상이 아니며**, LoCoMo는 라이선스상 상업적 사용도 불가합니다. 현재는 내부 회귀 지표로만 유지하고, 프로덕션 검색이 베이스라인을 넘어선 뒤 재검토합니다.
