# Procedural Memory 고급 버전 관리 구현 계획

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** memory_item에 version·version_series_id를 추가하고, diff 조회·rollback·recall 버전/비교 옵션을 제공하여 Issue #57 Phase 2 1단계(A)를 구현한다.

**Architecture:** 스키마에 version(INTEGER), version_series_id(TEXT) 추가. 버전 부여/조회는 procedural-versioning 모듈, diff는 procedural-memory-diff, rollback은 procedural-rollback-service가 담당. remember/reflexion-worker는 procedural 생성·versioned 시 해당 필드 설정. MCP 툴 procedural_diff·procedural_rollback 노출. recall은 version_filter·include_version_chain·include_diff_with 파라미터로 후처리.

**Tech Stack:** TypeScript, Vitest, better-sqlite3, 기존 memory_item·memory_link·SearchEngine·RecallTool.

**참고 설계:** `docs/plans/2026-02-05-procedural-version-management-design.md`

---

## Task 1: 공용 타입 정의 (ProceduralDiffResult, VersionChainItem, VersionFilter)

**Files:**
- Create: `src/shared/types/procedural-versioning.ts`
- Modify: `src/shared/types/index.ts` (re-export)
- Test: `src/shared/types/__tests__/procedural-versioning.spec.ts` (타입 존재·호환 검증, 선택)

**Step 1: 타입 파일 생성**

`src/shared/types/procedural-versioning.ts` 생성:

```typescript
/**
 * Procedural Memory 버전/비교 관련 공용 타입 (Issue #57 Phase 2)
 */

/** 필드별 문자열 diff (workflow_name, skill_name, task_goal, trigger_conditions) */
export interface FieldDiff {
  left: string | null;
  right: string | null;
  equal: boolean;
}

/** steps 배열 항목별 변경 유형 */
export type StepChangeType = 'same' | 'added' | 'removed' | 'modified';

export interface StepsDiffItem {
  index: number;
  left?: string | null;
  right?: string | null;
  change: StepChangeType;
}

export interface ProceduralDiffResult {
  left_id: string;
  right_id: string;
  workflow_name: FieldDiff;
  skill_name: FieldDiff;
  task_goal: FieldDiff;
  trigger_conditions: FieldDiff;
  steps: StepsDiffItem[];
}

export interface VersionChainItem {
  id: string;
  version: number;
  created_at: string;
}

/** recall version_filter 값 */
export type VersionFilterType = 'latest_only' | 'all_versions' | 'specific_version';
```

**Step 2: index.ts에서 re-export**

`src/shared/types/index.ts`에 추가:

```typescript
export type {
  FieldDiff,
  StepsDiffItem,
  StepChangeType,
  ProceduralDiffResult,
  VersionChainItem,
  VersionFilterType
} from './procedural-versioning.js';
```

**Step 3: type-check**

Run: `npm run type-check`  
Expected: PASS

**Step 4: Commit**

```bash
git add src/shared/types/procedural-versioning.ts src/shared/types/index.ts
git commit -m "feat(procedural): add ProceduralDiffResult, VersionChainItem, VersionFilterType"
```

---

## Task 2: 마이그레이션 013 — memory_item에 version, version_series_id 추가

**Files:**
- Create: `src/infrastructure/database/database/migration/migrations/013-procedural-version-fields.ts`
- Create: `src/infrastructure/database/database/migration/migrations/013-procedural-version-fields.spec.ts`

마이그레이션은 `MigrationDetector`가 `migrations/` 디렉터리에서 파일명 순으로 자동 감지하므로 별도 등록 불필요.

**Step 1: 실패하는 테스트 작성**

013-procedural-version-fields.spec.ts에서: Given 빈 DB, When 013 마이그레이션 실행, Then memory_item에 version, version_series_id 컬럼 존재. Given 기존 procedural 행과 version_of 체인, When 013 실행, Then backfill으로 version 1,2,3… 및 version_series_id 설정됨.

**Step 2: Run test to verify it fails**

Run: `npm test -- src/infrastructure/database/database/migration/migrations/013-procedural-version-fields.spec.ts`  
Expected: FAIL (파일/마이그레이션 없음)

