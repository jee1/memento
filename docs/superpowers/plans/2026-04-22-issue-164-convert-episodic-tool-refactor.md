# ConvertEpisodicToSemanticTool handle() 분리 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `ConvertEpisodicToSemanticTool.handle()` (344줄, complexity 43, 중첩 9)을 8개 private 메서드로 분리해 각 메서드 complexity를 10 이하로 낮추면서 동작을 보존한다.

**Architecture:** 같은 파일 내 private 메서드 패턴 (`remember-tool.ts` 선례 준수). 테스트-먼저 전략: 리팩토링 전 경계 케이스 테스트 7개 추가 → 그린 확인 → 단계별 추출 (각 단계 후 `npm test`). `handle()`은 파싱·위임·결과 반환만 담당하는 ~40줄 오케스트레이터가 된다.

**Tech Stack:** TypeScript 5.x, Vitest, better-sqlite3, npm workspaces (`@memento/core`)

---

## File Map

| 파일 | 변경 내용 |
|------|-----------|
| `packages/memento-core/src/domains/memory/tools/convert-episodic-to-semantic-tool.ts` | 타입 2개 추가, private 메서드 8개 추출, `handle()` 축소 |
| `packages/memento-core/src/domains/memory/tools/__tests__/convert-episodic-to-semantic-tool.spec.ts` | 경계 케이스 테스트 7개 추가 |

---

## Task 0: 워크트리 생성

**Files:** (없음 — 브랜치·워크트리 설정만)

- [ ] **Step 1: 워크트리 생성**

```bash
git worktree add .worktrees/refactor/issue-164-convert-episodic -b refactor/issue-164-convert-episodic
```

- [ ] **Step 2: 워크트리 디렉토리로 이동해 의존성 확인**

```bash
cd .worktrees/refactor/issue-164-convert-episodic && npm install
```

Expected: 의존성 설치 완료 (이미 node_modules 공유이므로 빠름)

---

## Task 1: 경계 케이스 테스트 7개 추가 (그린 확인)

**Files:**
- Modify: `packages/memento-core/src/domains/memory/tools/__tests__/convert-episodic-to-semantic-tool.spec.ts`

기존 `describe('배치 처리', ...)` 블록 뒤, `describe('에러 처리', ...)` 앞에 새 `describe('경계 케이스', ...)` 블록을 삽입한다.

- [ ] **Step 1: 테스트 블록 추가**

파일의 `describe('에러 처리', () => {` 바로 앞 (442번 줄 근처)에 삽입:

