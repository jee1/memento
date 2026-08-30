# T019 — Semantic confidence/importance 품질 분포 검증 리포트 (합성 · read-only)

**Requirements:** FR-012, FR-016, FR-018, FR-063; SC-010, SC-012, SC-059
**작성 방식:** 합성(synthetic) 표본 + focused spec 실행 결과만 사용. 운영 원문/파생 corpus는 포함하지 않음(aggregate·식별자·hash만 기록).

## 1. 실행한 검증

### 1-1. Focused spec 실행 (기존 quality persistence 회귀)

```bash
npx vitest --run \
  packages/memento-core/src/domains/memory/semantic/semantic-memory-scoring.spec.ts \
  packages/memento-core/src/domains/memory/semantic/semantic-memory-quality-persistence.spec.ts
```

결과: **2 files passed, 90 tests passed** (2026-08-30T04:26 UTC 실행). 두 spec은 `SemanticMemoryScoring`(confidence/importance 산식)과 `SemanticMemoryUpdateService`(accepted/rejected gate, aggregate 병합, 동시성)를 이미 합성 fixture로 커버하고 있으며, 이번 리포트는 그 결과를 근거로 삼는다.

### 1-2. Read-only 집계 스크립트 (신규, 저장소에 커밋하지 않음)

`packages/memento-core/.../semantic-memory-scoring.ts`의 `SemanticMemoryScoring` 클래스를 `tsx`로 직접 호출하는 임시 스크립트(`/tmp/quality-agg-t019.mts`, 저장소 외부, 실행 후 폐기)를 사용해 카테고리별 합성 triple 15건을 처리했다. 프로덕션 코드는 읽기만 했고 수정하지 않았다.

```bash
npx tsx /tmp/quality-agg-t019.mts
```

- 실행 시각: 2026-08-30T04:28:23.736Z
- **execution_id_hash (payload SHA-256, 앞 16자): `d8f9343b5e7ab68a`**
- 표본 수: 15 (normal 5 / canonicalization-failure 5 / partial-link 5)
- 표본 내용: 합성 subject/predicate/object 문자열(`system`, `user`, `feature-a`…`feature-o`, `bespoke relation a`…`e`)뿐이며, 어떤 실제 대화·메모리·triple 원문도 포함하지 않음.

### 1-3. 운영(ops) DB 접근

이 워크트리에는 프로덕션 ops DB가 존재하지 않는다. `DB_PATH` 환경변수는 비어 있고, 저장소 내에서 발견된 `*.db` 파일은 전부 `data/test/backups/`의 테스트 백업 산출물(`.gitignore`로 제외됨)뿐이었다. 따라서 브리핑의 SQL(`SELECT ... FROM memory_item WHERE type='semantic' ...`)은 **실행하지 않았고**, 이 리포트는 1-1·1-2의 합성 집계만으로 작성했다. 운영 DB 접근 권한이 있는 환경에서 뒤이어 실행할 경우를 위해 대상 쿼리를 §4에 그대로 보존한다.

## 2. Strict 0.7 threshold 선택 근거

`SemanticMemoryScoring.passesConfidenceThreshold`는 `confidence > threshold`(초과, 등호 미포함)로 판정한다.

```8:23:packages/memento-core/src/domains/memory/semantic/semantic-memory-scoring.ts
export class SemanticMemoryScoring {
```

```87:89:packages/memento-core/src/domains/memory/semantic/semantic-memory-scoring.ts
  passesConfidenceThreshold(confidence: number, threshold: number): boolean {
    return Number.isFinite(confidence) && confidence >= 0 && confidence <= 1 && confidence > threshold;
  }
```

confidence는 3개 독립 신호의 가중 합이다: 완전한 SPO(+0.3) · predicate 정규화 성공(+0.3) · entity linking(둘 다 성공 +0.4, 하나만 성공 +0.2). threshold 0.7은 "완전한 SPO + predicate 정규화 실패 + 양쪽 entity linking 성공"(0.3+0+0.4=0.7)을 **경계값으로 명시적으로 배제(≤0.7 → rejected)**하도록 고른 값이다 — canonicalization이 실패한 predicate는 KG 일관성을 해치므로, entity linking만 성공해도 자동 승격을 허용하지 않는다. 반대로 "완전한 SPO + predicate 정규화 성공 + entity linking 하나만 성공"(0.3+0.3+0.2=0.8)은 accepted로 통과한다. 즉 0.7은 predicate 정규화 실패를 단독으로도 게이트 실패 원인으로 만드는 최소 strict 값이다.

## 3. 산식 대사 (episodic → semantic importance)

```100:115:packages/memento-core/src/domains/memory/semantic/semantic-memory-scoring.ts
  calculateConfidence(triple: Triple, _extractionInfo: ExtractionInfo): number {
    return this.prepareNormalizedTriple(triple, 0).confidence;
  }

  calculateImportance(episodicImportance: number, aggregateConfidence: number, finalNumTimes?: number): number {
    if (finalNumTimes === undefined) {
      return this.calculateLegacyImportance(episodicImportance, aggregateConfidence);
    }

    const base = episodicImportance * aggregateConfidence;
    const importance = aggregateConfidence === 1 && base > 0 && finalNumTimes > 1
      ? Math.min(1, base + Math.log(finalNumTimes + 1) / Math.log(10) * 0.1)
      : base;

    return Math.min(1.0, Math.max(0.0, importance));
  }
```

