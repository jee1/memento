# Issue 349 — Hybrid 벡터 실행층 분리 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `hybrid-search-engine.ts`에서 단일 프로바이더 VEC 검색 본문·태스크 생성을 `hybrid-search-provider-parallel.ts`로 옮겨 실행 경로 복잡도를 줄이고, 동작·API는 유지한다.

**Architecture:** `HybridSearchEngine`이 `ProviderVectorSearchDeps`(generateQueryVector, vectorSearch, logSearchStep)를 조립해 병렬 모듈의 `createProviderVectorSearchTask`에 넘긴다. 전체 타임아웃·집계는 기존 `executeProviderSearchesWithOverallTimeout` 유지.

**Tech Stack:** TypeScript, Vitest, 기존 `HYBRID_SEARCH` 상수.

---

### Task 1: 병렬 모듈에 단일 프로바이더 실행 API 추가

**Files:**
- Modify: `packages/memento-core/src/domains/search/algorithms/hybrid-search-provider-parallel.ts`

- [ ] **Step 1:** `ProviderVectorSearchDeps`, `ProviderVectorSearchOptions` 타입 및 `runSingleProviderVectorSearch`, `createProviderVectorSearchTask` 구현(기존 엔진 로직 이전).
- [ ] **Step 2:** 파일 상단 주석에 Issue 349 맥락 한 줄 추가.

### Task 2: HybridSearchEngine 위임으로 교체

**Files:**
- Modify: `packages/memento-core/src/domains/search/algorithms/hybrid-search-engine.ts`

- [ ] **Step 1:** `createProviderVectorSearchTask` import.
- [ ] **Step 2:** private `getProviderVectorSearchDeps()` 추가(또는 `executeVecSearch` 내부 한 번 생성).
- [ ] **Step 3:** `executeVecSearch`의 `providersToSearch.map`이 모듈 함수를 사용하도록 변경.
- [ ] **Step 4:** 기존 `runProviderSearchTaskBody`, `createProviderSearchTask` private 메서드 제거.

### Task 3: 검증

**Files:**
- Test: `packages/memento-core/src/domains/search/algorithms/__tests__/hybrid-search-engine.spec.ts`

- [ ] **Step 1:** `cd` 워크트리 루트에서 `npm run type-check`.
- [ ] **Step 2:** `npx vitest run packages/memento-core/src/domains/search/algorithms/__tests__/hybrid-search-engine.spec.ts packages/memento-core/src/domains/search/algorithms/__tests__/hybrid-search-engine-consolidation.spec.ts` (또는 동등한 워크스페이스 명령).

### Task 4: 문서·커밋

- [ ] **Step 1:** 스펙·플랜·코드 변경을 `issue/349-hybrid-search-refactor` 브랜치에 커밋.