```ts
  describe('경계 케이스', () => {
    it('skip_converted=false이면 이미 변환된 단일 메모리도 재처리 시도한다', async () => {
      const memoryId = generateId('mem');
      createTestEpisodicMemory(db, memoryId, 'Alice works at Google.', 0.7);
      DatabaseUtils.run(db, `
        UPDATE memory_item SET triple_extracted = 1, triple_extracted_status = 'success' WHERE id = ?
      `, [memoryId]);

      const result = await tool.handle({ memory_id: memoryId, skip_converted: false }, context);
      const data = JSON.parse(result.content[0].text);

      expect(data.skipped).toBe(0);
      expect(data.total).toBe(1);
      expect(data.success + data.failed).toBe(1);
    });

    it('retry_failed=true + skip_converted=false 조합이면 성공 항목도 포함해 재처리한다', async () => {
      const successId = generateId('mem');
      const failedId = generateId('mem');
      createTestEpisodicMemory(db, successId, 'Alice is a developer.', 0.7);
      createTestEpisodicMemory(db, failedId, 'Bob is a manager.', 0.6);
      DatabaseUtils.run(db, `UPDATE memory_item SET triple_extracted = 1, triple_extracted_status = 'success' WHERE id = ?`, [successId]);
      DatabaseUtils.run(db, `UPDATE memory_item SET triple_extracted = 0, triple_extracted_status = 'failed' WHERE id = ?`, [failedId]);

      vi.spyOn(TripleExtractionService.prototype, 'extractTriples').mockResolvedValue({
        triples: [],
        extractionInfo: { failureReason: 'no_triple' }
      });

      const result = await tool.handle({ skip_converted: false, retry_failed: true, limit: 10 }, context);
      const data = JSON.parse(result.content[0].text);

      expect(data.total).toBe(2);
      expect(data.success + data.failed).toBe(data.total);
    });

    it('배치에서 일부 성공 + 일부 실패가 섞이면 success + failed = total이다', async () => {
      const mem1 = generateId('mem');
      const mem2 = generateId('mem');
      createTestEpisodicMemory(db, mem1, 'Alice is a developer.', 0.7);
      createTestEpisodicMemory(db, mem2, 'Bob is a manager.', 0.6);

      vi.spyOn(TripleExtractionService.prototype, 'extractTriples')
        .mockResolvedValueOnce({ triples: [{ subject: 'Alice', predicate: 'is', object: 'developer' }], extractionInfo: {} })
        .mockResolvedValueOnce({ triples: [], extractionInfo: { failureReason: 'no_triple' } });
      vi.spyOn(SemanticMemoryUpdateService.prototype, 'updateSemanticMemory')
        .mockResolvedValue({ semanticMemoryIds: ['sem_1'] });

      const result = await tool.handle({ skip_converted: true, limit: 10 }, context);
      const data = JSON.parse(result.content[0].text);

      expect(data.total).toBe(2);
      expect(data.success).toBe(1);
      expect(data.failed).toBe(1);
      expect(data.success + data.failed).toBe(data.total);
    });

    it('limit=2이면 episodic이 3개여도 2개만 처리한다', async () => {
      createTestEpisodicMemory(db, generateId('mem'), 'Content 1', 0.5);
      createTestEpisodicMemory(db, generateId('mem'), 'Content 2', 0.5);
      createTestEpisodicMemory(db, generateId('mem'), 'Content 3', 0.5);

      vi.spyOn(TripleExtractionService.prototype, 'extractTriples').mockResolvedValue({
        triples: [],
        extractionInfo: { failureReason: 'no_triple' }
      });

      const result = await tool.handle({ limit: 2 }, context);
      const data = JSON.parse(result.content[0].text);

      expect(data.total).toBe(2);
    });

    it('triple_extracted_status=abandoned인 항목은 배치에서 제외된다', async () => {
      const normalId = generateId('mem');
      const abandonedId = generateId('mem');
      createTestEpisodicMemory(db, normalId, 'Normal content.', 0.5);
      createTestEpisodicMemory(db, abandonedId, 'Abandoned content.', 0.5);
      DatabaseUtils.run(db, `
        UPDATE memory_item SET triple_extracted = 0, triple_extracted_status = 'abandoned' WHERE id = ?
      `, [abandonedId]);

      vi.spyOn(TripleExtractionService.prototype, 'extractTriples').mockResolvedValue({
        triples: [],
        extractionInfo: { failureReason: 'no_triple' }
      });

      const result = await tool.handle({ skip_converted: true, limit: 10 }, context);
      const data = JSON.parse(result.content[0].text);

      expect(data.total).toBe(1);
    });

    it('변환할 episodic 메모리가 없으면 total=0과 message를 반환한다', async () => {
      const result = await tool.handle({ skip_converted: true, limit: 10 }, context);
      const data = JSON.parse(result.content[0].text);

      expect(data.total).toBe(0);
      expect(data.message).toBe('변환할 Episodic Memory가 없습니다.');
    });

    it('이미 실패한 메모리를 재처리하면 retry_count가 증가한다', async () => {
      const memoryId = generateId('mem');
      createTestEpisodicMemory(db, memoryId, 'Retryable content.', 0.5);
      DatabaseUtils.run(db, `
        UPDATE memory_item SET
          triple_extracted = 0,
          triple_extracted_status = 'failed',
          triple_extraction_metadata = ?
        WHERE id = ?
      `, [JSON.stringify({ failureReason: 'no_triple', retry_count: 1, last_attempt: new Date().toISOString() }), memoryId]);

      vi.spyOn(TripleExtractionService.prototype, 'extractTriples').mockResolvedValue({
        triples: [],
        extractionInfo: { failureReason: 'no_triple' }
      });

      await tool.handle({ retry_failed: true, skip_converted: true, limit: 10 }, context);

      const row = DatabaseUtils.get(db, `
        SELECT triple_extraction_metadata FROM memory_item WHERE id = ?
      `, [memoryId]) as { triple_extraction_metadata: string } | undefined;
      const metadata = JSON.parse(row?.triple_extraction_metadata ?? '{}');

      expect(metadata.retry_count).toBe(2);
    });
  });
```

- [ ] **Step 2: 테스트 실행 — 전체 그린 확인**

```bash
npx vitest run packages/memento-core/src/domains/memory/tools/__tests__/convert-episodic-to-semantic-tool.spec.ts
```

Expected: 총 18개 테스트 모두 PASS (기존 11 + 신규 7)

- [ ] **Step 3: 커밋**

```bash
git add packages/memento-core/src/domains/memory/tools/__tests__/convert-episodic-to-semantic-tool.spec.ts
git commit -m "test(memory): issue #164 경계 케이스 테스트 7개 추가"
```

---

## Task 2: 타입 정의 + fetchSingleMemory() 추출

**Files:**
- Modify: `packages/memento-core/src/domains/memory/tools/convert-episodic-to-semantic-tool.ts`

- [ ] **Step 1: 파일 상단에 타입 2개 추가**

`SEMANTIC_UPDATE_FAILED_ERROR` 상수 선언 바로 다음(21번 줄 뒤)에 삽입:

```ts
type EpisodicMemoryRow = {
  id: string;
  content: string;
  importance: number | null; // DB NULL 가능, 사용 시 ?? 0.5 폴백
};

type ConversionResults = {
  total: number;
  success: number;
  failed: number;
  skipped: number;
  semantic_memory_ids: string[];
};
```

- [ ] **Step 2: `fetchSingleMemory()` private 메서드 추가**

클래스 끝(닫는 `}` 바로 앞)에 추가:

