# Issue #91: Process Attribute recall 스코어링 고도화 — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** process(에이전트)별 주제/속성을 저장하고, recall 시 (query 유사도) × (process-attribute 적합도) 스코어링으로 회수 품질을 높인다.

**Architecture:** process_attribute 전용 테이블로 process_id별 topics/domain 속성(workflow_names, skill_names) 저장. recall 시 filters.process_id가 있으면 해당 process의 속성을 조회하고, 각 검색 결과 메모리와의 적합도(0~1)를 계산해 SearchRanking의 기존 다차원 랭킹에 가중치(θ)로 반영한다. procedural의 workflow_name/skill_name과 네이밍·저장 위치를 맞춘다.

**Tech Stack:** TypeScript, better-sqlite3, 기존 SearchRanking / HybridSearchEngine / recall-tool.

**선행 조건:** #87 Attribution 반영 완료(process_id, session_id 존재). migration 016·019 적용 상태 가정.

---

## Task 1: process_attribute 스키마 및 마이그레이션

**Files:**
- Create: `src/infrastructure/database/database/migration/migrations/020-process-attribute-table.ts`
- Create: `src/infrastructure/database/database/migration/migrations/020-process-attribute-table.spec.ts`
- Modify: `src/infrastructure/database/database/schema.sql` (process_attribute 테이블 정의 추가)
- 마이그레이션은 `migration-detector.ts`가 `migrations/` 디렉터리에서 `.ts`/`.js` 파일을 자동 감지하므로 020 파일 추가만 하면 됨.

**Step 1: Write the failing test**

`020-process-attribute-table.spec.ts`에서:
- Given: 마이그레이션 019까지 적용된 DB
- When: 020 up 실행
- Then: `process_attribute` 테이블 존재, 컬럼 `process_id` (TEXT PK), `topics` (TEXT NULL, JSON array), `workflow_names` (TEXT NULL, JSON array), `skill_names` (TEXT NULL, JSON array), `created_at`, `updated_at`
- When: down 실행 후 process_attribute 테이블 없음

**Step 2: Run test to verify it fails**

Run: `npm test -- src/infrastructure/database/database/migration/migrations/020-process-attribute-table.spec.ts -v`  
Expected: FAIL (migration 020 not found or table not created)

**Step 3: Implement migration 020**

- `020-process-attribute-table.ts`: Migration class, version '20.0', name 'process-attribute-table'. up: CREATE TABLE process_attribute (process_id TEXT PRIMARY KEY, topics TEXT NULL, workflow_names TEXT NULL, skill_names TEXT NULL, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))). down: DROP TABLE IF EXISTS process_attribute.
- `schema.sql`: 동일 CREATE TABLE 추가 (기존 테이블 정의 블록 근처).
- 마이그레이션 인덱스/등록: 프로젝트의 마이그레이션 로더(예: `migrations/index.ts` 또는 run-migrations에서 파일명 순 로드)에 020이 포함되도록 확인.

**Step 4: Run test to verify it passes**

Run: `npm test -- src/infrastructure/database/database/migration/migrations/020-process-attribute-table.spec.ts -v`  
Expected: PASS

**Step 5: Commit**

```bash
git add src/infrastructure/database/database/migration/migrations/020-process-attribute-table.ts \
  src/infrastructure/database/database/migration/migrations/020-process-attribute-table.spec.ts \
  src/infrastructure/database/database/schema.sql
git commit -m "feat(db): add process_attribute table for Issue #91"
```

---

## Task 2: ProcessAttribute 타입 및 리포지토리

**Files:**
- Create: `src/domains/memory/repositories/process-attribute-repository.ts`
- Create: `src/domains/memory/repositories/__tests__/process-attribute-repository.spec.ts`
- Modify: `src/shared/types/index.ts` (ProcessAttribute 인터페이스 export — 또는 shared/types 내 별도 파일)

**Step 1: Write the failing test**

- Given: DB with process_attribute table, (process_id='p1', topics='["budget","finance"]', workflow_names='[]', skill_names='[]')
- When: getByProcessId('p1')
- Then: returns { process_id: 'p1', topics: ['budget','finance'], workflow_names: [], skill_names: [] }
- When: getByProcessId('p2')
- Then: returns null
- When: upsert({ process_id: 'p2', topics: ['code-review'] })
- Then: getByProcessId('p2') returns that record

**Step 2: Run test to verify it fails**

Run: `npm test -- src/domains/memory/repositories/__tests__/process-attribute-repository.spec.ts -v`  
Expected: FAIL (repository not implemented)

**Step 3: Implement repository and type**

