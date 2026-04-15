# Issue #78 Triple 추출 파이프라인 고도화 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** MCP 도구 `extract_triples`로 대화(`messages[]`) 또는 단일 `content`에서 청킹·추출·병합·(선택) `kg_triple` 저장을 수행하고, `visualize_relations`에 dot 등 내보내기 포맷을 추가한다.

**Architecture:** 입력 정규화·텍스트 청킹·병합은 순수 유틸로 분리하고, `TriplePipelineOrchestrator`(신규)가 기존 `TripleExtractionService.extractTriples`를 chunk 루프로 호출한다. 저장은 스키마 변경 없이 `KgTripleRepository.upsertTriple`로 process/session/owner를 넘긴다. 1차 클러스터링은 **문자열 정규화 기반 중복 제거**(동일 S/P/O 키); 임베딩 기반 유사 병합은 범위 밖(후속).

**Tech Stack:** TypeScript 5.x, Vitest, Zod, `better-sqlite3`, 기존 `@memento/core` 패턴(`BaseTool`, `getToolRegistry`).

---

## 파일 맵 (생성·수정)

| 경로 | 역할 |
|------|------|
| `packages/memento-core/src/domains/relation/services/triple-extraction/triple-input-normalizer.ts` | `messages[]` → 단일 추출용 문자열 |
| `packages/memento-core/src/domains/relation/services/triple-extraction/triple-text-chunker.ts` | 문자열을 `chunkSize`/`overlap`으로 분할 |
| `packages/memento-core/src/domains/relation/services/triple-extraction/triple-chunk-merge.ts` | chunk별 `Triple[]` 병합·키 dedupe |
| `packages/memento-core/src/domains/relation/services/triple-extraction/triple-pipeline-orchestrator.ts` | 청킹 루프 + `TripleExtractionService` 호출 + 부분 실패 집계 |
| `packages/memento-core/src/shared/types/triple-extraction.ts` | 파이프라인 결과 타입 추가 |
| `packages/memento-core/src/domains/relation/tools/extract-triples-tool.ts` | MCP 도구 |
| `packages/memento-core/src/tools/index.ts` | 도구 등록 |
| `packages/memento-core/src/index.ts` | (선택) 공개 export |
| `packages/memento-core/src/shared/utils/relation-visualizer.ts` | `dot` 문자열 생성 헬퍼 |
| `packages/memento-core/src/domains/relation/tools/visualize-relations-tool.ts` | `format` enum 확장 |
| `packages/memento-server/src/server/index.ts` | MCP instructions 한 줄 업데이트(도구 개수·이름) |

---

### Task 1: `triple-input-normalizer` + 단위 테스트

**Files:**
- Create: `packages/memento-core/src/domains/relation/services/triple-extraction/triple-input-normalizer.ts`
- Create: `packages/memento-core/src/domains/relation/services/triple-extraction/triple-input-normalizer.spec.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`triple-input-normalizer.spec.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { normalizeChatMessagesToText } from './triple-input-normalizer.js';