```ts
  private fetchSingleMemory(
    db: Database.Database,
    memoryId: string,
    skipConverted: boolean,
  ): EpisodicMemoryRow[] | ToolResult {
    const memoryExists = DatabaseUtils.get(db, `
      SELECT id, triple_extracted, triple_extracted_status FROM memory_item
      WHERE id = ? AND type = 'episodic'
    `, [memoryId]) as { id: string; triple_extracted: number | null; triple_extracted_status: string | null } | undefined;

    if (!memoryExists) {
      return this.createErrorResult('MEMORY_NOT_FOUND', `Episodic Memory를 찾을 수 없습니다: ${memoryId}`);
    }

    if (skipConverted && memoryExists.triple_extracted === 1 && memoryExists.triple_extracted_status === 'success') {
      return this.createSuccessResult({ total: 1, success: 0, failed: 0, skipped: 1, semantic_memory_ids: [] });
    }

    type MemoryRow = { id: string; content: string; importance: number | null; triple_extracted: number | null; triple_extracted_status: string | null };
    let memory: MemoryRow | undefined;

    if (skipConverted) {
      memory = DatabaseUtils.get(db, `
        SELECT id, content, importance, triple_extracted, triple_extracted_status FROM memory_item
        WHERE id = ? AND type = 'episodic'
          AND (triple_extracted IS NULL OR triple_extracted = 0)
      `, [memoryId]) as MemoryRow | undefined;
    } else {
      memory = DatabaseUtils.get(db, `
        SELECT id, content, importance, triple_extracted, triple_extracted_status FROM memory_item
        WHERE id = ? AND type = 'episodic'
      `, [memoryId]) as MemoryRow | undefined;
    }

    if (!memory) {
      // skipConverted=true이고 이미 변환된 케이스는 위에서 처리됨 (도달 불가 분기 — 동작 보존을 위해 유지)
      if (skipConverted) {
        return this.createSuccessResult({ total: 1, success: 0, failed: 0, skipped: 1, semantic_memory_ids: [] });
      }
      return this.createErrorResult('MEMORY_NOT_FOUND', `Episodic Memory를 찾을 수 없습니다: ${memoryId}`);
    }

    return [{ id: memory.id, content: memory.content, importance: memory.importance }];
  }
```

- [ ] **Step 3: `handle()` 내 단일 메모리 분기를 `fetchSingleMemory()` 호출로 교체**

`handle()` 내 `let episodicMemories: Array<...> = [];` 선언과 `if (memory_id) { ... }` 블록(91-155줄)을 아래로 교체:

```ts
      let episodicMemories: EpisodicMemoryRow[] = [];

      if (memory_id) {
        const resolved = this.fetchSingleMemory(db, memory_id, skip_converted);
        if (!Array.isArray(resolved)) return resolved;
        episodicMemories = resolved;
      } else {
        // ... 기존 배치 코드 유지 ...
      }
```

- [ ] **Step 4: 테스트 실행**

```bash
npx vitest run packages/memento-core/src/domains/memory/tools/__tests__/convert-episodic-to-semantic-tool.spec.ts
```

Expected: 15개 모두 PASS

- [ ] **Step 5: 커밋**

```bash
git add packages/memento-core/src/domains/memory/tools/convert-episodic-to-semantic-tool.ts
git commit -m "refactor(memory): fetchSingleMemory() 추출 + 타입 정의 추가"
```

---

## Task 3: fetchBatchMemories() 추출

**Files:**
- Modify: `packages/memento-core/src/domains/memory/tools/convert-episodic-to-semantic-tool.ts`

- [ ] **Step 1: `fetchBatchMemories()` private 메서드 추가**

클래스 끝 바로 앞에 추가:

```ts
  private fetchBatchMemories(
    db: Database.Database,
    skipConverted: boolean,
    retryFailed: boolean,
    limit: number,
  ): EpisodicMemoryRow[] | ToolResult {
    const conditions: string[] = ["type = 'episodic'"];
    const queryParams: unknown[] = [];

    if (skipConverted) {
      conditions.push("(triple_extracted IS NULL OR triple_extracted = 0)");
    }

    if (retryFailed) {
      if (skipConverted) {
        conditions.push("(triple_extracted_status IS NULL OR triple_extracted_status = 'failed')");
      }
    } else {
      conditions.push("(triple_extracted_status IS NULL OR triple_extracted_status != 'failed')");
    }

    conditions.push("(triple_extracted_status IS NULL OR triple_extracted_status != 'abandoned')");

    const query =
      `SELECT id, content, importance FROM memory_item ` +
      `WHERE ${conditions.join(' AND ')} ` +
      `ORDER BY created_at ASC ` +
      `LIMIT ?`;
    queryParams.push(limit);

    const memories = DatabaseUtils.all(db, query, queryParams) as EpisodicMemoryRow[];

    if (memories.length === 0) {
      return this.createSuccessResult({
        total: 0,
        success: 0,
        failed: 0,
        skipped: 0,
        semantic_memory_ids: [],
        message: '변환할 Episodic Memory가 없습니다.'
      });
    }

    return memories;
  }
```