**Step 3: 마이그레이션 구현**

- 013 클래스: version '8.0' 또는 기존 버전 체계에 맞는 버전. up()에서 memory_item에 `version INTEGER NULL`, `version_series_id TEXT NULL` 추가(ALTER TABLE). backfill: type='procedural'인 행에 version=1, version_series_id=id. version_of 체인이 있으면 source_id 기준으로 체인 순서 계산 후 1,2,3… 부여 및 동일 version_series_id 부여(체인 루트 id를 version_series_id로 사용).
**Step 4: Run test to verify it passes**

Run: `npm test -- src/infrastructure/database/database/migration/migrations/013-procedural-version-fields.spec.ts`  
Expected: PASS

**Step 5: Commit**

```bash
git add src/infrastructure/database/database/migration/migrations/013-procedural-version-fields.ts
git add src/infrastructure/database/database/migration/migrations/013-procedural-version-fields.spec.ts
git commit -m "feat(db): migration 013 add version, version_series_id to memory_item"
```

---

## Task 3: schema.sql 동기 반영

**Files:**
- Modify: `src/infrastructure/database/database/schema.sql`

**Step 1: memory_item 테이블 정의에 컬럼 추가**

memory_item CREATE 문에 다음 컬럼 추가 (trigger_conditions 다음):

```sql
  version INTEGER NULL,
  version_series_id TEXT NULL
```

**Step 2: type-check 및 lint**

Run: `npm run type-check`  
Expected: PASS

**Step 3: Commit**

```bash
git add src/infrastructure/database/database/schema.sql
git commit -m "chore(schema): add version, version_series_id to memory_item in schema.sql"
```

---

## Task 4: procedural-versioning 모듈 (버전 부여·조회)

**Files:**
- Create: `src/domains/memory/services/procedural-versioning.ts`
- Test: `src/domains/memory/services/__tests__/procedural-versioning.spec.ts`

**Step 1: 실패하는 테스트 작성**

- Given: 메모리 id와 db. When: getVersionChain(db, id). Then: VersionChainItem[] 반환(또는 빈 배열).  
- Given: version_series_id와 db. When: getLatestVersionInSeries(db, seriesId). Then: 해당 시리즈 중 version 최대인 메모리 1건 반환.  
- Given: 이전 버전 메모리 행(version, version_series_id 있음). When: getNextVersionNumber(db, version_series_id). Then: 이전 version + 1.

**Step 2: Run test to verify it fails**

Run: `npm test -- src/domains/memory/services/__tests__/procedural-versioning.spec.ts`  
Expected: FAIL

**Step 3: procedural-versioning.ts 구현**

- getVersionChain(db, memoryId): memory_link에서 relation_type='version_of'인 관계로 target_id 따라가며 체인 구성 후, memory_item에서 id·version·created_at 조회해 VersionChainItem[] 반환(현재 id를 포함한 “버전 목록”).  
- getLatestVersionInSeries(db, version_series_id): memory_item에서 version_series_id=? AND type='procedural' ORDER BY version DESC LIMIT 1.  
- getNextVersionNumber(db, version_series_id): 해당 시리즈의 MAX(version)+1 반환, 없으면 1.

**Step 4: Run test to verify it passes**

Run: `npm test -- src/domains/memory/services/__tests__/procedural-versioning.spec.ts`  
Expected: PASS

**Step 5: Commit**

```bash
git add src/domains/memory/services/procedural-versioning.ts
git add src/domains/memory/services/__tests__/procedural-versioning.spec.ts
git commit -m "feat(procedural): add procedural-versioning service (getVersionChain, getLatestVersionInSeries, getNextVersionNumber)"
```

---

## Task 5: procedural-memory-diff (구조화 diff 계산)

**Files:**
- Create: `src/domains/memory/services/procedural-memory-diff.ts`
- Test: `src/domains/memory/services/__tests__/procedural-memory-diff.spec.ts`

**Step 1: 실패하는 테스트 작성**

