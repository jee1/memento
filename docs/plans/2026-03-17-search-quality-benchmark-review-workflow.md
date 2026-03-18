# Search Quality Benchmark Review Workflow Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 사람이 `ground-truth.json`을 검토·확정할 수 있는 Markdown 체크리스트 생성 경로와 검토 완료 검증 경로를 추가한다.

**Architecture:** benchmark fixture 디렉터리의 `queries.json`, `label-candidates.json`, `corpus.jsonl`, `ground-truth.json`, `manifest.json`을 읽는 두 개의 helper를 추가한다. 하나는 사람이 읽는 `review-checklist.md`를 생성하고, 다른 하나는 ground truth/manifest의 일관성을 검증해 strict gate 전환 조건을 강제한다.

**Tech Stack:** TypeScript, Vitest, existing benchmark fixture helpers, tsx CLI scripts

---

### Task 1: Markdown 체크리스트 생성 helper

**Files:**
- Create: `src/test/helpers/search-quality-review-checklist.ts`
- Test: `src/test/helpers/search-quality-review-checklist.spec.ts`

**Step 1: Write the failing test**

- 체크리스트에 query 메타데이터, 현재 relevant ids, 후보 기억 요약이 포함되는지 테스트한다.

**Step 2: Run test to verify it fails**

Run: `npx vitest --run src/test/helpers/search-quality-review-checklist.spec.ts`
Expected: FAIL because helper does not exist yet.

**Step 3: Write minimal implementation**

- benchmark fixture를 읽어 Markdown 문자열을 생성한다.
- 후보 기억은 `benchmark_id`, `source_memory_id`, `type`, `tags`, 요약 content를 포함한다.

**Step 4: Run test to verify it passes**

Run: `npx vitest --run src/test/helpers/search-quality-review-checklist.spec.ts`
Expected: PASS

### Task 2: Review 검증 helper

**Files:**
- Create: `src/test/helpers/search-quality-review-verifier.ts`
- Test: `src/test/helpers/search-quality-review-verifier.spec.ts`

**Step 1: Write the failing test**

- `ground_truth_reviewed=true`인데 ground truth가 비어 있거나 id가 corpus에 없으면 실패하는지 테스트한다.
- 정상 fixture면 검증이 통과하는지 테스트한다.

**Step 2: Run test to verify it fails**

Run: `npx vitest --run src/test/helpers/search-quality-review-verifier.spec.ts`
Expected: FAIL because verifier does not exist yet.

**Step 3: Write minimal implementation**

- queries/ground truth/corpus/manifest 일관성을 검사한다.
- strict 전환 전에 필요한 오류 메시지를 명확히 반환한다.

**Step 4: Run test to verify it passes**

Run: `npx vitest --run src/test/helpers/search-quality-review-verifier.spec.ts`
Expected: PASS

### Task 3: CLI 스크립트 연결

**Files:**
- Create: `scripts/generate-search-quality-review-checklist.ts`
- Create: `scripts/verify-search-quality-benchmark-review.ts`
- Modify: `package.json`

**Step 1: Write the failing test**

- helper 테스트로 이미 behavior를 고정했으므로 CLI는 최소 wrapper로 구현한다.

**Step 2: Write minimal implementation**

- checklist 스크립트는 `review-checklist.md`를 생성한다.
- verify 스크립트는 검증 실패 시 non-zero 종료 코드를 반환한다.
- `package.json`에 실행 스크립트를 추가한다.

**Step 3: Run focused verification**

Run: `npx vitest --run src/test/helpers/search-quality-review-checklist.spec.ts src/test/helpers/search-quality-review-verifier.spec.ts`
Expected: PASS

### Task 4: 문서 갱신

**Files:**
- Modify: `docs/testing/ko/search-quality-benchmarking.md`

**Step 1: Update workflow docs**

- 후보 생성 다음 단계로 Markdown 체크리스트 생성 추가
- 사람이 `ground-truth.json`을 수정한 뒤 verify를 실행하는 흐름 추가
- `ground_truth_reviewed=true` 전환 기준 명시

**Step 2: Verify examples**

- 문서 명령이 실제 스크립트 이름과 일치하는지 확인한다.

### Final verification

Run these commands in order:

```bash
npx vitest --run src/test/helpers/search-quality-review-checklist.spec.ts src/test/helpers/search-quality-review-verifier.spec.ts
npx vitest --run src/test/helpers/search-quality-benchmark-fixtures.spec.ts packages/memento-core/src/domains/monitoring/services/quality-assurance/quality-metrics-collector.spec.ts src/test/test-vector-search-quality-with-consolidation.spec.ts
npm run type-check
DB_PATH=/home/jee1lee/git/memento/data/memory.db npm run quality:benchmark:checklist -- --benchmark-dir tests/fixtures/search-quality/benchmark-v1
DB_PATH=/home/jee1lee/git/memento/data/memory.db npm run quality:benchmark:verify-review -- --benchmark-dir tests/fixtures/search-quality/benchmark-v1
```

Expected:
- helper/unit tests succeed
- type-check succeeds
- checklist script writes `review-checklist.md`
- verify script fails for `benchmark-v1` until human review is explicitly completed
