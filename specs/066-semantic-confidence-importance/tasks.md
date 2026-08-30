# semantic confidence 영속화 및 importance 게이트 — 작업 분해

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development` (권장) 또는
> `superpowers:executing-plans`로 이 계획을 작업 단위로 실행하십시오. `[TDD]` 작업은 반드시
> RED → GREEN → REFACTOR 순서를 지키고, 각 단계는 체크박스(`- [ ]`)로 추적합니다.

**Goal**: 자동 추출 triple의 confidence를 신규·exact·유사 semantic 경로에 영속화하고, 최신 episodic
importance에 aggregate confidence를 곱한 품질 게이트를 모든 자동 변환 진입점과 예약 batch에서 동일하게
적용한다.

**Architecture**: 기존 `SemanticMemoryUpdateService` 조합을 유지하면서 정규화 snapshot → scoped candidate
판정 → coalesced primary plan → 짧은 conversion commit → 독립 post-commit 정산으로 흐름을 정리한다. remember,
명시적 변환 도구, 예약 batch는 하나의 내부 `episodic-semantic-conversion.ts`를 사용한다. batch execute는
policy·clock·candidate·result를 호출별로 복사하고 원본을 직렬 처리한다.

**Tech Stack**: Node.js ≥24, TypeScript 5.9 ES modules, npm workspaces, `better-sqlite3`, `sqlite-vec`, Vitest

**Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Research**: [research.md](./research.md) |
**Data model**: [data-model.md](./data-model.md) | **Contracts**: [semantic update](./contracts/semantic-update.md),
[conversion state](./contracts/conversion-state.md), [batch job](./contracts/batch-job.md) |
**Validation**: [quickstart.md](./quickstart.md)

---

## Global Constraints

모든 작업에는 다음 제약이 포함된다.

- Node.js 24+, TypeScript ES modules, npm workspaces를 유지한다.
- 신규 dependency, 공개 입력·출력 필드, failure reason, DB 컬럼·인덱스·migration을 추가하지 않는다.
- confidence 저장 조건은 `confidence > threshold`, similarity 일치는 `score >= threshold`다.
- confidence와 importance는 finite `[0,1]`; `episodicImportance=0`은 `0.5`로 대체하지 않는다.
- `num_times`만 evidence occurrence 수로 사용하고 semantic 병합에서 `recall_count`를 변경하지 않는다.
- raw subject·predicate·object·content·embedding·LLM output을 신규/수정 로그나 metadata에 넣지 않는다.
- 자동 변환 write transaction 안에는 source/candidate 재검증과 semantic/KG/source row 변경만 둔다.
- 관계·semantic embedding·statistics는 primary commit 뒤 모두 정산하고 primary/source success를 뒤집지 않는다.
- batch `parallelism`은 정확히 `1`; 원본·chunk 내부 병렬화, lease, mutex, queue, checkpoint를 추가하지 않는다.
- 테스트 fixture는 합성 데이터만 사용한다. 운영 DB는 read-only 집계만 허용한다.
- production code를 바꾼 완료점에는 lint, type-check, 전체 test, graphify rebuild/report 확인이 필요하다.

## Format: `[ID] [markers] [Story] 설명`

| Marker | 의미 |
|---|---|
| `[P]` | 같은 선행 조건 뒤 다른 파일에서 병렬 실행 가능 |
| `[TDD]` | 실패 테스트를 먼저 만들고 확인한 뒤 최소 구현 |
| `[REVIEW]` | 다음 phase 전 코드·계약 검토 게이트 |
| `[SUBAGENT]` | 독립 write scope로 별도 executor에게 위임 가능 |

## File Structure

| Path | 책임 |
|---|---|
| `packages/memento-core/src/domains/memory/semantic/semantic-memory-update-types.ts` | invocation/input/normalized/candidate/outcome/commit 내부 타입; 공개 options/result 불변 |
| `packages/memento-core/src/domains/memory/semantic/semantic-memory-scoring.ts` | 정규화 1회, confidence, strict gate, aggregate, importance pure logic |
| `packages/memento-core/src/domains/memory/semantic/semantic-memory-similarity.ts` | scope/provenance 선필터, exact 우선, deterministic similar 선택, input embedding 재사용 |
| `packages/memento-core/src/domains/memory/semantic/semantic-memory-crud.ts` | 조건부 create/update primary SQL; confidence·importance·`num_times` 원자 갱신 |
| `packages/memento-core/src/domains/memory/semantic/semantic-memory-update-pipeline.ts` | trust-boundary validation, snapshot, prepare, coalesce, commit 재판정, outcome 대사 |
| `packages/memento-core/src/domains/memory/semantic/semantic-memory-relations.ts` | 방향/type preflight와 양방향 duplicate-safe post-commit 정산 |
| `packages/memento-core/src/domains/memory/semantic/semantic-memory-update-service.ts` | 기존 공개 facade와 dependency composition |
| `packages/memento-core/src/domains/memory/semantic/episodic-semantic-conversion.ts` | 세 자동 진입점의 source snapshot/commit/failure transition 공통 coordinator |
| `packages/memento-core/src/domains/memory/semantic/convert-episodic-to-semantic-tool.ts` | 기존 MCP 결과를 coordinator 결과로 변환 |
| `packages/memento-core/src/domains/memory/remember/remember-tool-augmentation.ts` | 저장 후 자동 변환을 coordinator에 위임 |
| `packages/memento-core/src/infrastructure/scheduler/jobs/triple-extraction-batch-job.ts`와 `triple-extraction-batch-job/` | execute policy/clock/candidates/chunks/retry/results 및 execute-local DB binding |
| `packages/memento-core/src/domains/memory/semantic/semantic-memory-quality-persistence.spec.ts` | semantic 생성·병합·coalescing·concurrency·rollback focused DB 회귀 |
| `packages/memento-core/src/domains/memory/semantic/episodic-semantic-conversion.spec.ts` | conversion commit/source state/retry/post-commit focused 회귀 |
| `packages/memento-core/src/infrastructure/scheduler/jobs/__tests__/triple-extraction-batch-job-retry.spec.ts` | config/status/metadata/due/transition 계약 |
| `packages/memento-core/src/infrastructure/scheduler/jobs/__tests__/triple-extraction-batch-job-contract.spec.ts` | timeout/chunk/result/fatal prefix/DB binding/fresh result 계약 |
| `specs/066-semantic-confidence-importance/validation-report.md` | 합성 및 허용된 read-only 집계 증거; raw data 금지 |

---

## Phase 1: Setup

**Purpose**: 변경 전 회귀 상태와 스키마·공개 계약의 무변경 기준을 확보한다.

### T001 기준선과 변경 금지 경계 확인

**Files:** Read only: `package.json`, `packages/memento-core/package.json`,
`packages/memento-core/src/infrastructure/database/sqlite/schema.sql`, 현재 semantic/batch test files

- [x] **Step 1: Node와 의존성을 확인한다**

```bash
nvm use
node -v
which node
npm install
```

Expected: Node major `24` 이상, 설치 성공. Node major가 바뀌었으면 `npm run rebuild-native`도 성공한다.

- [x] **Step 2: 현재 관련 회귀를 실행해 기준선을 기록한다**

```bash
npx vitest --run \
  packages/memento-core/src/domains/memory/semantic/semantic-memory-scoring.spec.ts \
  packages/memento-core/src/domains/memory/semantic/semantic-memory-update-service.spec.ts \
  packages/memento-core/src/domains/memory/semantic/__tests__/convert-episodic-to-semantic-tool.spec.ts \
  packages/memento-core/src/domains/memory/remember/__tests__/remember-tool.spec.ts \
  packages/memento-core/src/infrastructure/scheduler/jobs/__tests__/triple-extraction-batch-job.spec.ts