- `ProcessAttribute` interface: process_id, topics?: string[], workflow_names?: string[], skill_names?: string[], created_at?, updated_at?
- ProcessAttributeRepository: getByProcessId(db, processId), upsert(db, attr). JSON parse/stringify for topics/workflow_names/skill_names.

**Step 4: Run test to verify it passes**

Run: `npm test -- src/domains/memory/repositories/__tests__/process-attribute-repository.spec.ts -v`  
Expected: PASS

**Step 5: Commit**

```bash
git add src/domains/memory/repositories/process-attribute-repository.ts \
  src/domains/memory/repositories/__tests__/process-attribute-repository.spec.ts \
  src/shared/types/index.ts
git commit -m "feat(memory): add ProcessAttribute repository for Issue #91"
```

---

## Task 3: Process-attribute 적합도 계산 및 SearchRanking 반영

**Files:**
- Create: `src/domains/search/algorithms/process-attribute-fit.ts` (또는 services 폴더에)
- Modify: `src/domains/search/algorithms/search-ranking.ts`
- Modify: `src/shared/config/constants.ts`
- Modify: `src/shared/config/ranking-weights-loader.ts` (theta 로드 — 해당 파일 구조 확인)

**Step 1: Write the failing test**

- process-attribute-fit: Given process attributes { topics: ['budget'], workflow_names: ['재정'], skill_names: [] }, memory item { tags: ['budget'], workflow_name: '재정', skill_name: null }, When computeProcessAttributeFit(attr, item), Then score > 0.
- Given same attr, memory item { tags: [], workflow_name: null, skill_name: null }, When computeProcessAttributeFit(attr, item), Then score === 0.
- SearchRanking: Given features with process_attribute_fit: 0.8, When calculateFinalScore(features), Then result includes contribution of process_attribute_fit (e.g. weight theta 0.1 → +0.08).

**Step 2: Run test to verify it fails**

Run: `npm test -- src/domains/search/algorithms/__tests__/process-attribute-fit.spec.ts src/domains/search/algorithms/__tests__/search-ranking.spec.ts -v`  
Expected: FAIL

**Step 3: Implement**

- process-attribute-fit.ts: computeProcessAttributeFit(attr: ProcessAttribute | null, item: { tags?: string[], workflow_name?: string | null, skill_name?: string | null }): number. 정규화된 집합 일치(토큰/키워드 겹침 비율)로 0~1 반환. attr이 null이면 1 반환(중립).
- SearchFeatures에 process_attribute_fit?: number 추가.
- SearchRankingWeights에 process_attribute_fit: number (theta, 기본 0.1) 추가. constants.ts에 DEFAULT_WEIGHTS.process_attribute_fit: 0.1, ranking-weights-loader에 theta 매핑.
- calculateFinalScore에서 process_attribute_fit 가중치 반영: finalScore += this.weights.process_attribute_fit * (features.process_attribute_fit ?? 1).

**Step 4: Run test to verify it passes**

Run: `npm test -- src/domains/search/algorithms/__tests__/process-attribute-fit.spec.ts src/domains/search/algorithms/__tests__/search-ranking.spec.ts -v`  
Expected: PASS

**Step 5: Commit**

```bash
git add src/domains/search/algorithms/process-attribute-fit.ts \
  src/domains/search/algorithms/__tests__/process-attribute-fit.spec.ts \
  src/domains/search/algorithms/search-ranking.ts \
  src/shared/config/constants.ts src/shared/config/ranking-weights-loader.ts
git commit -m "feat(search): process-attribute fit scoring and SearchRanking integration for Issue #91"
```

---

## Task 4: HybridSearchEngine에서 process_attribute_fit 주입

**Files:**
- Modify: `src/domains/search/algorithms/hybrid-search-engine.ts`
- Create or extend: `src/domains/search/algorithms/__tests__/hybrid-search-engine-process-attribute.spec.ts` (또는 기존 hybrid-search-engine.spec.ts에 describe 블록 추가)

**Step 1: Write the failing test**

- Given: DB with process_attribute (process_id='agent-1', topics=['code-review']), memory_item (id='mem-1', process_id='agent-1', tags=['code-review'], workflow_name=null)
- When: HybridSearchEngine.search(db, { query: 'review', filters: { process_id: 'agent-1' } })
- Then: 결과 중 mem-1의 finalScore가 process_attribute_fit가 0인 동일 메모리보다 높음 (같은 쿼리에서 process 적합도 반영).

**Step 2: Run test to verify it fails**

Run: `npm test -- src/domains/search/algorithms/__tests__/hybrid-search-engine.spec.ts -v` (해당 시나리오 추가 후)  
Expected: FAIL (process_attribute_fit not applied)

**Step 3: Implement**