describe('normalizeChatMessagesToText', () => {
  it('joins role and content with newlines', () => {
    const text = normalizeChatMessagesToText([
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi' },
    ]);
    expect(text).toContain('user');
    expect(text).toContain('Hello');
    expect(text).toContain('assistant');
    expect(text).toContain('Hi');
  });
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```bash
cd /home/jee1lee/git/memento && npx vitest run packages/memento-core/src/domains/relation/services/triple-extraction/triple-input-normalizer.spec.ts
```

기대: `normalizeChatMessagesToText` 미정의 또는 import 실패.

- [ ] **Step 3: 최소 구현**

`triple-input-normalizer.ts`:

```typescript
export interface ChatMessageInput {
  role: string;
  content: string;
}

export function normalizeChatMessagesToText(messages: ChatMessageInput[]): string {
  return messages
    .map((m) => `${m.role}: ${m.content}`)
    .join('\n');
}
```

- [ ] **Step 4: 테스트 통과 확인**

동일 vitest 명령 기대: PASS.

- [ ] **Step 5: 커밋**

```bash
git add packages/memento-core/src/domains/relation/services/triple-extraction/triple-input-normalizer.ts packages/memento-core/src/domains/relation/services/triple-extraction/triple-input-normalizer.spec.ts
git commit -m "feat(core): add chat message to text normalizer for triple pipeline"
```

---

### Task 2: `triple-text-chunker` + 단위 테스트

**Files:**
- Create: `packages/memento-core/src/domains/relation/services/triple-extraction/triple-text-chunker.ts`
- Create: `packages/memento-core/src/domains/relation/services/triple-extraction/triple-text-chunker.spec.ts`

- [ ] **Step 1: 실패하는 테스트**

`chunkText('abcdefghij', 4, 1)`가 겹침 1을 반영해 여러 chunk를 내는지 검증(예: 첫 chunk `abcd`, 다음은 `defg` 시작 등 프로젝트가 정한 규칙에 맞게).

- [ ] **Step 2: `splitTextIntoChunks(text, chunkSize, overlap)` 구현**

요구: `chunkSize > 0`, `overlap >= 0`, `overlap < chunkSize` 아니면 `RangeError`. 빈 문자열은 빈 배열.

- [ ] **Step 3: vitest 실행 후 커밋**

```bash
git commit -m "feat(core): add text chunker for triple pipeline"
```

---

### Task 3: `triple-chunk-merge` — triple 병합·키 dedupe

**Files:**
- Create: `packages/memento-core/src/domains/relation/services/triple-extraction/triple-chunk-merge.ts`
- Create: `packages/memento-core/src/domains/relation/services/triple-extraction/triple-chunk-merge.spec.ts`

- [ ] **Step 1: 테스트 — 동일 S/P/O가 두 chunk에서 오면 하나만 남는지**

입력 타입은 `Triple` (`shared/types/triple-extraction.js`). 키 함수 예: `const key = (t: Triple) => \`${t.subject}||${t.predicate}||${t.object}\`.toLowerCase()` (구현 시 trim 적용).

- [ ] **Step 2: `mergeTripleLists(lists: Triple[][]): Triple[]` 구현** — 입력 순서 유지(첫 등장 우선).

- [ ] **Step 3: vitest + 커밋** `feat(core): merge triple lists with spo dedupe`

---

### Task 4: 파이프라인 타입 + Orchestrator

**Files:**
- Modify: `packages/memento-core/src/shared/types/triple-extraction.ts`
- Create: `packages/memento-core/src/domains/relation/services/triple-extraction/triple-pipeline-orchestrator.ts`
- Create: `packages/memento-core/src/domains/relation/services/triple-extraction/triple-pipeline-orchestrator.spec.ts` (TripleExtractionService를 mock)

`triple-extraction.ts`에 추가할 타입 예:

```typescript
export interface TriplePipelineChunkError {
  chunkIndex: number;
  reason: TripleExtractionFailureReason;
  message?: string;
}

export interface TriplePipelineResult {
  triples: Triple[];
  chunkErrors: TriplePipelineChunkError[];
  chunksProcessed: number;
}
```

- [ ] **Step 1: Orchestrator 메서드 시그니처**

`run(params: { text: string; chunkSize: number; chunkOverlap: number }, extract: (text: string) => Promise<TripleExtractionResult>)` 형태로 순수하게 두어 테스트에서 `extract`를 스텁.

- [ ] **Step 2: 짧은 텍스트는 chunk 1개로 extract 1회 호출**

- [ ] **Step 3: 긴 텍스트는 chunk마다 호출 후 `mergeTripleLists`**

- [ ] **Step 4: extract가 실패한 chunk는 `chunkErrors`에 push, 나머지 chunk 계속**(부분 성공).

- [ ] **Step 5: vitest + 커밋** `feat(core): add triple pipeline orchestrator`

**주의:** `TripleExtractionService.extractTriples(text, options?)` 시그니처에 맞춘다(`triple-extraction-service.ts` 참고). Orchestrator는 해당 메서드를 주입받거나 서비스 인스턴스를 받아 호출한다.

---

### Task 5: MCP 도구 `extract_triples_tool`

**Files:**
- Create: `packages/memento-core/src/domains/relation/tools/extract-triples-tool.ts`
- Create: `packages/memento-core/src/domains/relation/tools/extract-triples-tool.spec.ts`
- Modify: `packages/memento-core/src/tools/index.ts`

- [ ] **Step 1: Zod 스키마 — `content` XOR `messages`**

```typescript
const ExtractTriplesSchema = z.object({
  content: z.string().min(1).optional(),
  messages: z.array(z.object({ role: z.string(), content: z.string() })).optional(),
  chunk_size: z.number().int().min(100).max(50000).optional(),
  chunk_overlap: z.number().int().min(0).max(10000).optional(),
  merge_strategy: z.enum(['dedupe_spo']).optional(),
  persist: z.boolean().optional(),
  process_id: z.string().optional(),
  session_id: z.string().optional(),
}).refine((d) => !!(d.content?.trim()) !== (Array.isArray(d.messages) && d.messages.length > 0), {
  message: 'Provide exactly one of content or non-empty messages',
});
```

한도: `messages` 최대 개수(예: 500), `content` 최대 길이(예: 500_000)는 `refine` 또는 별도 검증.

- [ ] **Step 2: `handle` 흐름**

1. 파싱 후 텍스트 = `content ?? normalizeChatMessagesToText(messages!)`.
2. `TriplePipelineOrchestrator` + `new TripleExtractionService()`로 추출. `extractTriples` 내부에서 이미 `await this.ensureInitialized()`를 호출하므로 orchestrator는 `extractTriples(chunkText, options)`만 호출하면 된다.
3. `persist === true`이면 각 triple에 대해 `KgTripleRepository(context.db).upsertTriple({ subject, predicate, object, owner_id: context.agentId ?? null, process_id: params.process_id ?? context.processId ?? null, session_id: params.session_id ?? context.sessionId ?? null, representative_memory_id: null })`.
4. JSON 응답에 `triples`, `chunk_errors`, `chunks_processed`, `persisted_count` 포함.

- [ ] **Step 3: `ExtractTriplesTool`을 `coreTools` 배열에 추가** (`packages/memento-core/src/tools/index.ts`).

- [ ] **Step 4: 스키마 오류·동시에 content+messages 입력 시** `createErrorResult('INVALID_INPUT', ...)` 패턴 사용.

- [ ] **Step 5: 도구 스펙 테스트** — mock DB(`better-sqlite3` 메모리) + mock extraction이면 됨. 실제 LLM 호출 없이 orchestrator만 검증해도 되며, 통합 테스트는 선택.

- [ ] **Step 6: 커밋** `feat(mcp): add extract_triples tool for triple pipeline`

---

### Task 6: `visualize_relations` — `dot` 포맷

**Files:**
- Modify: `packages/memento-core/src/shared/utils/relation-visualizer.ts`
- Modify: `packages/memento-core/src/domains/relation/tools/visualize-relations-tool.ts`
- Modify: `packages/memento-core/src/domains/relation/tools/__tests__/visualize-relations-tool.spec.ts` (존재 시) 또는 신규 테스트

- [ ] **Step 1: `RelationVisualizer.visualizeAsDot(relations, options)`** — Graphviz DOT 부분 문자열(노드 ID는 비식별자 안전하게 이스케이프 또는 해시).

- [ ] **Step 2: `VisualizeRelationsSchema`의 `format`에 `'dot'` 추가** 및 JSON schema `enum` 동기화.

- [ ] **Step 3: `handle`에서 `format === 'dot'` 분기**

- [ ] **Step 4: vitest + 커밋** `feat(mcp): add dot format to visualize_relations`

`html` 포맷은 스펙상 선택: DOT만으로도 “graphviz 호환” 요구 충족 가능. HTML 래퍼가 필요하면 별도 작은 헬퍼로 `<pre>`에 dot 넣기 정도만.

---

### Task 7: 관측·문서·회귀

**Files:**
- Modify: `packages/memento-server/src/server/index.ts` (`MEMENTO_SERVER_INSTRUCTIONS`)
- Modify: `docs/api/ko/api-reference.md` 또는 관계 API 문서(한 섹션) — 사용자 규칙상 문서는 필요할 때만; **최소**: PR 본문 또는 `CLAUDE.md` 도구 개수 갱신

- [ ] **Step 1: `extract_triples` 호출 시 구조화 로그** — `logger.info`에 `chunksProcessed`, `tripleCount`, `errorCount`, `persist` (본문 미기록).

- [ ] **Step 2: Telemetry** — `context.services.telemetryService`가 있으면 기존 패턴으로 도구명·성공/실패만 기록.

- [ ] **Step 3: 회귀** — `npm test` 및 `npx vitest run packages/memento-core/src/domains/relation/tools/__tests__/extract-relations-tool.spec.ts` (기존 extract_relations).

- [ ] **Step 4: 커밋** `chore: document extract_triples and update MCP instructions`

---

## Self-review (계획 vs 스펙)

| 스펙 요구 | 해당 Task |
|-----------|-----------|
| 대화 입력 정규화 | Task 1, 5 |
| 청킹·병합 | Task 2, 3, 4 |
| 부분 성공(chunk 오류) | Task 4, 5 |
| MCP 1차 노출 | Task 5 |
| process/session 귀속 | Task 5 (`upsertTriple`) |
| visualize 포맷 확장 | Task 6 |
| 한도·스키마 검증 | Task 5 Zod |
| 관측 | Task 7 |
| extract_relations 회귀 | Task 7 |

**후속(본 계획 범위 밖):** 임베딩 기반 엔티티 클러스터링, HTTP admin 동일 엔드포인트, `html` 풍부 렌더.

---

## 실행 위임

**Plan complete and saved to `docs/superpowers/plans/2026-04-15-issue-78-triple-pipeline.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — 태스크마다 새 서브에이전트를 띄우고 태스크 사이에 리뷰, 빠른 반복.

**2. Inline Execution** — 이 세션에서 `executing-plans` 스킬로 체크포인트마다 실행.

**Which approach?**
