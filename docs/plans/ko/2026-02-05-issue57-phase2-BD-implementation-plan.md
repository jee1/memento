# Issue #57 Phase 2 — B·D 구현 계획 (B → D 순서)

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Issue #57 Phase 2의 B(성능 최적화)와 D(다중 에이전트)를 순서대로 구현한다. B는 procedural 버전 인덱스 추가 + recall 프로파일링, D는 memory_item owner_id 추가 + remember/recall 소유자 지원.

**Architecture:** B는 마이그레이션 014(인덱스)와 recall-tool 내 프로파일 로깅으로 구성. D는 마이그레이션 015(owner_id), ToolContext.agentId, remember/remember_procedure/recall의 owner_id 파라미터·필터로 구성. 단일 에이전트 하위 호환(기본값/NULL) 유지.

**Tech Stack:** TypeScript, Vitest, better-sqlite3, 기존 마이그레이션 패턴(013 참고).

---

## Part 1: B) 성능 최적화

### Task B1: procedural 버전 인덱스 마이그레이션 스펙 작성

**Files:**
- Create: `src/infrastructure/database/database/migration/migrations/014-procedural-version-indexes.spec.ts`
- Reference: `src/infrastructure/database/database/migration/migrations/013-procedural-version-fields.spec.ts`

**Step 1: Write the failing test**

Given/When/Then 형식. Given: memory_item 테이블 존재(version, version_series_id 있음). When: 014 up 실행. Then: `idx_memory_item_procedural_version_series`, `idx_memory_item_procedural_version` 인덱스가 존재. When: down 실행. Then: 해당 인덱스가 제거됨.

**Step 2: Run test to verify it fails**

Run: `npm test -- src/infrastructure/database/database/migration/migrations/014-procedural-version-indexes.spec.ts -v`  
Expected: FAIL (migration file not found or test fails)

**Step 3: Commit**

```bash
git add src/infrastructure/database/database/migration/migrations/014-procedural-version-indexes.spec.ts
git commit -m "test: add 014 procedural version indexes migration spec"
```

---

### Task B2: procedural 버전 인덱스 마이그레이션 구현

**Files:**
- Create: `src/infrastructure/database/database/migration/migrations/014-procedural-version-indexes.ts`
- Reference: `src/infrastructure/database/database/migration/migrations/013-procedural-version-fields.ts` (columnExists, tableExists, validateBefore/after, up/down 패턴)

**Step 1: Implement migration**

- Partial index: `CREATE INDEX IF NOT EXISTS idx_memory_item_procedural_version_series ON memory_item(type, version_series_id) WHERE type = 'procedural';`
- Partial index: `CREATE INDEX IF NOT EXISTS idx_memory_item_procedural_version ON memory_item(type, version_series_id, version) WHERE type = 'procedural';`
- down: DROP INDEX IF EXISTS for both.
- validateBefore: memory_item 존재, version_series_id/version 컬럼 존재 확인.
- version = '14.0', name = 'procedural-version-indexes'.

**Step 2: Run test to verify it passes**

Run: `npm test -- src/infrastructure/database/database/migration/migrations/014-procedural-version-indexes.spec.ts -v`  
Expected: PASS

**Step 3: Sync schema.sql**