- [ ] **Step 2: `handle()` 내 배치 조회 코드를 `fetchBatchMemories()` 호출로 교체**

`handle()`의 `} else {` 블록 (156~206줄) 전체를 교체:

```ts
      } else {
        const resolved = this.fetchBatchMemories(db, skip_converted, retry_failed, limit);
        if (!Array.isArray(resolved)) return resolved;
        episodicMemories = resolved;
      }
```

- [ ] **Step 3: 테스트 실행**

```bash
npx vitest run packages/memento-core/src/domains/memory/tools/__tests__/convert-episodic-to-semantic-tool.spec.ts
```

Expected: 15개 모두 PASS

- [ ] **Step 4: 커밋**

```bash
git add packages/memento-core/src/domains/memory/tools/convert-episodic-to-semantic-tool.ts
git commit -m "refactor(memory): fetchBatchMemories() 추출 — params 섀도잉 해소 포함"
```

---

## Task 4: resolveMemories() 추출

**Files:**
- Modify: `packages/memento-core/src/domains/memory/tools/convert-episodic-to-semantic-tool.ts`

- [ ] **Step 1: `resolveMemories()` private 메서드 추가**

```ts
  private resolveMemories(
    db: Database.Database,
    memoryId: string | undefined,
    skipConverted: boolean,
    retryFailed: boolean,
    limit: number,
  ): EpisodicMemoryRow[] | ToolResult {
    if (memoryId) {
      return this.fetchSingleMemory(db, memoryId, skipConverted);
    }
    return this.fetchBatchMemories(db, skipConverted, retryFailed, limit);
  }
```

- [ ] **Step 2: `handle()`의 if/else 분기를 `resolveMemories()` 단일 호출로 교체**

```ts
      const resolved = this.resolveMemories(db, memory_id, skip_converted, retry_failed, limit);
      if (!Array.isArray(resolved)) return resolved;
      const episodicMemories = resolved;
```

(기존 `let episodicMemories`, `if (memory_id)`, `else` 블록 전체를 위 3줄로 교체)

- [ ] **Step 3: 테스트 실행**

```bash
npx vitest run packages/memento-core/src/domains/memory/tools/__tests__/convert-episodic-to-semantic-tool.spec.ts
```

Expected: 15개 모두 PASS

- [ ] **Step 4: 커밋**

```bash
git add packages/memento-core/src/domains/memory/tools/convert-episodic-to-semantic-tool.ts
git commit -m "refactor(memory): resolveMemories() 추출 — 단일/배치 조회 진입점 통합"
```

---

## Task 5: fetchAlreadyConverted() 추출

**Files:**
- Modify: `packages/memento-core/src/domains/memory/tools/convert-episodic-to-semantic-tool.ts`

- [ ] **Step 1: `fetchAlreadyConverted()` private 메서드 추가**

```ts
  private fetchAlreadyConverted(
    db: Database.Database,
    memories: EpisodicMemoryRow[],
    skipConverted: boolean,
  ): Set<string> {
    if (!skipConverted || memories.length === 0) return new Set();
    const ids = memories.map((m) => m.id);
    const placeholders = ids.map(() => '?').join(',');
    const rows = DatabaseUtils.all(db, `
      SELECT id FROM memory_item
      WHERE id IN (${placeholders}) AND triple_extracted = 1 AND triple_extracted_status = 'success'
    `, ids) as Array<{ id: string }>;
    return new Set(rows.map((r) => r.id));
  }
```

- [ ] **Step 2: `handle()` 내 `alreadyConvertedIds` 계산 블록을 메서드 호출로 교체**

기존 코드(217~227줄):
```ts
      // 이미 변환된 ID 일괄 조회 (N+1 완화)
      let alreadyConvertedIds = new Set<string>();
      if (skip_converted && episodicMemories.length > 0) {
        ...
      }
```

교체:
```ts
      const alreadyConvertedIds = this.fetchAlreadyConverted(db, episodicMemories, skip_converted);
```

- [ ] **Step 3: 테스트 실행**

```bash
npx vitest run packages/memento-core/src/domains/memory/tools/__tests__/convert-episodic-to-semantic-tool.spec.ts
```

Expected: 15개 모두 PASS

- [ ] **Step 4: 커밋**

```bash
git add packages/memento-core/src/domains/memory/tools/convert-episodic-to-semantic-tool.ts
git commit -m "refactor(memory): fetchAlreadyConverted() 추출 — N+1 방지 로직 분리"
```

---

## Task 6: convertSingleMemory() 뼈대 추출

**Files:**
- Modify: `packages/memento-core/src/domains/memory/tools/convert-episodic-to-semantic-tool.ts`

핵심: 핸들러 3개(success/noTriples/error)는 아직 이 메서드 안에 **인라인으로 유지**한다. `semanticUpdateStarted` 플래그도 이 메서드에서 선언한다.

- [ ] **Step 1: `convertSingleMemory()` private 메서드 추가**

아래 코드에서 `// [SUCCESS LOGIC]`, `// [NO-TRIPLE LOGIC]`, `// [ERROR LOGIC]` 주석 자리에는 현재 `handle()` 배치 루프 내 해당 로직을 **그대로** 옮긴다.