```

Expected: 기존 실패가 있으면 정확한 test name과 stack을 기준선으로 남기고, 새 변경의 실패와 구분한다.

- [x] **Step 3: 금지 파일의 초기 hash를 보관한다**

```bash
git diff -- packages/memento-core/src/infrastructure/database/sqlite/schema.sql \
  packages/memento-core/src/infrastructure/database/sqlite/migration package.json package-lock.json
```

Expected: feature 구현으로 인한 diff가 없다.

**Checkpoint**: 기준선 확보. 실패 원인을 알 수 없는 상태에서는 Phase 2로 넘어가지 않는다.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: 모든 story가 공유하는 품질 산식과 불변 request snapshot을 먼저 잠근다.

### T002 [TDD] [SUBAGENT] 품질 산식과 단일 정규화 snapshot

**Files:**
- Modify: `packages/memento-core/src/domains/memory/semantic/semantic-memory-update-types.ts`
- Modify: `packages/memento-core/src/domains/memory/semantic/semantic-memory-scoring.ts`
- Modify: `packages/memento-core/src/domains/memory/semantic/semantic-memory-scoring.spec.ts`

**Interfaces:**

```ts
export interface NormalizedTripleSnapshot {
  index: number;
  subject: string;
  predicate: string;
  object: string;
  predicateCanonicalized: boolean;
  subjectLinked: boolean;
  objectLinked: boolean;
  confidence: number;
}

prepareNormalizedTriple(triple: Triple, index: number): NormalizedTripleSnapshot;
passesConfidenceThreshold(confidence: number, threshold: number): boolean;
calculateAggregateConfidence(existing: number | null, numTimes: number, next: number): number;
calculateImportance(episodicImportance: number, aggregateConfidence: number, finalNumTimes: number): number;
```

**Requirements:** FR-001–FR-009, FR-019–FR-022, FR-037, FR-053–FR-061; SC-001–SC-006,
SC-013–SC-018, SC-033, SC-048–SC-057

- [x] **Step 1: 실패 테스트를 추가한다** — 기존 0.3/0.3/0.4 배점, canonical/link 호출 각 1회,
fallback `success=false`, `confidence === threshold` 제외, invalid finite/range 거부, NULL aggregate 초기화,
weighted average, representable-below-1, explicit `0`, aggregate `1`에서만 boost를 각각 독립 `it`으로 고정한다.

```ts
expect(scoring.passesConfidenceThreshold(0.7, 0.7)).toBe(false);
expect(scoring.calculateAggregateConfidence(0.8, 2, 0.5)).toBeCloseTo(0.7, 12);
expect(scoring.calculateImportance(0, 1, 99)).toBe(0);
expect(scoring.calculateImportance(0.8, 0.75, 99)).toBeCloseTo(0.6, 12);
```

- [x] **Step 2: RED를 확인한다**

```bash
npx vitest --run packages/memento-core/src/domains/memory/semantic/semantic-memory-scoring.spec.ts
```

Expected: 새 helper가 없거나 기존 `>=`/importance boost 의미 때문에 새 사례가 실패한다.

- [x] **Step 3: 최소 pure logic을 구현한다**

```ts
const accepted = Number.isFinite(confidence) && confidence >= 0 && confidence <= 1 && confidence > threshold;
const aggregate = existing === null ? next : (existing * numTimes + next) / (numTimes + 1);
const base = episodicImportance * aggregate;
const finalImportance = aggregate === 1 && base > 0 && numTimes > 1
  ? Math.min(1, base + Math.log(numTimes + 1) / Math.log(10) * 0.1)
  : base;
```

평균이 수학적으로 1 미만이면 저장 가능한 `1` 미만 값으로 유지한다. canonicalizer/linker는
`prepareNormalizedTriple()` 안에서만 호출한다.

- [x] **Step 4: GREEN과 정적 검사를 확인한다**

```bash
npx vitest --run packages/memento-core/src/domains/memory/semantic/semantic-memory-scoring.spec.ts
npm run type-check -w @memento/core
```

- [x] **Step 5: Lore commit**

```text
Persist semantic quality from one normalized evidence snapshot

Constraint: Preserve confidence weights, strict threshold semantics, and public types.
Rejected: Recomputing canonicalization in scoring, similarity, and CRUD | produces divergent snapshots.
Confidence: high
Scope-risk: narrow
Directive: Keep explicit episodic importance zero distinct from an omitted value.
Tested: semantic-memory-scoring.spec.ts; @memento/core type-check
Not-tested: Database persistence is covered by T005 onward.
```

### T003 [TDD] request/container validation과 immutable invocation/input snapshot

**Files:**
- Create: `packages/memento-core/src/domains/memory/semantic/semantic-memory-quality-persistence.spec.ts`
- Modify: `packages/memento-core/src/domains/memory/semantic/semantic-memory-update-types.ts`
- Modify: `packages/memento-core/src/domains/memory/semantic/semantic-memory-update-pipeline.ts`
- Modify: `packages/memento-core/src/domains/memory/semantic/semantic-memory-update-service.ts`

**Interfaces:**

```ts
interface InvocationPolicySnapshot {
  episodicMemoryId: string;
  episodicImportance: number;
  confidenceThreshold: number;
  similarityThreshold: number;
}
interface InvocationInputPosition {
  index: number;
  triple: Triple | null;
}
interface EpisodicSourceSnapshot {
  id: string;
  type: 'episodic';
  content: string;
  importance: number | null;
  ownerId: string | null;
  projectId: string | null;
  isDeleted: false;
  tripleExtracted: number | null;
  tripleExtractedStatus: string | null;
  tripleExtractionMetadata: string | null;
}
validateAndSnapshotRequest(result: unknown, options: unknown):
  | { kind: 'empty'; result: SemanticMemoryUpdateResult }
  | { kind: 'ready'; policy: InvocationPolicySnapshot; positions: InvocationInputPosition[]; extractionInfo: ExtractionInfo };
```

**Requirements:** FR-031–FR-033, FR-056–FR-075; SC-027–SC-029, SC-052–SC-071

- [x] **Step 1: canonical `setupTestDatabase()` 기반 실패 테스트를 작성한다** — actual empty array의 조회 0회,
malformed result/container/metadata의 전체 reject, sparse/non-object 위치의 local skip, invalid ID/options/failureReason의
pre-DB reject, caller mutation 이후에도 원래 policy·위치·SPO·steps 사용, raw output 미전달을 검증한다.

```ts
const pending = service.updateSemanticMemory(result, options);
options.confidenceThreshold = 0;
result.triples[0]!.subject = 'mutated';
await pending;
expect(readStoredTriple(db)).toMatchObject({ subject: 'original' });
```

- [x] **Step 2: RED를 확인한다**

```bash
npx vitest --run packages/memento-core/src/domains/memory/semantic/semantic-memory-quality-persistence.spec.ts
```

Expected: malformed container가 TypeError/no-op으로 섞이거나 mutation 값이 처리에 들어가 실패한다.

- [x] **Step 3: 필요한 필드만 값 복사하고 검증한다** — `triples=[]`를 가장 먼저 반환하고, non-empty에서만
metadata/options/source ID를 검증한다. sparse/non-object position은 `triple:null`로 snapshot하여 outcome count에
남긴다. `rawLLMOutput`과 사용하지 않는 필드는 복사하지 않는다.

- [x] **Step 4: focused spec과 기존 facade spec을 통과시킨다**

```bash
npx vitest --run \
  packages/memento-core/src/domains/memory/semantic/semantic-memory-quality-persistence.spec.ts \
  packages/memento-core/src/domains/memory/semantic/semantic-memory-update-service.spec.ts
```

- [x] **Step 5: Lore commit**

```text
Freeze semantic update inputs before asynchronous quality work