- Modify: `src/infrastructure/database/database/schema.sql` — memory_item 인덱스 섹션에 위 두 CREATE INDEX 추가(주석으로 014, Issue #57).

**Step 4: Commit**

```bash
git add src/infrastructure/database/database/migration/migrations/014-procedural-version-indexes.ts src/infrastructure/database/database/schema.sql
git commit -m "feat(db): add procedural version indexes (Issue #57 Phase 2 B)"
```

---

### Task B3: recall 프로파일링 환경 변수 및 로깅

**Files:**
- Modify: `src/domains/memory/tools/recall-tool.ts` (handle 시작/끝 시각, MEMENTO_RECALL_PROFILE 시 로그)
- Test: `src/domains/memory/tools/__tests__/recall-tool.spec.ts`

**Step 1: Write the failing test**

Given: MEMENTO_RECALL_PROFILE=1, recall 호출. When: handle 성공. Then: 로그에 recall_profile 관련 total_ms 또는 응답 메타에 _profile 포함 중 하나 검증(프로젝트 규칙에 따라 로그 스파이 또는 응답 필드 검사).

**Step 2: Run test to verify it fails**

Run: `npm test -- src/domains/memory/tools/__tests__/recall-tool.spec.ts -v` (해당 it만 실행)  
Expected: FAIL

**Step 3: Implement profiling**

- handle 시작 시 `const startMs = Date.now();`
- handle 성공 직전 `if (process.env.MEMENTO_RECALL_PROFILE === '1') { mcpLogger.logServer('info', 'recall_profile', { total_ms: Date.now() - startMs }); }` (또는 프로젝트 로거 이름에 맞게).
- 기존 응답 구조 변경 없이 로그만 추가.

**Step 4: Run test to verify it passes**

Run: `npm test -- src/domains/memory/tools/__tests__/recall-tool.spec.ts -v`  
Expected: PASS

**Step 5: Commit**

```bash
git add src/domains/memory/tools/recall-tool.ts src/domains/memory/tools/__tests__/recall-tool.spec.ts
git commit -m "feat(recall): add optional profiling via MEMENTO_RECALL_PROFILE (Issue #57 Phase 2 B)"
```

---

### Task B4: recall 성능 튜닝 문서 추가

**Files:**
- Create or Modify: `docs/recall-performance-tuning.md` (또는 기존 docs 하위 적절 파일에 절 추가)

**Step 1: Add short section**

- 환경 변수: MEMENTO_RECALL_PROFILE=1 시 total_ms 로깅.
- 인덱스: idx_memory_item_procedural_version_series, idx_memory_item_procedural_version (014) 설명.
- FTS5 사용 여부 참고.

**Step 2: Commit**

```bash
git add docs/recall-performance-tuning.md
git commit -m "docs: add recall performance tuning (Issue #57 Phase 2 B)"
```

---

## Part 2: D) 다중 에이전트

### Task D1: memory_item owner_id 마이그레이션 스펙 작성

**Files:**
- Create: `src/infrastructure/database/database/migration/migrations/015-memory-item-owner-id.spec.ts`
- Reference: `013-procedural-version-fields.spec.ts`, `014-procedural-version-indexes.spec.ts`

**Step 1: Write the failing test**

Given: memory_item 테이블 존재. When: 015 up 실행. Then: owner_id 컬럼 존재, idx_memory_item_owner_id 인덱스 존재. When: down 실행. Then: owner_id 컬럼 및 인덱스 제거.

**Step 2: Run test to verify it fails**

Run: `npm test -- src/infrastructure/database/database/migration/migrations/015-memory-item-owner-id.spec.ts -v`  
Expected: FAIL

**Step 3: Commit**

```bash
git add src/infrastructure/database/database/migration/migrations/015-memory-item-owner-id.spec.ts
git commit -m "test: add 015 memory_item owner_id migration spec"
```

---

### Task D2: memory_item owner_id 마이그레이션 구현

**Files:**
- Create: `src/infrastructure/database/database/migration/migrations/015-memory-item-owner-id.ts`
- Modify: `src/infrastructure/database/database/schema.sql`

**Step 1: Implement migration**

- up: ALTER TABLE memory_item ADD COLUMN owner_id TEXT NULL; CREATE INDEX IF NOT EXISTS idx_memory_item_owner_id ON memory_item(owner_id);
- down: DROP INDEX IF EXISTS idx_memory_item_owner_id; (SQLite 3.35+면 DROP COLUMN, 아니면 프로젝트 기존 규칙 따름)
- version = '15.0', name = 'memory-item-owner-id'.
- validateBefore: memory_item 존재. validateAfter: owner_id 컬럼 및 인덱스 존재.

**Step 2: Run test**

Run: `npm test -- src/infrastructure/database/database/migration/migrations/015-memory-item-owner-id.spec.ts -v`  
Expected: PASS

**Step 3: Sync schema.sql**

- memory_item 정의에 owner_id TEXT NULL 추가. 인덱스 섹션에 idx_memory_item_owner_id 추가.

**Step 4: Commit**

```bash
git add src/infrastructure/database/database/migration/migrations/015-memory-item-owner-id.ts src/infrastructure/database/database/schema.sql
git commit -m "feat(db): add memory_item owner_id for multi-agent (Issue #57 Phase 2 D)"
```

---

### Task D3: ToolContext에 agentId 추가

**Files:**
- Modify: `src/tools/types.ts` — ToolContext 인터페이스에 `agentId?: string` 추가 (주석: 다중 에이전트 시 소유자 식별자, 미설정 시 기본값 사용).

**Step 1: Add field**

```ts
/** 다중 에이전트 시 현재 에이전트/소유자 식별자 (미설정 시 remember/recall 기본값 사용) */
agentId?: string;
```

**Step 2: Run type-check and tests**

Run: `npm run type-check` and `npm test -- src/tools/ -v`  
Expected: PASS

**Step 3: Commit**

```bash
git add src/tools/types.ts
git commit -m "feat(tools): add ToolContext.agentId for multi-agent (Issue #57 Phase 2 D)"
```

---

### Task D4: remember/remember_procedure에 owner_id 저장

**Files:**
- Modify: `src/domains/memory/tools/remember-tool.ts` — 스키마에 owner_id optional 추가, INSERT/UPDATE 시 owner_id = params.owner_id ?? context.agentId ?? null.
- Modify: `src/domains/memory/tools/remember-procedure-tool.ts` — 동일 (params.owner_id ?? context.agentId ?? null).
- Modify: `src/shared/types/index.ts` 또는 MemoryItem 관련 타입에 owner_id?: string | null 추가.
- Test: remember-tool.spec.ts, remember-procedure-tool.spec.ts — owner_id 저장 검증 테스트 추가.

**Step 1: Write failing tests**

Given: owner_id 또는 context.agentId 제공. When: remember/remember_procedure 호출. Then: memory_item 행에 owner_id가 설정됨.

**Step 2: Implement**

- remember-tool: inputSchema에 owner_id optional. DB INSERT/UPDATE 컬럼에 owner_id 추가. context.agentId 사용.
- remember-procedure-tool: 동일. RememberTool에 위임하는 경우 params에 owner_id/agentId 전달.
- 공유 타입 MemoryItem에 owner_id 추가. schema.sql은 이미 015에서 추가됨.

**Step 3: Run tests**

Run: `npm test -- src/domains/memory/tools/__tests__/remember-tool.spec.ts src/domains/memory/tools/__tests__/remember-procedure-tool.spec.ts -v`  
Expected: PASS

**Step 4: Commit**

```bash
git add src/domains/memory/tools/remember-tool.ts src/domains/memory/tools/remember-procedure-tool.ts src/shared/types/index.ts src/domains/memory/tools/__tests__/remember-tool.spec.ts src/domains/memory/tools/__tests__/remember-procedure-tool.spec.ts
git commit -m "feat(remember): persist owner_id from params or context.agentId (Issue #57 Phase 2 D)"
```

---

### Task D5: recall에 owner_id 필터 적용

**Files:**
- Modify: `src/domains/memory/tools/recall-tool.ts` — inputSchema에 owner_id optional (string 또는 array). 검색 필터/후처리에서 owner_id 조건 적용 (SQL 또는 결과 필터).
- Modify: `src/domains/search/` — 검색 엔진/리포지토리에서 owner_id 조건 전달 가능하도록 (필요 시 파라미터 추가).
- Test: recall-tool.spec.ts — owner_id 필터 시 해당 행만 반환하는 테스트 추가.

**Step 1: Write failing test**

Given: memory_item에 owner_id가 서로 다른 행 2개. When: recall with owner_id='agent-a'. Then: agent-a 소유만 반환.

**Step 2: Implement**

- recall 스키마: owner_id: z.union([z.string(), z.array(z.string())]).optional().
- 검색 시: searchEngine/hybridSearchEngine 호출 전에 owner_id를 필터로 전달하거나, recall이 검색 결과를 가져온 뒤 owner_id로 필터링. (검색 레이어에서 WHERE owner_id = ? 지원하려면 search-engine 등에 필터 추가 필요. 최소 구현은 recall 쪽에서 결과 후필터로 적용 가능.)
- 결과 후필터: searchItems.filter(i => !ownerIdFilter || matchOwner(i, ownerIdFilter)).

**Step 3: Run tests**

Run: `npm test -- src/domains/memory/tools/__tests__/recall-tool.spec.ts -v`  
Expected: PASS

**Step 4: Commit**

```bash
git add src/domains/memory/tools/recall-tool.ts src/domains/memory/tools/__tests__/recall-tool.spec.ts
git commit -m "feat(recall): filter by owner_id for multi-agent (Issue #57 Phase 2 D)"
```

---

### Task D6: 다중 에이전트 사용 가이드 문서

**Files:**
- Create: `docs/multi-agent-usage.md` (또는 기존 docs에 절 추가)

**Step 1: Add short guide**

- owner_id 의미, 기본값(NULL/'default'), remember/recall에서의 사용법. context.agentId 설정 방법(향후 HTTP/MCP에서 채울 수 있음) 언급.

**Step 2: Commit**

```bash
git add docs/multi-agent-usage.md
git commit -m "docs: add multi-agent usage guide (Issue #57 Phase 2 D)"
```

---

## 로드맵 문서 업데이트

**Files:**
- Modify: `docs/plans/2026-02-05-issue57-phase2-roadmap.md`

**Step 1:** 3단계 B, 4단계 D 행에 설계·구현 문서 링크 및 "(진행/완료)" 표기 추가.

**Step 2: Commit**

```bash
git add docs/plans/2026-02-05-issue57-phase2-roadmap.md
git commit -m "docs: update Issue #57 roadmap with B and D design/plan links"
```

---

## 실행 옵션

계획 저장 완료. 두 가지 실행 방법:

1. **Subagent-Driven (이번 세션)** — 작업별로 서브에이전트를 두고, 작업 사이에 리뷰하며 진행. 빠른 반복에 유리.
2. **별도 세션 (Parallel Session)** — 새 세션을 열고 `executing-plans` 스킬로 체크포인트 단위 배치 실행.

어떤 방식으로 진행할까요?