- Given: 두 procedural 메모리 id(left_id, right_id)와 db. When: computeProceduralDiff(db, left_id, right_id). Then: ProceduralDiffResult 반환(workflow_name, skill_name, task_goal, trigger_conditions는 FieldDiff, steps는 StepsDiffItem[]).  
- Given: 존재하지 않는 id. When: computeProceduralDiff. Then: null 또는 throw(에러 정책에 따라).  
- Given: 한쪽이 type !== 'procedural'. When: computeProceduralDiff. Then: null 또는 throw.

**Step 2: Run test to verify it fails**

Run: `npm test -- src/domains/memory/services/__tests__/procedural-memory-diff.spec.ts`  
Expected: FAIL

**Step 3: procedural-memory-diff.ts 구현**

- DB에서 left_id, right_id에 해당하는 memory_item 행 조회(type, workflow_name, skill_name, task_goal, trigger_conditions, steps).  
- type !== 'procedural' 또는 행 없으면 null 반환(또는 에러).  
- 문자열 필드는 FieldDiff { left, right, equal }.  
- steps는 JSON 배열 파싱 후 인덱스 기준으로 비교해 StepsDiffItem[] 생성(change: same|added|removed|modified).

**Step 4: Run test to verify it passes**

Run: `npm test -- src/domains/memory/services/__tests__/procedural-memory-diff.spec.ts`  
Expected: PASS

**Step 5: Commit**

```bash
git add src/domains/memory/services/procedural-memory-diff.ts
git add src/domains/memory/services/__tests__/procedural-memory-diff.spec.ts
git commit -m "feat(procedural): add procedural-memory-diff (computeProceduralDiff)"
```

---

## Task 6: procedural-rollback-service (이전 버전 내용으로 새 버전 생성)

**Files:**
- Create: `src/domains/memory/services/procedural-rollback-service.ts`
- Test: `src/domains/memory/services/__tests__/procedural-rollback-service.spec.ts`

**Step 1: 실패하는 테스트 작성**

- Given: 현재 메모리 id, 되돌릴 버전 id, db. When: rollbackToVersion(db, currentId, targetVersionId). Then: 새 memory_item 생성되고 version=현재최신+1, version_series_id 동일, memory_link에 (새 id, targetVersionId, 'version_of') 삽입, 새 id 반환.  
- Given: targetVersionId가 같은 version_series가 아님. When: rollbackToVersion. Then: throw 또는 에러 반환.

**Step 2: Run test to verify it fails**

Run: `npm test -- src/domains/memory/services/__tests__/procedural-rollback-service.spec.ts`  
Expected: FAIL

**Step 3: procedural-rollback-service.ts 구현**

- targetVersionId로 memory_item 조회, type=procedural 및 version_series_id 확인. currentId(또는 current의 version_series_id)와 동일한지 검증.  
- target 버전의 content, workflow_name, skill_name, steps, trigger_conditions, task_goal 등으로 새 행 삽입(id=uuid 등), version=getNextVersionNumber(db, version_series_id), version_series_id=기존 시리즈.  
- memory_link에 (source_id=새 id, target_id=targetVersionId, relation_type='version_of') 삽입.  
- 임베딩/기타 부가 데이터는 기존 remember 경로와 동일하게 처리할지 정책 결정(최소 구현 시 임베딩은 별도 서비스에서 나중에 채울 수 있음).

**Step 4: Run test to verify it passes**

Run: `npm test -- src/domains/memory/services/__tests__/procedural-rollback-service.spec.ts`  
Expected: PASS

**Step 5: Commit**

```bash
git add src/domains/memory/services/procedural-rollback-service.ts
git add src/domains/memory/services/__tests__/procedural-rollback-service.spec.ts
git commit -m "feat(procedural): add procedural-rollback-service (rollbackToVersion)"
```

---

## Task 7: RememberTool·ReflexionWorker — procedural 생성 시 version·version_series_id 설정

**Files:**
- Modify: `src/domains/memory/tools/remember-tool.ts` (procedural 삽입 시 version=1, version_series_id=id; versioned 모드 시 기존 메모리 조회 후 version+1, version_series_id 유지)
- Modify: `src/infrastructure/reflexion-worker.ts` (updateProceduralMemory·새 메모리 생성 시 동일 로직)
- Test: 기존 remember-tool.spec.ts, reflexion-worker.spec.ts에 version·version_series_id 검증 추가