```ts
  private async convertSingleMemory(
    episodicMemory: EpisodicMemoryRow,
    extractionResult: Awaited<ReturnType<TripleExtractionService['extractTriples']>>,
    db: Database.Database,
    context: ToolContext,
    results: ConversionResults,
  ): Promise<void> {
    let semanticUpdateStarted = false;
    try {
      if (extractionResult.triples.length > 0) {
        semanticUpdateStarted = true;
        // [SUCCESS LOGIC — handle()의 246~321줄을 그대로 이동]
        const unifiedForSemantic: UnifiedEmbeddingService = context.services.embeddingService
          ? context.services.embeddingService.getUnifiedEmbeddingService()
          : new UnifiedEmbeddingService();
        const relationGraph = context.services.relationGraph;
        if (!relationGraph) {
          throw new Error(RELATION_GRAPH_UNAVAILABLE_ERROR);
        }
        const semanticMemoryUpdateService = new SemanticMemoryUpdateService(db, relationGraph, unifiedForSemantic);
        const updateResult = await semanticMemoryUpdateService.updateSemanticMemory(
          extractionResult,
          { episodicMemoryId: episodicMemory.id, episodicImportance: episodicMemory.importance ?? 0.5 }
        );
        const confidenceValues: number[] = [];
        try {
          const relations = DatabaseUtils.all(db, `
            SELECT confidence FROM memory_relation
            WHERE target_id = ? AND relation_type = 'extracted_from'
          `, [episodicMemory.id]) as Array<{ confidence?: number | null }>;
          for (const rel of relations) {
            if (rel.confidence !== null && rel.confidence !== undefined) {
              confidenceValues.push(rel.confidence);
            }
          }
        } catch (err) {
          logger.warn('Confidence 수집 실패', {
            memory_id: episodicMemory.id,
            error: err instanceof Error ? err.message : String(err)
          });
        }
        const confidenceAvg = confidenceValues.length > 0
          ? confidenceValues.reduce((sum, c) => sum + c, 0) / confidenceValues.length
          : null;
        const metadata = {
          triple_count: extractionResult.triples.length,
          ...(confidenceAvg !== null && { confidence_avg: confidenceAvg }),
          extracted_at: new Date().toISOString()
        };
        await DatabaseUtils.run(db, `
          UPDATE memory_item SET triple_extracted = ?, triple_extracted_status = ?, triple_extraction_metadata = ?
          WHERE id = ?
        `, [1, 'success', JSON.stringify(metadata), episodicMemory.id]);
        results.success++;
        results.semantic_memory_ids.push(...updateResult.semanticMemoryIds);
        logger.info('Episodic Memory 변환 성공', {
          episodic_memory_id: episodicMemory.id,
          triple_count: extractionResult.triples.length,
          semantic_memory_count: updateResult.semanticMemoryIds.length,
          confidence_avg: confidenceAvg
        });
      } else {
        // [NO-TRIPLE LOGIC — handle()의 322~366줄을 그대로 이동]
        const failureReason = extractionResult.extractionInfo.failureReason || 'no_triple';
        let retryCount = 0;
        try {
          const existing = DatabaseUtils.get(db, `
            SELECT triple_extraction_metadata FROM memory_item WHERE id = ?
          `, [episodicMemory.id]) as { triple_extraction_metadata?: string } | undefined;
          if (existing?.triple_extraction_metadata) {
            const existingMeta = JSON.parse(existing.triple_extraction_metadata);
            retryCount = (existingMeta.retry_count || 0) + 1;
          } else {
            retryCount = 1;
          }
        } catch {
          retryCount = 1;
        }
        const noTripleMeta = { failureReason, retry_count: retryCount, last_attempt: new Date().toISOString() };
        await DatabaseUtils.run(db, `
          UPDATE memory_item SET triple_extracted = ?, triple_extracted_status = ?, triple_extraction_metadata = ?
          WHERE id = ?
        `, [0, 'failed', JSON.stringify(noTripleMeta), episodicMemory.id]);
        results.failed++;
        logger.warn('Episodic Memory 변환 실패', {
          episodic_memory_id: episodicMemory.id,
          failure_reason: failureReason,
          retry_count: retryCount
        });
      }
    } catch (error) {
      results.failed++;
      // [ERROR LOGIC — handle()의 368~406줄을 그대로 이동]
      const failureReason = error instanceof Error && error.message === RELATION_GRAPH_UNAVAILABLE_ERROR
        ? 'relation_graph_unavailable'
        : semanticUpdateStarted
          ? SEMANTIC_UPDATE_FAILED_ERROR
          : 'conversion_error';
      try {
        await DatabaseUtils.run(db, `
          UPDATE memory_item SET triple_extracted = ?, triple_extracted_status = ?, triple_extraction_metadata = ?
          WHERE id = ?
        `, [0, 'failed', JSON.stringify({
          failureReason,
          error: error instanceof Error ? error.message : String(error),
          last_attempt: new Date().toISOString()
        }), episodicMemory.id]);
      } catch (updateError) {
        logger.warn('상태 업데이트 실패', {
          episodic_memory_id: episodicMemory.id,
          error: updateError instanceof Error ? updateError.message : String(updateError)
        });
      }
      logger.error('Episodic Memory 변환 중 에러 발생', {
        episodic_memory_id: episodicMemory.id,
        failure_reason: failureReason,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
```