브리핑 산식과 코드가 일치함을 §1-2 집계로 대사했다 (finalNumTimes=1이라 boost 항이 비활성화되어 `importance === base`):

```text
accepted: confidence > 0.7
rejected: confidence <= 0.7
base importance: episodic importance * aggregate confidence
reduction: episodic importance * (1 - aggregate confidence)
```

| 카테고리 | 평균 confidence(aggregate) | gate | 평균 episodic importance | base importance = imp × conf | reduction = imp × (1-conf) | §1-2 산출 average_final_importance |
|---|---|---|---|---|---|---|
| normal | 1.0000 | accepted | 0.7000 | 0.7000 | 0.0000 | 0.7000 (일치) |
| canonicalization-failure | 0.7000 | rejected | 0.7000 | 0.4900 | 0.2100 | 0.4900 (일치) |
| partial-link | 0.5000 | rejected | 0.7000 | 0.3500 | 0.3500 | 0.3500 (일치) |

base importance + reduction = 평균 episodic importance(0.7)로 항상 대사됨 (예: canonicalization-failure 0.49+0.21=0.70).

## 4. 카테고리별 집계 (합성 표본, 15건)

목적: confidence 산식의 세 신호(완전성/predicate 정규화/entity linking) 중 어느 것이 빠지는지에 따라 accepted/rejected 분포와 importance가 어떻게 달라지는지 확인.

| 카테고리 | 표본 수 | accepted (>0.7) | rejected (≤0.7) | avg confidence | avg source importance | avg final importance |
|---|---|---|---|---|---|---|
| normal (완전 SPO + predicate 정규화 성공 + 양쪽 linking 성공) | 5 | 5 | 0 | 1.0000 | 0.7000 | 0.7000 |
| canonicalization-failure (완전 SPO + predicate 정규화 실패 + 양쪽 linking 성공) | 5 | 0 | 5 | 0.7000 | 0.7000 | 0.4900 |
| partial-link (SPO 불완전 + predicate 정규화 성공 + 편측 linking만 성공) | 5 | 0 | 5 | 0.5000 | 0.7000 | 0.3500 |
| **전체 accepted (gate rollup)** | 5 | — | — | 1.0000 | — | 0.7000 |
| **전체 rejected (gate rollup)** | 10 | — | — | 0.6000 | — | 0.4200 |

운영 DB의 `memory_item.confidence`/`importance` 컬럼에는 canonicalization/link 성공 여부(중간 flag)가 별도 컬럼으로 남지 않으므로, 위 카테고리 분리는 **합성 검증에서만** 가능하다. 운영 데이터에서는 §4의 SQL로 `gate_accepted`/`gate_rejected` 두 그룹만 재현 가능하다 (아래 §5 참고).

### 참고: 운영 DB 대상 쿼리 (이번 실행에서는 미실행, §1-3 참고)

```sql
SELECT
  CASE WHEN confidence > 0.7 THEN 'accepted' ELSE 'rejected' END AS gate_result,
  COUNT(*) AS memory_count,
  ROUND(AVG(confidence), 4) AS average_confidence,
  ROUND(AVG(importance), 4) AS average_importance
FROM memory_item
WHERE type = 'semantic' AND confidence IS NOT NULL
GROUP BY gate_result
ORDER BY gate_result;
```

## 5. 유출 검사 결과

```bash
git diff -- specs/066-semantic-confidence-importance/validation-report.md
git status --short
```

- 본 파일은 신규 생성이라 `git diff`는 비어 있고(신규 파일은 diff에 나타나지 않음), `git status --short`에는 `specs/066-semantic-confidence-importance/`(신규) 외 운영 원문·파생 corpus 파일이 없음을 확인했다.
- `/tmp/quality-agg-t019.mts`는 저장소 외부 임시 스크립트이며 저장소에 포함되지 않는다.
- 프로덕션 코드(`packages/memento-core/...`)는 수정하지 않았다(읽기 전용).

## 6. 결론

- 세 카테고리(normal / canonicalization-failure / partial-link) 중 confidence > 0.7을 통과하는 것은 **normal뿐**이며, predicate 정규화 실패 또는 entity linking 편측 실패는 각각 확실히 rejected로 이어진다(threshold 경계 0.7이 정확히 canonicalization-failure 케이스와 일치 — §2).
- `calculateImportance`의 `base = episodicImportance * aggregateConfidence`, `reduction = episodicImportance * (1 - aggregateConfidence)` 산식은 브리핑 문서와 코드·합성 집계 3자 대사가 일치한다.
- 이번 실행 환경에는 운영 ops DB 접근 경로가 없어 SQL 집계는 참고용으로만 보존했고, 실제 값은 모두 합성 표본 기반이다.