**Step 1: 실패하는 테스트 추가**

remember-tool: type=procedural로 신규 저장 시 반환된 메모리에 version=1, version_series_id=해당 id(또는 id와 동일). versioned 모드로 두 번째 저장 시 새 행에 version=2, version_series_id=첫 번째와 동일.

**Step 2: Run test to verify it fails**

Run: `npm test -- src/domains/memory/tools/__tests__/remember-tool.spec.ts -t "version"`  
Expected: FAIL 또는 새 assertion 실패

**Step 3: RememberTool 수정**

- INSERT memory_item 시 type='procedural'이면 version=1, version_series_id=생성된 id.  
- versioned 모드로 기존 메모리 있으면, 새 행에 version = getNextVersionNumber(db, existing.version_series_id), version_series_id = existing.version_series_id.

**Step 4: ReflexionWorker 수정**

- updateProceduralMemory 내 versioned 분기에서 새 메모리 생성 시 동일하게 version, version_series_id 설정. (이미 version_of 링크 생성하는 부분 있음, 그 근처에서 컬럼 값 설정.)

**Step 5: Run test to verify it passes**

Run: `npm test -- src/domains/memory/tools/__tests__/remember-tool.spec.ts` 및 reflexion-worker.spec.ts 관련 케이스  
Expected: PASS

**Step 6: Commit**

```bash
git add src/domains/memory/tools/remember-tool.ts src/infrastructure/reflexion-worker.ts
git add src/domains/memory/tools/__tests__/remember-tool.spec.ts src/infrastructure/reflexion-worker.spec.ts
git commit -m "feat(procedural): set version and version_series_id in RememberTool and ReflexionWorker"
```

---

## Task 8: MCP 툴 procedural_diff

**Files:**
- Create: `src/domains/memory/tools/procedural-diff-tool.ts`
- Test: `src/domains/memory/tools/__tests__/procedural-diff-tool.spec.ts`
- Modify: `src/tools/index.ts` (coreTools에 ProceduralDiffTool 추가)

**Step 1: 실패하는 테스트 작성**

- Given: left_id, right_id, context(db). When: ProceduralDiffTool.handle({ left_id, right_id }, context). Then: content에 ProceduralDiffResult 형태 포함.  
- Given: 잘못된 id. When: handle. Then: 적절한 에러 메시지(400).

**Step 2: Run test to verify it fails**

Run: `npm test -- src/domains/memory/tools/__tests__/procedural-diff-tool.spec.ts`  
Expected: FAIL

**Step 3: procedural-diff-tool.ts 구현**

- BaseTool 상속, getDefinition()에서 name: 'procedural_diff', description, arguments: { left_id, right_id } (string, required).  
- handle에서 context.services.db 또는 context.db로 computeProceduralDiff 호출. null이면 400 에러. 결과를 ToolResult로 반환.

**Step 4: tools/index.ts에 등록**

coreTools 배열에 `new ProceduralDiffTool()` 추가.

**Step 5: Run test to verify it passes**

Run: `npm test -- src/domains/memory/tools/__tests__/procedural-diff-tool.spec.ts`  
Expected: PASS

**Step 6: Commit**

```bash
git add src/domains/memory/tools/procedural-diff-tool.ts
git add src/domains/memory/tools/__tests__/procedural-diff-tool.spec.ts
git add src/tools/index.ts
git commit -m "feat(mcp): add procedural_diff tool"
```

---

## Task 9: MCP 툴 procedural_rollback

**Files:**
- Create: `src/domains/memory/tools/procedural-rollback-tool.ts`
- Test: `src/domains/memory/tools/__tests__/procedural-rollback-tool.spec.ts`
- Modify: `src/tools/index.ts` (coreTools에 ProceduralRollbackTool 추가)

**Step 1: 실패하는 테스트 작성**

- Given: current_id, target_version_id, context. When: ProceduralRollbackTool.handle({ current_id, target_version_id }, context). Then: 새 메모리 id 반환, DB에 해당 행 및 version_of 링크 존재.  
- Given: target가 다른 시리즈. When: handle. Then: 400 에러.