- [ ] **Step 2: `handle()`의 배치 루프 내부를 `convertSingleMemory()` 호출로 교체**

기존 배치 루프(233~408줄) 전체를:

```ts
      const tripleExtractionService = new TripleExtractionService();
      const toProcess = episodicMemories.filter((m) => !alreadyConvertedIds.has(m.id));
      results.skipped += episodicMemories.length - toProcess.length;

      const BATCH_SIZE = 3;
      for (let i = 0; i < toProcess.length; i += BATCH_SIZE) {
        const batch = toProcess.slice(i, i + BATCH_SIZE);
        const extractionResults = await Promise.all(
          batch.map((ep) => tripleExtractionService.extractTriples(ep.content, {}, ep.id))
        );
        for (let j = 0; j < batch.length; j++) {
          const episodicMemory = batch[j];
          const extractionResult = extractionResults[j];
          if (!episodicMemory || !extractionResult) continue;
          await this.convertSingleMemory(episodicMemory, extractionResult, db, context, results);
        }
      }
```

- [ ] **Step 3: 테스트 실행**

```bash
npx vitest run packages/memento-core/src/domains/memory/tools/__tests__/convert-episodic-to-semantic-tool.spec.ts
```

Expected: 15개 모두 PASS

- [ ] **Step 4: 커밋**

```bash
git add packages/memento-core/src/domains/memory/tools/convert-episodic-to-semantic-tool.ts
git commit -m "refactor(memory): convertSingleMemory() 추출 — semanticUpdateStarted 소유권 확정"
```

---

## Task 7: handleConversionSuccess() 추출

**Files:**
- Modify: `packages/memento-core/src/domains/memory/tools/convert-episodic-to-semantic-tool.ts`

- [ ] **Step 1: `handleConversionSuccess()` private 메서드 추가**

```ts
  private async handleConversionSuccess(
    episodicMemory: EpisodicMemoryRow,
    extractionResult: Awaited<ReturnType<TripleExtractionService['extractTriples']>>,
    db: Database.Database,
    context: ToolContext,
    results: ConversionResults,
  ): Promise<void> {
    const unifiedForSemantic: UnifiedEmbeddingService = context.services.embeddingService
      ? context.services.embeddingService.getUnifiedEmbeddingService()
      : new UnifiedEmbeddingService();
    const relationGraph = context.services.relationGraph;
    if (!relationGraph) {
      throw new Error(RELATION_GRAPH_UNAVAILABLE_ERROR);
    }

    const semanticMemoryUpdateService = new SemanticMemoryUpdateService(db, relationGraph, unifiedForSemantic);
    const updateResult = await semanticMemoryUpdateService.updateSemanticMemory(
      extractionResult,
      { episodicMemoryId: episodicMemory.id, episodicImportance: episodicMemory.importance ?? 0.5 }
    );

    const confidenceValues: number[] = [];
    try {
      const relations = DatabaseUtils.all(db, `
        SELECT confidence FROM memory_relation
        WHERE target_id = ? AND relation_type = 'extracted_from'
      `, [episodicMemory.id]) as Array<{ confidence?: number | null }>;
      for (const rel of relations) {
        if (rel.confidence !== null && rel.confidence !== undefined) {
          confidenceValues.push(rel.confidence);
        }
      }
    } catch (err) {
      logger.warn('Confidence 수집 실패', {
        memory_id: episodicMemory.id,
        error: err instanceof Error ? err.message : String(err)
      });
    }

    const confidenceAvg = confidenceValues.length > 0
      ? confidenceValues.reduce((sum, c) => sum + c, 0) / confidenceValues.length
      : null;

    const metadata = {
      triple_count: extractionResult.triples.length,
      ...(confidenceAvg !== null && { confidence_avg: confidenceAvg }),
      extracted_at: new Date().toISOString()
    };

    await DatabaseUtils.run(db, `
      UPDATE memory_item SET triple_extracted = ?, triple_extracted_status = ?, triple_extraction_metadata = ?
      WHERE id = ?
    `, [1, 'success', JSON.stringify(metadata), episodicMemory.id]);

    results.success++;
    results.semantic_memory_ids.push(...updateResult.semanticMemoryIds);

    logger.info('Episodic Memory 변환 성공', {
      episodic_memory_id: episodicMemory.id,
      triple_count: extractionResult.triples.length,
      semantic_memory_count: updateResult.semanticMemoryIds.length,
      confidence_avg: confidenceAvg
    });
  }
```

- [ ] **Step 2: `convertSingleMemory()` 내 success 인라인 블록을 메서드 호출로 교체**

`if (extractionResult.triples.length > 0) {` 블록 내부를:

```ts
        semanticUpdateStarted = true;
        await this.handleConversionSuccess(episodicMemory, extractionResult, db, context, results);
```