Constraint: Empty triple arrays remain a zero-query service no-op.
Rejected: Deep-cloning the entire extraction result | raw output and unused fields must not cross the boundary.
Confidence: high
Scope-risk: moderate
Directive: Validate shared inputs once; isolate malformed individual positions as skipped outcomes.
Tested: semantic quality persistence and existing semantic update service specs
Not-tested: Candidate and primary persistence behavior follows in user-story tasks.
```

### T004 [REVIEW] Foundational contract gate

- [x] Confirm `SemanticMemoryUpdateOptions` and `SemanticMemoryUpdateResult` exported fields are unchanged.
- [x] Confirm no schema/migration/package-lock diff exists.
- [x] Confirm T002–T003 targeted tests are green and every new branch has a failing-test commit predecessor.
- [x] Confirm normalization/linking call-count assertions prove one snapshot per valid input position.

**Checkpoint**: Foundation ready. User-story code may now build on frozen snapshots and pure quality helpers.

---

## Phase 3: User Story 1 — 품질에 맞는 semantic memory 생성 (Priority: P1) 🎯 MVP

**Goal**: 수락된 신규 semantic은 non-NULL confidence와 quality-adjusted importance를 저장하고, 하한 이하나
invalid confidence는 어떤 primary row도 만들지 않는다.

**Independent Test**: 같은 positive episodic importance의 정상/fallback triple을 신규 경로로 처리해 정상 항목의
confidence·importance가 더 높고, threshold 이하·explicit importance 0 경계가 계약과 일치함을 DB에서 확인한다.

### T005 [TDD] [US1] 신규 semantic/KG primary에 confidence·scope·provenance 영속화

**Files:**
- Modify: `packages/memento-core/src/domains/memory/semantic/semantic-memory-crud.ts`
- Modify: `packages/memento-core/src/domains/memory/semantic/semantic-memory-update-pipeline.ts`
- Modify: `packages/memento-core/src/domains/memory/semantic/semantic-memory-quality-persistence.spec.ts`

**Interfaces:**

```ts
createSemanticMemory(
  snapshot: NormalizedTripleSnapshot,
  source: EpisodicSourceSnapshot,
  episodicImportance: number
): Promise<{ id: string; confidence: number; kind: 'created' }>;
```

**Requirements:** FR-002–FR-004, FR-006–FR-010, FR-019–FR-022, FR-025, FR-027, FR-038, FR-043,
FR-047; SC-001–SC-006, SC-014–SC-018, SC-022, SC-034, SC-039, SC-043

- [x] **Step 1: RED DB 사례를 추가한다** — accepted create, confidence exactly 0.7, thresholds 0/1,
invalid confidence, explicit importance 0, NULL importance 0.5, source owner/project/privacy/origin, KG write rollback,
부적격 global KG representative의 scoped fallback을 검증한다.

```ts
expect(readSemantic(db, id)).toMatchObject({
  confidence: expectedConfidence,
  importance: sourceImportance * expectedConfidence,
  num_times: 1,
  owner_id: source.owner_id,
  project_id: source.project_id,
  privacy_scope: 'private',
});
```

- [x] **Step 2: RED를 확인한다**

```bash
npx vitest --run packages/memento-core/src/domains/memory/semantic/semantic-memory-quality-persistence.spec.ts -t "new semantic"
```

Expected: 현재 INSERT가 confidence/scope/provenance를 쓰지 않고 `importance || 0.5`를 사용해 실패한다.

- [x] **Step 3: INSERT와 KG upsert를 한 primary transaction으로 묶는다**

```sql
INSERT INTO memory_item (
  id, type, content, subject, predicate, object, confidence, importance,
  num_times, owner_id, project_id, origin_source, privacy_scope, created_at
) VALUES (?, 'semantic', ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, 'private', ?)
```

기존 global KG row가 부적격이면 representative를 교체하지 않고 semantic row만 scoped fallback으로 커밋한다.
신규 KG row가 필요한 경로의 KG write 예외는 memory INSERT와 함께 rollback한다.

- [x] **Step 4: GREEN을 확인한다**

```bash
npx vitest --run \
  packages/memento-core/src/domains/memory/semantic/semantic-memory-quality-persistence.spec.ts \
  packages/memento-core/src/domains/memory/semantic/semantic-memory-update-service.spec.ts
```

- [x] **Step 5: Lore commit**

```text
Persist accepted semantic evidence with its quality and source scope

Constraint: Existing schema and global KG uniqueness remain unchanged.
Rejected: Adding scoped KG uniqueness | requires a migration outside issue 805.
Confidence: high
Scope-risk: moderate
Directive: Keep new semantic and new KG-row writes in one primary transaction.
Tested: new semantic quality persistence and semantic service regressions
Not-tested: Existing candidate aggregation is covered by T009.
```

### T006 [TDD] [US1] post-commit 관계·embedding·statistics 독립 정산

**Files:**
- Modify: `packages/memento-core/src/domains/memory/semantic/semantic-memory-relations.ts`
- Modify: `packages/memento-core/src/domains/memory/semantic/semantic-memory-crud.ts`
- Modify: `packages/memento-core/src/domains/memory/semantic/semantic-memory-update-pipeline.ts`
- Modify: `packages/memento-core/src/domains/memory/semantic/semantic-memory-quality-persistence.spec.ts`

**Interfaces:**

```ts
type PostCommitIntent =
  | { kind: 'extracted_from' | 'supported_by'; sourceId: string; targetId: string; confidence: number }
  | { kind: 'embedding'; memoryId: string; content: string };
validateRelationContract(source: EpisodicSourceSnapshot): void;
settlePostCommit(intents: readonly PostCommitIntent[]): Promise<void>;
```

**Requirements:** FR-011, FR-015–FR-016, FR-023, FR-045, FR-063, FR-066–FR-074;
SC-007, SC-009–SC-010, SC-019, SC-041, SC-059, SC-062–SC-071

- [x] **Step 1: RED 사례를 추가한다** — relation direction/type 오류는 first primary write 전 reject,
양방향 duplicate는 no-change success, 한 방향 실패가 다른 방향을 막지 않음, relation/embedding/statistics/logger
실패 뒤 committed row/result 보존, 모든 post-commit promise가 settle된 뒤 return, raw fields 0건을 검증한다.

```ts
await expect(call).resolves.toMatchObject({ created: 1 });
expect(primaryRow).toEqual(controlPrimaryRow);
expect(extractedFromAttempt).toHaveBeenCalledOnce();
expect(supportedByAttempt).toHaveBeenCalledOnce();
expect(embeddingAttempt).toHaveBeenCalledOnce();
```

- [x] **Step 2: RED를 확인한다**

```bash
npx vitest --run packages/memento-core/src/domains/memory/semantic/semantic-memory-quality-persistence.spec.ts -t "post-commit"
```

- [x] **Step 3: side effect intent를 primary에서 분리한다** — `createSemanticMemory()`의 fire-and-forget embedding을
제거하고 pipeline이 relation 두 방향과 embedding을 독립 promise로 만들어 `Promise.allSettled()` 한다.
duplicate relation에는 `updateOnConflict:false` 의미를 유지하고 기존 row를 갱신하지 않는다. 통계/logger 예외는
별도 try/catch로 격리하며 raw triple 대신 source ID, index, normalized reason만 남긴다.

- [x] **Step 4: GREEN과 relation 회귀를 확인한다**

```bash
npx vitest --run \
  packages/memento-core/src/domains/memory/semantic/semantic-memory-quality-persistence.spec.ts \
  packages/memento-core/src/domains/memory/semantic/semantic-memory-update-service.spec.ts \
  packages/memento-core/src/infrastructure/scheduler/jobs/__tests__/arigraph-relation-engine-integration.spec.ts
```

- [x] **Step 5: Lore commit**

```text
Keep committed semantic quality independent from post-commit operations