**Step 2: Run test to verify it fails**

Run: `npm test -- src/domains/memory/tools/__tests__/procedural-rollback-tool.spec.ts`  
Expected: FAIL

**Step 3: procedural-rollback-tool.ts 구현**

- name: 'procedural_rollback', arguments: current_id, target_version_id.  
- handle에서 proceduralRollbackService.rollbackToVersion(db, current_id, target_version_id) 호출, 반환된 새 id를 결과에 포함.

**Step 4: tools/index.ts에 등록**

coreTools에 `new ProceduralRollbackTool()` 추가.

**Step 5: Run test to verify it passes**

Run: `npm test -- src/domains/memory/tools/__tests__/procedural-rollback-tool.spec.ts`  
Expected: PASS

**Step 6: Commit**

```bash
git add src/domains/memory/tools/procedural-rollback-tool.ts
git add src/domains/memory/tools/__tests__/procedural-rollback-tool.spec.ts
git add src/tools/index.ts
git commit -m "feat(mcp): add procedural_rollback tool"
```

---

## Task 10: MemorySearchFilters·RecallParams·MemorySearchResult에 version 관련 필드 추가

**Files:**
- Modify: `src/shared/types/index.ts`

**Step 1: MemorySearchFilters 확장**

MemorySearchFilters에 추가:

```typescript
  version_filter?: VersionFilterType;
  version_series_id?: string;
  version_number?: number;
  include_version_chain?: boolean;
  include_diff_with?: 'previous' | string; // id
```

**Step 2: RecallParams 확장**

RecallParams에 동일 필드 추가(또는 filters 안에 포함).

**Step 3: MemorySearchResult 확장**

MemorySearchResult에 추가:

```typescript
  version?: number;
  version_series_id?: string | null;
  version_chain?: VersionChainItem[];
  diff_with_previous?: ProceduralDiffResult | null;
  diff_with?: ProceduralDiffResult | null;
```

**Step 4: type-check**

Run: `npm run type-check`  
Expected: PASS

**Step 5: Commit**

```bash
git add src/shared/types/index.ts
git commit -m "feat(recall): add version_filter, include_version_chain, include_diff_with to filters and result types"
```

---

## Task 11: SearchEngine — procedural 검색 시 version_filter 적용

**Files:**
- Modify: `src/domains/search/algorithms/search-engine.ts` (또는 recall 결과 후처리 레이어)
- Modify: `src/domains/memory/tools/recall-tool.ts`

**설계 선택:** version_filter=latest_only는 “시리즈당 최신 1건만”이므로, 검색 결과를 받은 뒤 애플리케이션 레이어에서 version_series_id별로 최신만 남기는 것이 구현이 단순함. SearchEngine에서 SQL로 시리즈당 최대 version만 조회하도록 할 수도 있음(서브쿼리 또는 윈도우 함수).

**Step 1: 실패하는 테스트 추가**

recall-tool.spec.ts: type=procedural, version_filter=latest_only, 동일 시리즈 2건이 DB에 있을 때 결과 1건만 반환(최신).

**Step 2: Run test to verify it fails**

Run: `npm test -- src/domains/memory/tools/__tests__/recall-tool.spec.ts -t "version_filter"`  
Expected: FAIL

**Step 3: RecallTool 수정**

- params.version_filter, version_series_id, version_number, include_version_chain, include_diff_with를 MemorySearchFilters에 전달.  
- 검색 결과가 오면 type=procedural인 항목에 대해:  
  - version_filter=latest_only: version_series_id별로 그룹핑 후 각 그룹에서 version 최대인 1건만 유지.  
  - version_filter=specific_version: version_series_id+version_number 또는 id로 필터.  
  - include_version_chain=true: procedural-versioning.getVersionChain으로 version_chain 채움.  
  - include_diff_with: 'previous'면 직전 버전과 computeProceduralDiff, id면 해당 id와 computeProceduralDiff 후 diff_with_previous 또는 diff_with 필드에 할당.

**Step 4: SearchEngine 수정 (필요 시)**

memory_item 조회 시 version, version_series_id 컬럼을 SELECT에 포함. (이미 전체 행을 가져오면 자동 포함 가능.)