- [ ] **Step 3: 테스트 실행**

```bash
npx vitest run packages/memento-core/src/domains/memory/tools/__tests__/convert-episodic-to-semantic-tool.spec.ts
```

Expected: 15개 모두 PASS

- [ ] **Step 4: 커밋**

```bash
git add packages/memento-core/src/domains/memory/tools/convert-episodic-to-semantic-tool.ts
git commit -m "refactor(memory): handleConversionSuccess() 추출"
```

---

## Task 8: handleNoTriples() 추출

**Files:**
- Modify: `packages/memento-core/src/domains/memory/tools/convert-episodic-to-semantic-tool.ts`

- [ ] **Step 1: `handleNoTriples()` private 메서드 추가**

```ts
  private async handleNoTriples(
    episodicMemory: EpisodicMemoryRow,
    extractionResult: Awaited<ReturnType<TripleExtractionService['extractTriples']>>,
    db: Database.Database,
    results: ConversionResults,
  ): Promise<void> {
    const failureReason = extractionResult.extractionInfo.failureReason || 'no_triple';

    let retryCount = 0;
    try {
      const existing = DatabaseUtils.get(db, `
        SELECT triple_extraction_metadata FROM memory_item WHERE id = ?
      `, [episodicMemory.id]) as { triple_extraction_metadata?: string } | undefined;
      if (existing?.triple_extraction_metadata) {
        const existingMeta = JSON.parse(existing.triple_extraction_metadata);
        retryCount = (existingMeta.retry_count || 0) + 1;
      } else {
        retryCount = 1;
      }
    } catch {
      retryCount = 1;
    }

    const metadata = { failureReason, retry_count: retryCount, last_attempt: new Date().toISOString() };

    await DatabaseUtils.run(db, `
      UPDATE memory_item SET triple_extracted = ?, triple_extracted_status = ?, triple_extraction_metadata = ?
      WHERE id = ?
    `, [0, 'failed', JSON.stringify(metadata), episodicMemory.id]);

    results.failed++;

    logger.warn('Episodic Memory 변환 실패', {
      episodic_memory_id: episodicMemory.id,
      failure_reason: failureReason,
      retry_count: retryCount
    });
  }
```

- [ ] **Step 2: `convertSingleMemory()` 내 no-triple 인라인 블록을 메서드 호출로 교체**

`} else {` 블록 내부를:

```ts
        await this.handleNoTriples(episodicMemory, extractionResult, db, results);
```

- [ ] **Step 3: 테스트 실행**

```bash
npx vitest run packages/memento-core/src/domains/memory/tools/__tests__/convert-episodic-to-semantic-tool.spec.ts
```

Expected: 15개 모두 PASS

- [ ] **Step 4: 커밋**

```bash
git add packages/memento-core/src/domains/memory/tools/convert-episodic-to-semantic-tool.ts
git commit -m "refactor(memory): handleNoTriples() 추출"
```

---

## Task 9: handleConversionError() 추출

**Files:**
- Modify: `packages/memento-core/src/domains/memory/tools/convert-episodic-to-semantic-tool.ts`

- [ ] **Step 1: `handleConversionError()` private 메서드 추가**

```ts
  private async handleConversionError(
    episodicMemory: EpisodicMemoryRow,
    error: unknown,
    semanticUpdateStarted: boolean,
    db: Database.Database,
    results: ConversionResults,
  ): Promise<void> {
    const failureReason = error instanceof Error && error.message === RELATION_GRAPH_UNAVAILABLE_ERROR
      ? 'relation_graph_unavailable'
      : semanticUpdateStarted
        ? SEMANTIC_UPDATE_FAILED_ERROR
        : 'conversion_error';

    try {
      await DatabaseUtils.run(db, `
        UPDATE memory_item SET triple_extracted = ?, triple_extracted_status = ?, triple_extraction_metadata = ?
        WHERE id = ?
      `, [0, 'failed', JSON.stringify({
        failureReason,
        error: error instanceof Error ? error.message : String(error),
        last_attempt: new Date().toISOString()
      }), episodicMemory.id]);
    } catch (updateError) {
      logger.warn('상태 업데이트 실패', {
        episodic_memory_id: episodicMemory.id,
        error: updateError instanceof Error ? updateError.message : String(updateError)
      });
    }

    logger.error('Episodic Memory 변환 중 에러 발생', {
      episodic_memory_id: episodicMemory.id,
      failure_reason: failureReason,
      error: error instanceof Error ? error.message : String(error)
    });
  }
```

- [ ] **Step 2: `convertSingleMemory()` 내 catch 블록을 메서드 호출로 교체**

```ts
    } catch (error) {
      results.failed++;
      await this.handleConversionError(episodicMemory, error, semanticUpdateStarted, db, results);
    }
```

- [ ] **Step 3: 테스트 실행**

```bash
npx vitest run packages/memento-core/src/domains/memory/tools/__tests__/convert-episodic-to-semantic-tool.spec.ts
```

Expected: 15개 모두 PASS

- [ ] **Step 4: 커밋**