Constraint: Relation direction errors remain pre-primary contract failures.
Rejected: Fire-and-forget embedding and relation work | callers require all intents settled before return.
Confidence: high
Scope-risk: moderate
Directive: A post-commit failure must never write source failure state or alter primary outcomes.
Tested: semantic quality, semantic service, and AriGraph relation integration specs
Not-tested: Source success transitions are introduced in T013.
```

### T007 [REVIEW] [US1] User Story 1 checkpoint

- [x] Verify accepted create rows always have finite non-NULL confidence and finite `[0,1]` importance.
- [x] Verify threshold equality and invalid confidence produce no memory/KG/relation changes.
- [x] Verify explicit source importance `0` remains `0` and omitted/NULL source importance uses only `0.5`.
- [x] Verify post-commit failures leave committed primary rows and public result intact.

**Checkpoint**: User Story 1 independently works as the MVP create path.

---

## Phase 4: User Story 2 — 중복 병합에서도 품질 할인 유지 (Priority: P2)

**Goal**: exact/similar/coalesced/concurrent evidence가 같은 eligibility, aggregate confidence, latest importance,
`num_times`, deterministic target 계약을 지킨다.

**Independent Test**: 신규 → exact → similar → concurrent merge 순으로 같은 fact를 처리해 각 accepted occurrence가
정확히 한 번 반영되고 `recall_count`는 변하지 않으며 aggregate가 1 미만이면 boost가 적용되지 않음을 확인한다.

### T008 [TDD] [SUBAGENT] [US2] scoped automatic candidate 선필터와 deterministic similarity

**Files:**
- Modify: `packages/memento-core/src/domains/memory/semantic/semantic-memory-similarity.ts`
- Modify: `packages/memento-core/src/domains/memory/semantic/semantic-memory-update-pipeline.ts`
- Modify: `packages/memento-core/src/domains/memory/semantic/semantic-memory-quality-persistence.spec.ts`

**Interfaces:**

```ts
interface SemanticCandidateSnapshot {
  id: string;
  subject: string;
  predicate: string;
  object: string;
  confidence: number | null;
  numTimes: number;
  ownerId: string | null;
  projectId: string | null;
  createdAt: string;
}
findDuplicateSemanticMemory(
  snapshot: NormalizedTripleSnapshot,
  sourceScope: { ownerId: string | null; projectId: string | null },
  similarityThreshold: number
): Promise<CandidateDecision>;

type CandidateDecision =
  | { kind: 'exact' | 'similar'; candidate: SemanticCandidateSnapshot }
  | { kind: 'none' }
  | { kind: 'indeterminate'; reason: string };
```

**Requirements:** FR-026, FR-028–FR-036, FR-041–FR-044, FR-047, FR-050–FR-055;
SC-021–SC-032, SC-037–SC-040, SC-043, SC-045–SC-051

- [x] **Step 1: RED 후보 matrix를 작성한다** — null-safe scope, automatic origin, legacy extracted relation,
user-authored/deleted/blank-SPO/stale-KG/invalid confidence/invalid `num_times` 제외, exact 우선, created_at+ID tie-break,
threshold equality, invalid/unavailable similarity의 indeterminate, 부적격 content/embedding read 0회, input embedding 최대 2회를 검증한다.

```ts
expect(candidate.id).toBe(oldestExactId);
expect(generateEmbedding).toHaveBeenCalledTimes(2);
expect(readIneligibleContent).not.toHaveBeenCalled();
```

- [x] **Step 2: RED를 확인한다**

```bash
npx vitest --run packages/memento-core/src/domains/memory/semantic/semantic-memory-quality-persistence.spec.ts -t "candidate"
```

- [x] **Step 3: SQL 선필터와 decision union을 구현한다** — active semantic, null-safe owner/project,
automatic provenance, predicate를 content/embedding 전 SQL/최소 row 판정에 적용한다. exact structural match를 먼저
정렬하고, similar candidate만 cached input subject/object embedding과 비교한다. invalid score/provider failure는
`indeterminate`; eligible 후보 0건만 `none`이다.

- [x] **Step 4: GREEN을 확인한다**

```bash
npx vitest --run packages/memento-core/src/domains/memory/semantic/semantic-memory-quality-persistence.spec.ts -t "candidate|similarity|scope|provenance"
```

- [x] **Step 5: Lore commit**

```text
Restrict automatic semantic matching before candidate content access

Constraint: Owner/project scope and provenance must be null-safe and schema-neutral.
Rejected: Filtering candidates after embedding reads | leaks and compares out-of-scope content.
Confidence: high
Scope-risk: moderate
Directive: Treat unavailable required similarity as indeterminate, never as permission to create.
Tested: focused candidate, similarity, scope, and provenance cases
Not-tested: Atomic aggregate mutation follows in T009.
```

### T009 [TDD] [US2] atomic exact/similar aggregate update

**Files:**
- Modify: `packages/memento-core/src/domains/memory/semantic/semantic-memory-crud.ts`
- Modify: `packages/memento-core/src/domains/memory/semantic/semantic-memory-update-pipeline.ts`
- Modify: `packages/memento-core/src/domains/memory/semantic/semantic-memory-quality-persistence.spec.ts`

**Interfaces:**

```ts
interface PreparedEvidenceOccurrence {
  firstIndex: number;
  representativeIndex: number;
  confidence: number;
  episodicImportance: number;
  duplicateIndexes: number[];
  decision: CandidateDecision;
}
updateExistingSemanticMemory(
  candidate: SemanticCandidateSnapshot,
  evidence: PreparedEvidenceOccurrence
): Promise<{ id: string; confidence: number; kind: 'updated' } | null>;
```

**Requirements:** FR-005–FR-010, FR-014, FR-017, FR-019, FR-037, FR-049–FR-052;
SC-002–SC-004, SC-008, SC-011, SC-013–SC-014, SC-033, SC-044, SC-046–SC-048

- [x] **Step 1: RED exact/similar/concurrent update 사례를 추가한다** — NULL legacy initialization,
weighted average by `num_times`, invalid legacy isolation, latest committed importance, low aggregate no boost,
aggregate 1 boost, explicit 0, `num_times +1`, `recall_count +0`, lost-update 없는 N concurrent occurrences를 검증한다.

```ts
expect(row.num_times).toBe(before.num_times + acceptedOccurrences);
expect(row.recall_count).toBe(before.recall_count);
expect(row.confidence).toBeCloseTo(weightedExpected, 6);
expect(row.importance).toBeCloseTo(lastCommittedImportance * row.confidence, 6);
```

- [x] **Step 2: RED를 확인한다**

```bash
npx vitest --run packages/memento-core/src/domains/memory/semantic/semantic-memory-quality-persistence.spec.ts -t "aggregate|exact|similar|concurrent update"
```

- [x] **Step 3: read-modify-write 대신 조건부 원자 update를 구현한다** — candidate snapshot의 active/scope/provenance/
SPO/confidence/`num_times` 조건을 UPDATE WHERE에 포함하고, 새 aggregate와 importance를 같은 statement/transaction에서
기록한다. `recall_count`와 `last_accessed_at`은 evidence merge에서 수정하지 않는다. `changes===0`은 stale candidate로
pipeline에 반환한다.

- [x] **Step 4: GREEN을 확인한다**

```bash
npx vitest --run packages/memento-core/src/domains/memory/semantic/semantic-memory-quality-persistence.spec.ts -t "aggregate|exact|similar|concurrent update"
```

- [x] **Step 5: Lore commit**

```text
Preserve every accepted occurrence in atomic semantic aggregates