**Step 5: Run test to verify it passes**

Run: `npm test -- src/domains/memory/tools/__tests__/recall-tool.spec.ts`  
Expected: PASS

**Step 6: Commit**

```bash
git add src/domains/search/algorithms/search-engine.ts
git add src/domains/memory/tools/recall-tool.ts
git add src/domains/memory/tools/__tests__/recall-tool.spec.ts
git commit -m "feat(recall): apply version_filter, include_version_chain, include_diff_with in recall"
```

---

## Task 12: recall 툴 스키마에 version 파라미터 추가 (MCP 스키마)

**Files:**
- Modify: `src/domains/memory/tools/recall-tool.ts` (getDefinition 내 inputSchema.properties에 version_filter, version_series_id, version_number, include_version_chain, include_diff_with 추가)
- Modify: MCP descriptor (mcps/user-memento/tools/recall.json) — 수동 또는 빌드로 반영

**Step 1: recall-tool getDefinition에 속성 추가**

properties에 version_filter (enum: latest_only, all_versions, specific_version), version_series_id (string), version_number (number), include_version_chain (boolean), include_diff_with (string, description에 'previous' 또는 메모리 id 설명).

**Step 2: mcps/user-memento/tools/recall.json 업데이트**

동일한 인자 추가(프로젝트에서 MCP 디스크립터를 수동 유지하는 경우).

**Step 3: Commit**

```bash
git add src/domains/memory/tools/recall-tool.ts
# optional: mcps/user-memento/tools/recall.json
git commit -m "feat(recall): add version_filter, include_version_chain, include_diff_with to recall tool schema"
```

---

## Task 13: 통합 검증 및 문서

**Files:**
- Modify: `docs/plans/2026-02-05-procedural-version-management-design.md` (구현 완료 노트 추가, 선택)

**Step 1: 전체 테스트 실행**

Run: `npm test`  
Expected: PASS

**Step 2: lint**

Run: `npm run lint -- --fix`  
Expected: PASS

**Step 3: type-check**

Run: `npm run type-check`  
Expected: PASS

**Step 4: 설계 문서에 구현 완료 노트 (선택)**

설계 문서 하단에 "구현 완료: 2026-02-05, 구현 계획: 2026-02-05-procedural-version-management-implementation-plan.md" 추가.

**Step 5: Commit**

```bash
git add docs/plans/2026-02-05-procedural-version-management-design.md
git commit -m "docs: mark procedural version management implementation complete"
```

---

## 체크리스트 (실행 시 확인)

- [ ] Task 1: ProceduralDiffResult, VersionChainItem, VersionFilterType 타입 정의 및 export
- [ ] Task 2: 마이그레이션 013 적용, backfill 포함
- [ ] Task 3: schema.sql에 version, version_series_id 반영
- [ ] Task 4: procedural-versioning (getVersionChain, getLatestVersionInSeries, getNextVersionNumber)
- [ ] Task 5: procedural-memory-diff (computeProceduralDiff)
- [ ] Task 6: procedural-rollback-service (rollbackToVersion)
- [ ] Task 7: RememberTool·ReflexionWorker에서 version·version_series_id 설정
- [ ] Task 8: procedural_diff MCP 툴
- [ ] Task 9: procedural_rollback MCP 툴
- [ ] Task 10: MemorySearchFilters·RecallParams·MemorySearchResult 확장
- [ ] Task 11: recall에서 version_filter·include_version_chain·include_diff_with 적용
- [ ] Task 12: recall 툴 스키마에 version 파라미터 추가
- [ ] Task 13: 전체 lint·test·type-check 통과

---

## 실행 옵션

**계획 저장 위치:** `docs/plans/2026-02-05-procedural-version-management-implementation-plan.md`

**실행 방법 두 가지:**

1. **서브에이전트 주도(이 세션)** — 태스크마다 서브에이전트를 호출하고 태스크 간 코드 리뷰하며 진행.
2. **별도 세션(병렬)** — worktree에서 새 세션을 열고 executing-plans 스킬로 체크포인트 단위 배치 실행.

원하시는 방식을 알려주시면 그에 맞춰 진행하겠습니다.