```bash
git add packages/memento-core/src/domains/memory/tools/convert-episodic-to-semantic-tool.ts
git commit -m "refactor(memory): handleConversionError() 추출"
```

---

## Task 10: handle() 최종 정리 + 전체 검증 + PR

**Files:**
- Modify: `packages/memento-core/src/domains/memory/tools/convert-episodic-to-semantic-tool.ts`

- [ ] **Step 1: `handle()` 파라미터 타입을 `any` → `unknown`으로 변경**

```ts
  async handle(params: unknown, context: ToolContext): Promise<ToolResult> {
```

- [ ] **Step 2: `handle()` 최종 형태 확인**

리팩토링 후 `handle()`의 최종 형태:

```ts
  async handle(params: unknown, context: ToolContext): Promise<ToolResult> {
    try {
      const {
        memory_id,
        skip_converted = true,
        retry_failed = false,
        limit = 10
      } = ConvertEpisodicToSemanticSchema.parse(params);

      const db = context.db;
      if (!db) {
        return this.createErrorResult('DATABASE_NOT_AVAILABLE', '데이터베이스가 사용 가능하지 않습니다');
      }

      const resolved = this.resolveMemories(db, memory_id, skip_converted, retry_failed, limit);
      if (!Array.isArray(resolved)) return resolved;
      const episodicMemories = resolved;

      const results: ConversionResults = {
        total: episodicMemories.length,
        success: 0,
        failed: 0,
        skipped: 0,
        semantic_memory_ids: []
      };

      const alreadyConvertedIds = this.fetchAlreadyConverted(db, episodicMemories, skip_converted);
      const tripleExtractionService = new TripleExtractionService();
      const toProcess = episodicMemories.filter((m) => !alreadyConvertedIds.has(m.id));
      results.skipped += episodicMemories.length - toProcess.length;

      const BATCH_SIZE = 3;
      for (let i = 0; i < toProcess.length; i += BATCH_SIZE) {
        const batch = toProcess.slice(i, i + BATCH_SIZE);
        const extractionResults = await Promise.all(
          batch.map((ep) => tripleExtractionService.extractTriples(ep.content, {}, ep.id))
        );
        for (let j = 0; j < batch.length; j++) {
          const episodicMemory = batch[j];
          const extractionResult = extractionResults[j];
          if (!episodicMemory || !extractionResult) continue;
          await this.convertSingleMemory(episodicMemory, extractionResult, db, context, results);
        }
      }

      return this.createSuccessResult({
        total: results.total,
        success: results.success,
        failed: results.failed,
        skipped: results.skipped,
        semantic_memory_ids: results.semantic_memory_ids
      });
    } catch (error) {
      logger.error('ConvertEpisodicToSemanticTool: 에러 발생', {
        error: error instanceof Error ? error.message : String(error)
      });
      return this.createErrorResult('CONVERSION_ERROR', error instanceof Error ? error.message : String(error));
    }
  }
```

- [ ] **Step 3: 전체 테스트 스위트 실행**

```bash
npx vitest run packages/memento-core/src/domains/memory/tools/__tests__/convert-episodic-to-semantic-tool.spec.ts
```

Expected: 15개 모두 PASS

- [ ] **Step 4: type-check 실행**

```bash
npm run type-check -w @memento/core
```

Expected: 에러 없음

- [ ] **Step 5: 전체 테스트 실행**

```bash
npm test
```

Expected: PASS

- [ ] **Step 6: 최종 커밋**

```bash
git add packages/memento-core/src/domains/memory/tools/convert-episodic-to-semantic-tool.ts
git commit -m "refactor(memory): handle() 최종 정리 — params: any → unknown"
```

- [ ] **Step 7: PR 생성**

```bash
gh pr create \
  --title "refactor(memory): ConvertEpisodicToSemanticTool.handle() 분리 (issue #164)" \
  --body "$(cat <<'EOF'
## Summary
- `handle()` 344줄 → ~40줄, complexity 43 → ~5, 중첩 9 → ~3
- 8개 private 메서드 추출: `resolveMemories`, `fetchSingleMemory`, `fetchBatchMemories`, `fetchAlreadyConverted`, `convertSingleMemory`, `handleConversionSuccess`, `handleNoTriples`, `handleConversionError`
- 동작 변경 없음 (순수 구조 리팩토링)
- 테스트 8개 → 15개 (경계 케이스 7개 추가)

## Test plan
- [ ] `npx vitest run packages/memento-core/src/domains/memory/tools/__tests__/convert-episodic-to-semantic-tool.spec.ts` — 15개 PASS
- [ ] `npm run type-check -w @memento/core` — 에러 없음
- [ ] `npm test` — 전체 PASS

Closes #164

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## 성공 기준 체크리스트

- [ ] `handle()` 줄 수 344 → ~40
- [ ] `handle()` complexity 43 → ~5
- [ ] 중첩 깊이 9 → ~3
- [ ] 기존 테스트 8개 + 신규 7개 = 15개 모두 PASS
- [ ] `npm run type-check -w @memento/core` PASS
- [ ] `npm test` PASS
- [ ] 동작 변경 없음 (순수 구조 리팩토링)