Constraint: num_times is the sole evidence count and recall_count is search-only.
Rejected: Application-only read-modify-write | concurrent calls can lose aggregate updates.
Confidence: high
Scope-risk: moderate
Directive: A stale conditional update must return to the single re-evaluation path.
Tested: exact, similar, legacy aggregate, latest importance, and concurrent update cases
Not-tested: Same-invocation coalescing follows in T010.
```

### T010 [TDD] [US2] same-invocation coalescing과 outcome 대사

**Files:**
- Modify: `packages/memento-core/src/domains/memory/semantic/semantic-memory-update-types.ts`
- Modify: `packages/memento-core/src/domains/memory/semantic/semantic-memory-update-pipeline.ts`
- Modify: `packages/memento-core/src/domains/memory/semantic/semantic-memory-statistics.ts`
- Modify: `packages/memento-core/src/domains/memory/semantic/semantic-memory-quality-persistence.spec.ts`

**Interfaces:**

```ts
type ProcessingOutcomeKind = 'created' | 'updated' | 'skipped' | 'duplicate';
coalescePreparedOccurrences(
  occurrences: readonly PreparedEvidenceOccurrence[]
): PreparedEvidenceOccurrence[];
```

**Requirements:** FR-039–FR-040, FR-043, FR-060, FR-063–FR-064, FR-068, FR-072;
SC-035–SC-036, SC-056, SC-059–SC-060, SC-064, SC-066, SC-068

- [x] **Step 1: RED 사례를 추가한다** — normalized SPO duplicates, exact+similar same target, 최고 confidence 대표와
동률 first-index, target first-index 직렬 순서, unique semantic IDs, rollback group의 skipped 1 + duplicates K-1,
`created+updated+skipped+duplicates=input length`, confidence sample per calculable position을 검증한다.

```ts
expect(outcomeTotal).toBe(input.triples.length);
expect(result.semanticMemoryIds).toEqual(idsOrderedByFirstSuccessfulInput);
expect(maxConcurrentPrimaryMutations).toBe(1);
```

- [x] **Step 2: RED를 확인한다**

```bash
npx vitest --run packages/memento-core/src/domains/memory/semantic/semantic-memory-quality-persistence.spec.ts -t "coalesce|outcome|deterministic"
```

- [x] **Step 3: 두 단계 coalescing을 구현한다** — normalized SPO key로 먼저 합치고 candidate decision 뒤 target ID로
다시 합친다. 대표는 highest confidence/lowest index, 실행과 public ID 순서는 first index다. public result에는 duplicate
필드를 추가하지 않고 existing statistics `duplicates`만 갱신한다.

- [x] **Step 4: GREEN을 확인한다**

```bash
npx vitest --run packages/memento-core/src/domains/memory/semantic/semantic-memory-quality-persistence.spec.ts -t "coalesce|outcome|deterministic"
```

- [x] **Step 5: Lore commit**

```text
Count one semantic occurrence per source target and invocation

Constraint: Public update results cannot expose a new duplicate field.
Rejected: Raw-triple deduplication | normalization can collapse different raw inputs later.
Confidence: high
Scope-risk: moderate
Directive: Keep primary execution and returned IDs ordered by the target's first input position.
Tested: normalized and same-target coalescing, outcomes, samples, and deterministic IDs
Not-tested: Cross-call create races follow in T011.
```

### T011 [TDD] [US2] concurrent create 수렴과 candidate 1회 재판정

**Files:**
- Modify: `packages/memento-core/src/domains/memory/semantic/semantic-memory-crud.ts`
- Modify: `packages/memento-core/src/domains/memory/semantic/semantic-memory-update-pipeline.ts`
- Modify: `packages/memento-core/src/domains/memory/semantic/semantic-memory-quality-persistence.spec.ts`

**Requirements:** FR-017, FR-038, FR-047–FR-049, FR-052, FR-086–FR-087;
SC-034, SC-043–SC-045, SC-048, SC-082–SC-083

- [x] **Step 1: RED race 사례를 추가한다** — N same-scope first creates converge to one active automatic row,
winner `num_times=N`, no orphan loser, candidate delete/scope/provenance change before commit, exactly one outside-transaction
re-evaluation, second stale check operational skip, open write transaction 중 embedding/similarity call 0회를 검증한다.

```ts
expect(activeAutomaticRows).toHaveLength(1);
expect(activeAutomaticRows[0]!.num_times).toBe(N);
expect(reEvaluateCandidate).toHaveBeenCalledTimes(1);
expect(fallibleCallsWhileWriteTransactionOpen).toBe(0);
```

- [x] **Step 2: RED를 확인한다**

```bash
npx vitest --run packages/memento-core/src/domains/memory/semantic/semantic-memory-quality-persistence.spec.ts -t "concurrent create|re-evaluate|stale candidate"
```

- [x] **Step 3: create 경쟁과 재판정 경계를 구현한다** — primary transaction에서 candidate/source snapshot을
조건부 재확인하고 경쟁 패자는 임시 INSERT를 commit하지 않는다. stale candidate면 transaction 전체를 종료한 뒤
prepared normalized/input embeddings를 재사용 가능한 범위에서만 재사용해 candidate lookup/similarity를 한 번 다시
실행하고 새 transaction을 연다. 두 번째 stale은 skip하고 추가 retry/lock을 만들지 않는다.

- [x] **Step 4: GREEN을 확인한다**

```bash
npx vitest --run packages/memento-core/src/domains/memory/semantic/semantic-memory-quality-persistence.spec.ts -t "concurrent create|re-evaluate|stale candidate"
```

- [x] **Step 5: Lore commit**

```text
Converge semantic creation races without widening SQLite locks

Constraint: Fallible normalization and embedding work must stay outside write transactions.
Rejected: Global creation mutex or lease | serializes unrelated semantic targets and adds state.
Confidence: medium
Scope-risk: broad
Directive: Candidate re-evaluation is allowed once only after the first transaction is fully rolled back.
Tested: concurrent first-create and stale-candidate race cases
Not-tested: Source success atomicity is covered by the shared coordinator in T013.
```

### T012 [REVIEW] [US2] User Story 2 checkpoint

- [x] Verify exact and similar paths call the same aggregate mutation and never increment `recall_count`.
- [x] Verify candidate SQL excludes other scope/user/deleted/corrupt rows before content or embedding access.
- [x] Verify coalesced inputs count once per source+invocation+target and public IDs are unique/deterministic.
- [x] Verify concurrent create/update tests prove no lost occurrence, orphan semantic, or global serialization.

**Checkpoint**: User Stories 1 and 2 work independently; semantic quality invariants hold on all primary paths.

---

## Phase 5: User Story 3 — 근거 있는 저장 게이트와 자동 변환 운영 (Priority: P3)

**Goal**: 세 자동 진입점이 같은 source commit/retry 의미를 사용하고 batch가 validation, due, timeout,
fixed-candidate, durable-result 계약을 지킨다.

**Independent Test**: shared coordinator를 직접 검증한 뒤 explicit tool, remember, batch에 같은 success/no-triple/
pre-commit/post-commit/stale/force-reprocess 시나리오를 적용해 source tuple과 기존 공개 outcome 의미가 일치함을 확인한다.

### T013 [TDD] [US3] shared episodic conversion coordinator와 source commit unit

**Files:**
- Create: `packages/memento-core/src/domains/memory/semantic/episodic-semantic-conversion.ts`
- Create: `packages/memento-core/src/domains/memory/semantic/episodic-semantic-conversion.spec.ts`
- Modify: `packages/memento-core/src/domains/memory/semantic/semantic-memory-update-types.ts`
- Modify: `packages/memento-core/src/domains/memory/semantic/semantic-memory-update-pipeline.ts`
- Modify: `packages/memento-core/src/domains/memory/semantic/semantic-memory-update-service.ts`

**Interfaces:**

```ts
export interface EpisodicSemanticConversionOptions {
  sourceId: string;
  skipConverted: boolean;
  maxRetries: number;
  retryBackoffDays: readonly number[];
  now: () => Date;
}
export interface EpisodicSemanticConversionDependencies {
  db: Database.Database;
  tripleExtractionService: Pick<TripleExtractionService, 'extractTriples'>;
  semanticMemoryUpdateService: SemanticMemoryUpdateService;
}
export type EpisodicSemanticConversionOutcome =
  | { kind: 'success'; update: SemanticMemoryUpdateResult }
  | { kind: 'failed'; retryCount?: number }
  | { kind: 'skipped' };