- HybridSearchEngine: normalizeScores 호출 전에, query.filters?.process_id가 있으면 ProcessAttributeRepository.getByProcessId(db, process_id) 호출.
- normalizeScores 시그니처에 processAttributes: ProcessAttribute | null 추가. 결과 루프에서 각 result에 대해 메모리 항목의 tags/workflow_name/skill_name을 사용해 computeProcessAttributeFit(processAttributes, result) 호출 후 features.process_attribute_fit에 넣어 calculateFinalScore에 전달.
- combineAndSortResults에서 process_id로 process attributes 조회 후 normalizeScores에 전달.

**Step 4: Run test to verify it passes**

Run: `npm test -- src/domains/search/algorithms/__tests__/hybrid-search-engine.spec.ts -v`  
Expected: PASS

**Step 5: Commit**

```bash
git add src/domains/search/algorithms/hybrid-search-engine.ts \
  src/domains/search/algorithms/__tests__/hybrid-search-engine.spec.ts
git commit -m "feat(search): inject process_attribute_fit in HybridSearchEngine for Issue #91"
```

---

## Task 5: recall MCP에서 process_id 전달 및 (선택) process_attribute 등록 도구

**Files:**
- Modify: `src/domains/memory/tools/recall-tool.ts` (filters.process_id는 이미 MemorySearchFilters에 있으므로, 호출부에서 process_id를 filters에 넣어 전달하는지 확인)
- Modify: `src/domains/memory/tools/remember-tool.ts` 또는 별도 도구 (선택): process_attribute upsert를 호출하는 로직 — 이슈 범위에서 “선택”이므로 우선 recall 경로만 확정

**Step 1: Verify recall passes process_id**

- recall-tool에서 MCP 인자에 process_id가 있으면 filters.process_id로 설정해 검색에 전달하는지 확인. 없으면 추가.

**Step 2: (Optional) Process attribute 설정 도구**

- 이슈 범위: “process별 주제/속성 메타 저장”. 저장 경로는 “전용 테이블”이므로 upsert API가 필요. MCP 도구 `process_attribute_upsert` 또는 remember 시 process_id와 함께 attribute를 저장하는 확장은 별도 태스크로 둘 수 있음. 계획에서는 recall 스코어링까지를 필수로 두고, attribute 등록은 “선택”으로 명시.

**Step 3: Commit**

```bash
git add src/domains/memory/tools/recall-tool.ts
git commit -m "feat(recall): pass process_id to search for process-attribute scoring (Issue #91)"
```

---

## Task 6: 통합 테스트 및 문서

**Files:**
- Modify: `src/test/test-*.ts` 또는 `src/domains/memory/tools/__tests__/recall-tool.spec.ts` (process_id 필터와 점수 동작 E2E 시나리오 1개)
- Modify: `docs/plans/2026-02-07-memori-inspired-design.md` (해당 섹션에 “#91 반영 완료” 노트 추가 — 선택)

**Step 1: Add E2E or integration test**

- Given: DB with 020 applied, process_attribute (process_id='e2e-p', topics=['finance']), memory items (one with tags ['finance'], one with tags ['sports'])
- When: recall({ query: 'money', process_id: 'e2e-p' })
- Then: finance 태그 메모리가 더 높은 final_score로 상위에 옴.

**Step 2: Run full test suite**

Run: `npm test`  
Expected: All pass.

**Step 3: Commit**

```bash
git add src/domains/memory/tools/__tests__/recall-tool.spec.ts
git commit -m "test(recall): process_id and process_attribute scoring E2E (Issue #91)"
```

---

## 요약 체크리스트

- [ ] process_attribute 테이블 (020) 및 스키마
- [ ] ProcessAttributeRepository (getByProcessId, upsert)
- [ ] computeProcessAttributeFit + SearchRanking process_attribute_fit 가중치
- [ ] HybridSearchEngine에서 process_id 시 process attributes 조회 및 normalizeScores에 fit 반영
- [ ] recall-tool에서 process_id → filters 전달
- [ ] (선택) process_attribute 등록 MCP 도구
- [ ] 통합/E2E 테스트 및 npm test 통과

---

## 실행 옵션

계획 작성 완료. 저장 위치: `docs/plans/2026-02-08-issue-91-process-attribute-recall.md`

**실행 방식 두 가지:**

1. **Subagent-Driven (이 세션)** — 태스크마다 서브에이전트로 진행, 태스크 간 리뷰 후 다음 태스크 진행. 빠른 반복.
2. **별도 세션 (Parallel)** — 이 워크스페이스에서 새 채팅을 열고 executing-plans 스킬로 체크포인트 단위 배치 실행.

어떤 방식으로 진행할까요?