export async function convertEpisodicSource(
  dependencies: EpisodicSemanticConversionDependencies,
  options: EpisodicSemanticConversionOptions
): Promise<EpisodicSemanticConversionOutcome>;
```

Coordinator는 package root에서 export하지 않는다. 공개 semantic update result도 변경하지 않는다.

**Requirements:** FR-024, FR-046, FR-076–FR-091; SC-020, SC-042, SC-072–SC-087

- [x] **Step 1: RED conversion matrix를 작성한다** — primary+source success atomic commit, status-write rollback,
policy-only success, service-empty vs automatic no-triple, malformed/pre-primary failed retry, single winner, stale source skipped,
forced success new occurrence, forced failure prior success preservation, failure-state commit failure no retry report,
post-commit failure no downgrade, `triple_count` original positions, `confidence_avg` current committed occurrences만 검증한다.

```ts
expect(readSource(db, id)).toMatchObject({
  triple_extracted: 1,
  triple_extracted_status: 'success',
});
expect(metadata.triple_count).toBe(originalInputLength);
expect(metadata.confidence_avg).toBeCloseTo(currentCommittedAverage, 12);
```

- [x] **Step 2: RED를 확인한다**

```bash
npx vitest --run packages/memento-core/src/domains/memory/semantic/episodic-semantic-conversion.spec.ts
```

- [x] **Step 3: 최소 coordinator를 구현한다** — active episodic source를 value snapshot하고 extraction/preparation을
transaction 밖에서 수행한다. 하나의 short transaction에서 source snapshot/eligibility를 재검증하고 모든 prepared
semantic/KG primary와 success tuple을 commit한다. genuine failure만 별도 conditional transaction으로 canonical
failed/abandoned metadata 전체를 교체한다. stale/loser/forced prior-success failure는 source state를 쓰지 않는다.

- [x] **Step 4: GREEN과 focused semantic spec을 확인한다**

```bash
npx vitest --run \
  packages/memento-core/src/domains/memory/semantic/episodic-semantic-conversion.spec.ts \
  packages/memento-core/src/domains/memory/semantic/semantic-memory-quality-persistence.spec.ts
```

- [ ] **Step 5: Lore commit**

```text
Commit semantic evidence and source success as one conversion fact

Constraint: Automatic entrypoints share source state semantics without a public API change.
Rejected: Separate semantic and source commits | status failure would allow duplicate evidence retry.
Confidence: high
Scope-risk: broad
Directive: Durable conversion commit is the point of no return; post-commit failures never create source retry.
Tested: conversion coordinator and semantic quality persistence specs
Not-tested: Entrypoint adapters are covered by T014 and T015.
```

### T014 [TDD] [P] [SUBAGENT] [US3] explicit conversion tool adapter

**Files:**
- Modify: `packages/memento-core/src/domains/memory/semantic/convert-episodic-to-semantic-tool.ts`
- Modify: `packages/memento-core/src/domains/memory/semantic/__tests__/convert-episodic-to-semantic-tool.spec.ts`

**Requirements:** FR-024, FR-078–FR-083; SC-020, SC-074–SC-079

- [x] **Step 1: RED 사례를 추가한다** — success/policy-only/no-triple/pre-commit/post-commit/stale/single-winner/
`skip_converted=false` force failure를 tool의 기존 `{total,success,failed,skipped,semantic_memory_ids}` 결과에 매핑한다.
기존 성공 forced failure는 source metadata를 byte-for-byte 보존한다.

- [x] **Step 2: RED를 확인한다**

```bash
npx vitest --run packages/memento-core/src/domains/memory/semantic/__tests__/convert-episodic-to-semantic-tool.spec.ts
```

- [x] **Step 3: tool의 `convertSingleMemory`/success/error/no-triple 상태 writer를 coordinator 호출로 교체한다** —
tool은 memory 선택과 공개 결과 집계만 소유한다. relation confidence 재조회, raw error metadata,
독자 retry increment를 제거하고 coordinator outcome만 기존 counters/IDs로 변환한다.

- [x] **Step 4: GREEN을 확인한다**

```bash
npx vitest --run packages/memento-core/src/domains/memory/semantic/__tests__/convert-episodic-to-semantic-tool.spec.ts
```

- [ ] **Step 5: Lore commit**

```text
Route explicit episodic conversion through the shared commit boundary

Constraint: Existing MCP request and response fields remain unchanged.
Rejected: Retaining tool-local source status writers | duplicates retry and confidence-average logic.
Confidence: high
Scope-risk: moderate
Directive: Tool counters must reflect only the coordinator's durable outcome.
Tested: convert-episodic-to-semantic-tool.spec.ts
Not-tested: Remember augmentation uses the same coordinator in T015.
```

### T015 [TDD] [P] [SUBAGENT] [US3] remember augmentation adapter

**Files:**
- Modify: `packages/memento-core/src/domains/memory/remember/remember-tool-augmentation.ts`
- Modify: `packages/memento-core/src/domains/memory/remember/__tests__/remember-tool.spec.ts`

**Requirements:** FR-019, FR-078–FR-084; SC-014, SC-074–SC-080

- [x] **Step 1: RED 사례를 추가한다** — saved episodic importance `0`, coordinator success/no-triple/pre-commit/
post-commit/stale outcomes, concurrent background jobs single winner, 기존 scheduler fallback을 검증한다.

```ts
expect(convertEpisodicSource).toHaveBeenCalledWith(expect.objectContaining({
  sourceId: savedMemoryId,
}));
expect(readSource(db, savedMemoryId).importance).toBe(0);
```

- [x] **Step 2: RED를 확인한다**

```bash
npx vitest --run packages/memento-core/src/domains/memory/remember/__tests__/remember-tool.spec.ts -t "AriGraph Pipeline"
```

- [x] **Step 3: `runTripleExtractionJob()`의 local status/retry/confidence-average 코드를 coordinator 위임으로 줄인다** —
`importance || 0.5`를 제거하고 source row snapshot의 NULL-only default를 coordinator가 적용하게 한다. 기존 background
scheduler 등록/fallback과 사용자-facing remember result는 바꾸지 않는다.

- [x] **Step 4: GREEN을 확인한다**

```bash
npx vitest --run packages/memento-core/src/domains/memory/remember/__tests__/remember-tool.spec.ts
```

- [ ] **Step 5: Lore commit**

```text
Use one conversion outcome for remember background augmentation

Constraint: Remember remains background augmentation with its existing scheduler behavior.
Rejected: Keeping in-progress and retry state logic beside the adapter | diverges from explicit and batch conversion.
Confidence: high
Scope-risk: moderate
Directive: Never default a persisted episodic importance of zero.
Tested: remember-tool.spec.ts including AriGraph pipeline cases
Not-tested: Scheduled batch policy is covered by T016 and T017.
```

### T016 [TDD] [P] [SUBAGENT] [US3] batch policy·eligibility·retry transition

**Files:**
- Create: `packages/memento-core/src/infrastructure/scheduler/jobs/__tests__/triple-extraction-batch-job-retry.spec.ts`
- Modify: `packages/memento-core/src/infrastructure/scheduler/jobs/triple-extraction-batch-job/triple-extraction-batch-job.types.ts`
- Modify: `packages/memento-core/src/infrastructure/scheduler/jobs/triple-extraction-batch-job/triple-extraction-batch-job-retry.ts`
- Modify: `packages/memento-core/src/infrastructure/scheduler/jobs/triple-extraction-batch-job/triple-extraction-batch-job-memory-status.ts`

**Interfaces:**

```ts
resolveTripleExtractionBatchPolicy(config: TripleExtractionBatchJobConfig | undefined): ResolvedTripleExtractionBatchJobConfig;
selectTripleExtractionCandidates(db: Database.Database, policy: ResolvedTripleExtractionBatchJobConfig, now: Date): TripleExtractionTargetMemory[];
parseRetryEligibility(memory: TripleExtractionTargetMemory, policy: ResolvedTripleExtractionBatchJobConfig, now: Date):
  { eligible: true; retryCount: number } | { eligible: false; reason: string };
```

**Requirements:** FR-092–FR-099, FR-101–FR-105, FR-107–FR-110, FR-113–FR-114, FR-119–FR-120;
SC-088–SC-095, SC-097, SC-099–SC-106, SC-109–SC-110, SC-115–SC-116

- [x] **Step 1: RED policy/retry matrix를 작성한다** — defaults only undefined, invalid explicit/sparse values before DB,
positive safe integers, `parallelism===1`, zero timeout/delay/backoff, consistent status tuples only, corrupt metadata isolation,
legacy missing metadata, exact due and 24h fractional units, timezone/overflow/future time, eligibility-before-limit order,
fixed sorted snapshot, maxRetries first-attempt semantics, backoff last-value repeat, canonical metadata key sets를 검증한다.

```ts
expect(() => resolveTripleExtractionBatchPolicy({ parallelism: 2 })).toThrow();
expect(selected.map(({ id }) => id)).toEqual(eligibleIdsInCreatedAtThenIdOrder);
expect(parseRetryEligibility(memory, policy, twelveHoursLater)).toMatchObject({ eligible: true });
```

- [x] **Step 2: RED를 확인한다**

```bash
npx vitest --run packages/memento-core/src/infrastructure/scheduler/jobs/__tests__/triple-extraction-batch-job-retry.spec.ts
```

- [x] **Step 3: pure validation/parser와 ordered candidate query를 구현한다** — config validation은 DB handle 접근 전,
retry metadata parser는 repair/default-on-corruption 없이 exclusion reason을 반환한다. selection은 active episodic +
consistent status/due를 먼저 적용하고 `created_at,id` 정렬 뒤 `batchSize`를 채운다. 상태 writer는 success/failed/
abandoned별 exact metadata object를 전체 교체하고 한 transition timestamp를 재사용한다.

- [x] **Step 4: GREEN을 확인한다**

```bash
npx vitest --run packages/memento-core/src/infrastructure/scheduler/jobs/__tests__/triple-extraction-batch-job-retry.spec.ts
```

- [ ] **Step 5: Lore commit**

```text
Select only due batch sources from a validated execution policy

Constraint: Invalid config must cause zero DB access and retry metadata is never repaired implicitly.
Rejected: Limit-before-filter and floored day arithmetic | starves due sources and shifts exact retry boundaries.
Confidence: high
Scope-risk: moderate
Directive: maxRetries includes the first genuine failure and abandoned metadata has no next-retry key.
Tested: focused batch policy, eligibility, due, and transition specs
Not-tested: Execute timing and result reconciliation follow in T017.
```

### T017 [TDD] [US3] batch execute timeout·fatal prefix·result/DB 격리

**Files:**
- Create: `packages/memento-core/src/infrastructure/scheduler/jobs/__tests__/triple-extraction-batch-job-contract.spec.ts`
- Modify: `packages/memento-core/src/infrastructure/scheduler/jobs/triple-extraction-batch-job.ts`
- Modify: `packages/memento-core/src/infrastructure/scheduler/jobs/triple-extraction-batch-job/triple-extraction-batch-job-chunk.ts`
- Modify: `packages/memento-core/src/infrastructure/scheduler/jobs/triple-extraction-batch-job/triple-extraction-batch-job.types.ts`
- Modify: `packages/memento-core/src/infrastructure/scheduler/jobs/__tests__/triple-extraction-batch-job.spec.ts`

**Requirements:** FR-088–FR-091, FR-095–FR-121; SC-084–SC-087, SC-091–SC-117

- [x] **Step 1: RED execute matrix를 작성한다** — execute-local policy/service/result, two DB handles, overlapping executes,
fresh Date/arrays/Map, consecutive chunk boundaries, capped delay, timeout before source only, last source late no timeout,
stale before extractor skipped, malformed extractor `llm_parse_fail`, source A success/B fail/C success isolation,
fatal durable-prefix preservation, retryCounts durable transitions only, semantic create/update occurrence sums,
all return-path count/timing/success invariants를 fake wall/monotonic clocks로 검증한다.

```ts
expect(result.processed).toBe(result.details.processed);
expect(result.details.processed).toBe(
  result.details.success + result.details.failed + result.details.skipped
);
expect(result.duration).toBe(result.endTime.getTime() - result.startTime.getTime());
```

- [x] **Step 2: RED를 확인한다**

```bash
npx vitest --run \
  packages/memento-core/src/infrastructure/scheduler/jobs/__tests__/triple-extraction-batch-job-contract.spec.ts \
  packages/memento-core/src/infrastructure/scheduler/jobs/__tests__/triple-extraction-batch-job.spec.ts
```

- [x] **Step 3: `execute()`를 호출-local 상태로 정리한다** — 시작 시 policy/wall/monotonic/result를 새로 만들고,
valid policy 뒤에만 schema ensure와 execute DB-bound semantic service 생성을 수행한다. fixed candidates를 consecutive
slice로 나눠 serial source loop에서 coordinator를 호출한다. timeout은 새 source/다음 chunk delay 시작만 막고,
fatal orchestration은 durable prefix만 남긴 채 중단한다. `finally` 반환 경계에서 end/duration/count invariants를
한 번 대사하며 warning 문자열로 timeout을 추론하지 않는다.

- [x] **Step 4: GREEN과 기존 batch 회귀를 확인한다**

```bash
npx vitest --run \
  packages/memento-core/src/infrastructure/scheduler/jobs/__tests__/triple-extraction-batch-job-retry.spec.ts \
  packages/memento-core/src/infrastructure/scheduler/jobs/__tests__/triple-extraction-batch-job-contract.spec.ts \
  packages/memento-core/src/infrastructure/scheduler/jobs/__tests__/triple-extraction-batch-job.spec.ts
```

- [ ] **Step 5: Lore commit**

```text
Return only durable source outcomes from isolated batch executions

Constraint: Existing batch result shape and source-level serial processing remain unchanged.
Rejected: Synthesizing failed outcomes for a fatal chunk remainder | no durable source transition exists.
Confidence: high
Scope-risk: broad
Directive: Every return path must reconcile processed counts and use execute-local DB-bound dependencies.
Tested: retry, batch contract, and existing triple extraction batch specs
Not-tested: Full core and repository gates are deferred to T020.
```

### T018 [REVIEW] [US3] User Story 3 checkpoint

- [x] Compare explicit tool, remember, and batch success/no-triple/pre-commit/post-commit/stale outcomes for semantic equivalence.
- [x] Verify direct `SemanticMemoryUpdateService` calls never write source conversion state.
- [x] Verify invalid batch config performs zero schema/service/query access.
- [x] Verify timeout/fatal tests never synthesize outcomes or retry counts for unstarted/unconfirmed sources.
- [x] Verify all public type snapshots and existing result fields are unchanged.

**Checkpoint**: 모든 user story가 구현·독립 검증 가능하며, 자동 진입점과 batch의 상태 의미가 수렴한다.

---

## Phase 6: Polish & Cross-Cutting Concerns

### T019 [P] [SUBAGENT] 합성·read-only 품질 분포 검증 리포트

**Files:**
- Create: `specs/066-semantic-confidence-importance/validation-report.md`

**Requirements:** FR-012, FR-016, FR-018, FR-063; SC-010, SC-012, SC-059

- [x] **Step 1: 합성 normal/canonicalization-failure/partial-link 표본을 focused spec 또는 read-only script invocation으로
실행해 confidence, accepted `>0.7`, rejected `<=0.7`, source importance, final importance를 category별 집계한다.**

- [x] **Step 2: 운영 DB 접근 권한이 있는 실행 환경에서는 copy 또는 read-only connection만 사용한다**

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

운영 DB에 저장되지 않는 canonicalization/link 중간 flag는 합성 검증 결과로만 분리 집계한다. 리포트에는 query 목적,
aggregate count, 실행 식별자/hash만 적고 raw memory/triple/content나 파생 corpus를 저장하지 않는다.

- [x] **Step 3: `validation-report.md`에 strict 0.7 선택 근거와 산식 대사를 기록한다**

```text
accepted: confidence > 0.7
rejected: confidence <= 0.7
base importance: episodic importance * aggregate confidence
reduction: episodic importance * (1 - aggregate confidence)
```

- [x] **Step 4: 유출 검사를 실행한다**

```bash
git diff -- specs/066-semantic-confidence-importance/validation-report.md
git status --short
```

Expected: 집계·식별자·hash와 합성 값만 존재하고 운영 원문/파생 표본 파일은 0개다.

### T020 품질·회귀·graphify 완료 게이트

**Files:** Verify all changed production/test/spec files; do not commit `graphify-out/`

- [x] **Step 1: focused 기능 검증**

```bash
npx vitest --run \
  packages/memento-core/src/domains/memory/semantic/semantic-memory-scoring.spec.ts \
  packages/memento-core/src/domains/memory/semantic/semantic-memory-quality-persistence.spec.ts \
  packages/memento-core/src/domains/memory/semantic/episodic-semantic-conversion.spec.ts \
  packages/memento-core/src/domains/memory/semantic/__tests__/convert-episodic-to-semantic-tool.spec.ts \
  packages/memento-core/src/domains/memory/remember/__tests__/remember-tool.spec.ts \
  packages/memento-core/src/infrastructure/scheduler/jobs/__tests__/triple-extraction-batch-job-retry.spec.ts \
  packages/memento-core/src/infrastructure/scheduler/jobs/__tests__/triple-extraction-batch-job-contract.spec.ts \
  packages/memento-core/src/infrastructure/scheduler/jobs/__tests__/triple-extraction-batch-job.spec.ts
```

- [x] **Step 2: integration/architecture 회귀**

```bash
npx vitest --run \
  packages/memento-core/src/infrastructure/scheduler/jobs/__tests__/arigraph-relation-engine-integration.spec.ts \
  packages/memento-core/src/domains/relation/services/triple-extraction/triple-extraction-service.spec.ts \
  packages/memento-core/src/test/architecture/dependency-boundaries.spec.ts
```

- [x] **Step 3: constitution quality gates**

```bash
npm run type-check -w @memento/core
npm run test:ci:core
npm run lint
npm run type-check
npm test
```

- [x] **Step 4: graphify rebuild와 report 확인**

```bash
python3 -c "from graphify.watch import _rebuild_code; from pathlib import Path; _rebuild_code(Path('.'))"
test -f graphify-out/GRAPH_REPORT.md
sed -n '1,220p' graphify-out/GRAPH_REPORT.md
```

Expected: 신규 dependency-boundary violation/cycle이 없고 `graphify-out/`은 commit 대상이 아니다.

- [x] **Step 5: 변경 범위와 금지 항목 확인**

```bash
git diff --check
git diff -- packages/memento-core/src/infrastructure/database/sqlite/schema.sql \
  packages/memento-core/src/infrastructure/database/sqlite/migration package.json package-lock.json
git status --short
```

Expected: whitespace 오류 0, schema/migration/dependency/public contract/raw data/unrelated refactor diff 0.

- [ ] **Step 6: 최종 Lore commit**

```text
Prevent low-confidence automatic triples from regaining search importance

Constraint: Existing schema, public contracts, and automatic failure codes remain stable.
Rejected: Backfill, new evidence tables, and global conversion locks | outside issue 805 and unnecessary for correctness.
Confidence: high
Scope-risk: broad
Directive: Re-run focused conversion and batch contracts before changing quality or retry semantics.
Tested: focused specs, core suite, repository test, lint, type-check, graphify report
Not-tested: Production write execution; distribution inspection was read-only.
```

**Checkpoint**: lint/type-check/tests/graphify가 모두 green이고 알려진 오류, 미정산 작업, 금지 diff가 0이면 완료다.

---

## Dependencies & Execution Order

### Phase Dependencies

```text
T001 baseline
  -> T002 scoring/snapshot quality logic
  -> T003 request/input snapshot
  -> T004 REVIEW
  -> T005 create persistence
  -> T006 post-commit settlement
  -> T007 REVIEW
  -> T008 candidate eligibility
  -> T009 atomic merge
  -> T010 coalescing
  -> T011 concurrency/re-evaluation
  -> T012 REVIEW
  -> T013 shared conversion coordinator
  -> T014 explicit tool ─┐
  -> T015 remember ──────┼-> T018 REVIEW
  -> T016 batch retry ───┤
     T013 + T016 -> T017 batch execute ┘
  -> T019 validation report
  -> T020 completion gates
```

- Phase 2는 모든 user story를 차단한다.
- User Story 1은 T005–T007 뒤 독립적으로 배포 가능한 MVP create path다.
- User Story 2는 T008–T012가 User Story 1 primary contracts를 확장한다.
- User Story 3의 T014, T015, T016은 T013 완료 뒤 서로 다른 파일에서 병렬 가능하다.
- T017은 coordinator(T013)와 batch policy/retry(T016)가 모두 필요하다.
- T019는 production code와 다른 파일이라 T018 뒤 T020 준비와 병렬 가능하지만, T020 최종 diff 확인 전에 끝나야 한다.
- `[REVIEW]` checkpoint가 승인되지 않으면 다음 phase를 시작하지 않는다.

### Parallel Dispatch Example

```text
After T013:
  executor A -> T014 explicit conversion tool
  executor B -> T015 remember augmentation
  executor C -> T016 batch policy/retry
After T016:
  executor D -> T017 batch execute contract
After T018:
  writer/explorer -> T019 aggregate-only validation report
```

같은 `semantic-memory-update-pipeline.ts`를 수정하는 T003/T005/T006/T008/T009/T010/T011/T013은 병렬화하지 않는다.

## Implementation Strategy

### MVP First

1. T001–T004로 pure quality와 trust boundary를 고정한다.
2. T005–T007로 신규 automatic semantic create path를 완성한다.
3. targeted tests에서 User Story 1만 독립 검증한다.

### Incremental Delivery

1. MVP create path → accepted/rejected quality persistence.
2. User Story 2 → exact/similar/coalesced/concurrent merge 품질 유지.
3. User Story 3 → shared source commit과 세 automatic entrypoint/batch 수렴.
4. T019–T020 → distribution evidence와 repository-wide completion gates.

## Requirement Traceability

| Requirement / outcome range | Primary tasks |
|---|---|
| FR-001–FR-009, SC-001–SC-006 | T002, T005, T009 |
| FR-010–FR-018, SC-007–SC-013 | T006, T009, T011, T019 |
| FR-019–FR-024, SC-014–SC-020 | T002, T005, T013–T015 |
| FR-025–FR-038, SC-021–SC-034 | T005, T008, T011 |
| FR-039–FR-052, SC-035–SC-048 | T008–T011 |
| FR-053–FR-061, SC-049–SC-057 | T002, T003, T008 |
| FR-062–FR-075, SC-058–SC-071 | T003, T006, T010 |
| FR-076–FR-087, SC-072–SC-083 | T011, T013–T015 |
| FR-088–FR-095, SC-084–SC-091 | T013, T016, T017 |
| FR-096–FR-105, SC-092–SC-101 | T016, T017 |
| FR-106–FR-114, SC-102–SC-110 | T016, T017 |
| FR-115–FR-121, SC-111–SC-117 | T016, T017 |

## Self-Review Checklist

- [ ] FR-001–FR-121과 SC-001–SC-117이 위 추적 표의 한 작업 이상에 연결된다.
- [ ] 공개 options/result/config/failure reason/schema 변경을 요구하는 작업이 없다.
- [ ] 모든 behavior change가 `[TDD]` 작업의 RED 명령과 GREEN 명령을 가진다.
- [ ] `[P]` 작업끼리 production/test write scope가 겹치지 않는다.
- [ ] source success는 semantic primary와 같은 commit이고 post-commit work는 transaction 밖이다.
- [ ] batch invalid config는 DB 접근 전 실패하고 모든 반환 count가 대사된다.
- [ ] operational/raw data를 commit하는 단계가 없고 validation report는 aggregate-only다.
- [ ] 최종 단계가 lint, core/full type-check, core/full tests, graphify, diff 검사를 모두 포함한다.
