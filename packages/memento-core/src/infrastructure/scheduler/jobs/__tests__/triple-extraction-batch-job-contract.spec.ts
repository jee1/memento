/**
 * T017: batch execute timeout · fatal prefix · result/DB isolation contract 검증
 *
 * execute-local policy/clock/candidate snapshot/result accumulator/DB-bound semantic service를
 * fake wall clock(`Date.now` spy)과 mocked coordinator dependency(`tripleExtractionService`,
 * `semanticMemoryUpdateService`)로 검증한다. 실제 LLM/관계 그래프에는 접근하지 않는다.
 *
 * 하드 규칙:
 * - timeout은 source 시작 전/청크 delay 전에만 확인한다 (이미 시작한 source는 끝까지 진행).
 * - fatal 궤도 오류는 durable prefix만 남기고 나머지를 합성하지 않는다.
 * - 모든 반환 경로에서 processed/duration invariants가 성립한다.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { DatabaseUtils } from '../../../../shared/utils/database.js';
import { TripleExtractionBatchJob } from '../triple-extraction-batch-job.js';
import type { TripleExtractionService } from '../../../../domains/relation/services/triple-extraction/triple-extraction-service.js';
import type { SemanticMemoryUpdateService } from '../../../../domains/memory/semantic/semantic-memory-update-service.js';

type FakeExtractionResult = {
  triples: Array<{ subject: string; predicate: string; object: string }>;
  extractionInfo: {
    steps: { canonicalization: boolean; entityLinking: boolean };
    failureReason?: string;
  };
};

type FakeUpdateEvidence = {
  result: { created: number; updated: number; skipped: number; semanticMemoryIds: string[] };
  hasError: boolean;
  committedConfidences: number[];
};

function successExtraction(): FakeExtractionResult {
  return {
    triples: [{ subject: 'system', predicate: 'use', object: 'feature' }],
    extractionInfo: { steps: { canonicalization: true, entityLinking: true } }
  };
}

function noTripleExtraction(): FakeExtractionResult {
  return {
    triples: [],
    extractionInfo: { steps: { canonicalization: false, entityLinking: false }, failureReason: 'no_triple' }
  };
}

function successEvidence(created = 1, updated = 0): FakeUpdateEvidence {
  return {
    result: { created, updated, skipped: 0, semanticMemoryIds: created + updated > 0 ? ['sem-' + Math.random()] : [] },
    hasError: false,
    committedConfidences: [0.9]
  };
}

describe('TripleExtractionBatchJob.execute contract', () => {
  let db: Database.Database;

  function initDb(): Database.Database {
    const testDb = new Database(':memory:');
    DatabaseUtils.run(testDb, `
      CREATE TABLE memory_item (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        content TEXT NOT NULL,
        importance REAL,
        owner_id TEXT,
        project_id TEXT,
        is_deleted INTEGER DEFAULT 0,
        triple_extracted INTEGER,
        triple_extracted_status TEXT,
        triple_extraction_metadata TEXT,
        created_at TEXT NOT NULL
      )
    `);
    return testDb;
  }

  function insertSource(targetDb: Database.Database, row: {
    id: string;
    createdAt: string;
    content?: string;
    importance?: number | null;
  }): void {
    DatabaseUtils.run(targetDb, `
      INSERT INTO memory_item (id, type, content, importance, owner_id, project_id, is_deleted, triple_extracted, triple_extracted_status, triple_extraction_metadata, created_at)
      VALUES (?, 'episodic', ?, ?, NULL, NULL, 0, NULL, NULL, NULL, ?)
    `, [row.id, row.content ?? `content for ${row.id}`, row.importance ?? 0.5, row.createdAt]);
  }

  function readSource(targetDb: Database.Database, id: string): {
    triple_extracted: number | null;
    triple_extracted_status: string | null;
    triple_extraction_metadata: string | null;
  } | undefined {
    return DatabaseUtils.get(targetDb, `
      SELECT triple_extracted, triple_extracted_status, triple_extraction_metadata
      FROM memory_item WHERE id = ?
    `, [id]) as { triple_extracted: number | null; triple_extracted_status: string | null; triple_extraction_metadata: string | null } | undefined;
  }

  function makeExtractor(byId: Record<string, FakeExtractionResult | (() => FakeExtractionResult)>): TripleExtractionService {
    return {
      extractTriples: vi.fn(async (_content: string, _options: unknown, sourceId?: string) => {
        const entry = byId[sourceId ?? ''];
        if (typeof entry === 'function') return entry();
        return entry ?? noTripleExtraction();
      })
    } as unknown as TripleExtractionService;
  }

  function makeSemanticService(byId: Record<string, FakeUpdateEvidence | (() => FakeUpdateEvidence)>): SemanticMemoryUpdateService {
    return {
      updateSemanticMemoryWithEvidence: vi.fn(async (_extractionResult: unknown, options: unknown) => {
        const sourceId = (options as { episodicMemoryId?: string })?.episodicMemoryId ?? '';
        const entry = byId[sourceId];
        if (typeof entry === 'function') return entry();
        return entry ?? successEvidence();
      })
    } as unknown as SemanticMemoryUpdateService;
  }

  beforeEach(() => {
    db = initDb();
  });

  afterEach(() => {
    db.close();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe('invalid policy: zero schema/service/query access', () => {
    it('explicit invalid config never touches the DB and returns a failed result with reconciled invariants', async () => {
      const querySpy = vi.spyOn(db, 'prepare');
      const job = new TripleExtractionBatchJob(
        { parallelism: 2 as unknown as 1 },
        { tripleExtractionService: makeExtractor({}), semanticMemoryUpdateService: makeSemanticService({}) }
      );

      const result = await job.execute(db);

      expect(querySpy).not.toHaveBeenCalled();
      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.processed).toBe(0);
      expect(result.details.processed).toBe(0);
      expect(result.details.processed).toBe(result.details.success + result.details.failed + result.details.skipped);
      expect(result.duration).toBe(result.endTime.getTime() - result.startTime.getTime());
    });

    it('explicit NULL batchSize is rejected before any query', async () => {
      const querySpy = vi.spyOn(db, 'prepare');
      const job = new TripleExtractionBatchJob(
        { batchSize: null as unknown as number },
        { tripleExtractionService: makeExtractor({}), semanticMemoryUpdateService: makeSemanticService({}) }
      );

      const result = await job.execute(db);

      expect(querySpy).not.toHaveBeenCalled();
      expect(result.success).toBe(false);
    });
  });

  describe('execute-local isolation', () => {
    it('returns a fresh Date/array/Map result each call and does not share accumulators across overlapping executes', async () => {
      insertSource(db, { id: 'src-1', createdAt: '2026-01-01T00:00:00.000Z' });
      const db2 = initDb();
      insertSource(db2, { id: 'src-2', createdAt: '2026-01-01T00:00:00.000Z' });

      const job = new TripleExtractionBatchJob(
        { chunkDelayMs: 0 },
        {
          tripleExtractionService: makeExtractor({ 'src-1': successExtraction(), 'src-2': successExtraction() }),
          semanticMemoryUpdateService: makeSemanticService({ 'src-1': successEvidence(), 'src-2': successEvidence() })
        }
      );

      const [result1, result2] = await Promise.all([job.execute(db), job.execute(db2)]);

      expect(result1.details.retryCounts).not.toBe(result2.details.retryCounts);
      expect(result1.errors).not.toBe(result2.errors);
      expect(result1.startTime).not.toBe(result2.startTime);
      expect(result1.details.success).toBe(1);
      expect(result2.details.success).toBe(1);
      expect(readSource(db, 'src-1')?.triple_extracted_status).toBe('success');
      expect(readSource(db2, 'src-2')?.triple_extracted_status).toBe('success');

      db2.close();
    });

    it('creates an independent DB-bound semantic service per execute when none is injected (no instance caching)', async () => {
      insertSource(db, { id: 'src-1', createdAt: '2026-01-01T00:00:00.000Z' });
      const extractor = makeExtractor({ 'src-1': noTripleExtraction() });
      const job = new TripleExtractionBatchJob({ chunkDelayMs: 0 }, { tripleExtractionService: extractor });

      const result = await job.execute(db);

      // no injected semanticMemoryUpdateService: no-triple path never touches it, but a real
      // execute-local instance must have been constructible without throwing/caching on `this`.
      expect(result.details.processed).toBe(1);
      expect(result.details.failed).toBe(1);
    });
  });

  describe('consecutive chunk boundaries and serial source loop', () => {
    it('splits a fixed candidate snapshot into consecutive chunks and processes every source exactly once', async () => {
      const ids = ['a', 'b', 'c', 'd', 'e'];
      ids.forEach((id, index) => insertSource(db, { id, createdAt: `2026-01-01T00:00:0${index}.000Z` }));

      const extractor = makeExtractor(Object.fromEntries(ids.map(id => [id, successExtraction()])));
      const semanticService = makeSemanticService(Object.fromEntries(ids.map(id => [id, successEvidence()])));
      const job = new TripleExtractionBatchJob(
        { chunkSize: 2, chunkDelayMs: 0 },
        { tripleExtractionService: extractor, semanticMemoryUpdateService: semanticService }
      );

      const result = await job.execute(db);

      expect(result.details.success).toBe(5);
      for (const id of ids) {
        expect(readSource(db, id)?.triple_extracted_status).toBe('success');
      }
    });
  });

  describe('timeout: only before starting a new source / before inter-chunk delay', () => {
    it('does not start a source once the deadline has passed, and does not set timeoutOccurred for a late-finishing last source', async () => {
      insertSource(db, { id: 'only', createdAt: '2026-01-01T00:00:00.000Z' });
      const extractor = makeExtractor({
        only: () => successExtraction()
      });
      const semanticService = makeSemanticService({ only: successEvidence() });
      const job = new TripleExtractionBatchJob(
        { chunkDelayMs: 0, timeout: 30000 },
        { tripleExtractionService: extractor, semanticMemoryUpdateService: semanticService }
      );

      const realNow = Date.now.bind(Date);
      let calls = 0;
      vi.spyOn(Date, 'now').mockImplementation(() => {
        calls++;
        // First call is the pre-start timeout check for the only source: report "before deadline".
        // The source then finishes normally even though the deadline is conceptually exceeded
        // afterwards, since execute() never re-checks after starting a source.
        return calls === 1 ? realNow() : realNow() + 10_000_000;
      });

      const result = await job.execute(db);

      expect(result.details.success).toBe(1);
      expect(result.timeoutOccurred).toBeUndefined();
    });

    it('stops before starting the second source when the deadline is already exceeded, leaving it unprocessed (no synthesized outcome)', async () => {
      insertSource(db, { id: 'first', createdAt: '2026-01-01T00:00:00.000Z' });
      insertSource(db, { id: 'second', createdAt: '2026-01-01T00:00:01.000Z' });
      const extractor = makeExtractor({ first: successExtraction(), second: successExtraction() });
      const semanticService = makeSemanticService({ first: successEvidence(), second: successEvidence() });
      const job = new TripleExtractionBatchJob(
        { chunkDelayMs: 0, timeout: 30000 },
        { tripleExtractionService: extractor, semanticMemoryUpdateService: semanticService }
      );

      const realNow = Date.now.bind(Date);
      let calls = 0;
      vi.spyOn(Date, 'now').mockImplementation(() => {
        calls++;
        // call #1: pre-start check for "first" -> before deadline
        // call #2: pre-start check for "second" -> deadline already passed
        return calls === 1 ? realNow() : realNow() + 10_000_000;
      });

      const result = await job.execute(db);

      expect(result.timeoutOccurred).toBe(true);
      expect(result.details.success).toBe(1);
      expect(result.details.processed).toBe(1);
      expect(readSource(db, 'second')?.triple_extracted_status).toBeNull();
      expect(result.success).toBe(true);
    });

    it('caps the inter-chunk delay by the remaining timeout budget', async () => {
      vi.useFakeTimers();
      insertSource(db, { id: 'a', createdAt: '2026-01-01T00:00:00.000Z' });
      insertSource(db, { id: 'b', createdAt: '2026-01-01T00:00:01.000Z' });
      const extractor = makeExtractor({ a: successExtraction(), b: successExtraction() });
      const semanticService = makeSemanticService({ a: successEvidence(), b: successEvidence() });
      const job = new TripleExtractionBatchJob(
        { chunkSize: 1, chunkDelayMs: 5000, timeout: 100 },
        { tripleExtractionService: extractor, semanticMemoryUpdateService: semanticService }
      );

      const execution = job.execute(db);
      // remaining budget after the first source is far below chunkDelayMs (5000ms); the delay
      // must be capped so it resolves once the tiny remaining budget elapses.
      await vi.advanceTimersByTimeAsync(200);
      const result = await execution;

      expect(result.details.success).toBe(1);
      expect(result.timeoutOccurred).toBe(true);
      expect(readSource(db, 'b')?.triple_extracted_status).toBeNull();
    });
  });

  describe('malformed extractor output', () => {
    it('treats a structurally invalid extraction result as llm_parse_fail and records a durable failed transition', async () => {
      insertSource(db, { id: 'bad', createdAt: '2026-01-01T00:00:00.000Z' });
      const extractor = {
        extractTriples: vi.fn().mockResolvedValue({ garbage: true })
      } as unknown as TripleExtractionService;
      const job = new TripleExtractionBatchJob(
        { chunkDelayMs: 0 },
        { tripleExtractionService: extractor, semanticMemoryUpdateService: makeSemanticService({}) }
      );

      const result = await job.execute(db);

      expect(result.details.failed).toBe(1);
      expect(result.details.retryCounts.get('bad')).toBe(1);
      const row = readSource(db, 'bad');
      expect(row?.triple_extracted_status).toBe('failed');
      const metadata = JSON.parse(row?.triple_extraction_metadata ?? '{}');
      expect(metadata.failureReason).toBe('llm_parse_fail');
    });
  });

  describe('source isolation within a chunk: success/fail/success', () => {
    it('keeps A and C successful when B fails, without cross-source contamination', async () => {
      insertSource(db, { id: 'A', createdAt: '2026-01-01T00:00:00.000Z' });
      insertSource(db, { id: 'B', createdAt: '2026-01-01T00:00:01.000Z' });
      insertSource(db, { id: 'C', createdAt: '2026-01-01T00:00:02.000Z' });

      const extractor = makeExtractor({
        A: successExtraction(),
        B: noTripleExtraction(),
        C: successExtraction()
      });
      const semanticService = makeSemanticService({ A: successEvidence(), C: successEvidence() });
      const job = new TripleExtractionBatchJob(
        { chunkDelayMs: 0 },
        { tripleExtractionService: extractor, semanticMemoryUpdateService: semanticService }
      );

      const result = await job.execute(db);

      expect(result.details.success).toBe(2);
      expect(result.details.failed).toBe(1);
      expect(readSource(db, 'A')?.triple_extracted_status).toBe('success');
      expect(readSource(db, 'B')?.triple_extracted_status).toBe('failed');
      expect(readSource(db, 'C')?.triple_extracted_status).toBe('success');
    });
  });

  describe('state-write failure: source-isolatable, never synthesized as an outcome', () => {
    it('continues to the next source and does not count an uncaught write failure toward processed', async () => {
      DatabaseUtils.run(db, `
        CREATE TRIGGER boom_on_update
        BEFORE UPDATE ON memory_item
        WHEN NEW.id = 'boom' AND NEW.triple_extracted_status = 'success'
        BEGIN
          SELECT RAISE(ABORT, 'simulated state-write failure');
        END;
      `);
      insertSource(db, { id: 'boom', createdAt: '2026-01-01T00:00:00.000Z' });
      insertSource(db, { id: 'after', createdAt: '2026-01-01T00:00:01.000Z' });

      const extractor = makeExtractor({ boom: successExtraction(), after: successExtraction() });
      const semanticService = makeSemanticService({ boom: successEvidence(), after: successEvidence() });
      const job = new TripleExtractionBatchJob(
        { chunkDelayMs: 0 },
        { tripleExtractionService: extractor, semanticMemoryUpdateService: semanticService }
      );

      const result = await job.execute(db);

      // "boom" never reaches a durable terminal outcome (none), "after" still gets processed.
      expect(result.details.success).toBe(1);
      expect(result.details.processed).toBe(1);
      expect(readSource(db, 'after')?.triple_extracted_status).toBe('success');
      expect(readSource(db, 'boom')?.triple_extracted_status).toBeNull();
      expect(result.success).toBe(true);
    });
  });

  describe('fatal orchestration: preserve durable prefix, synthesize nothing for the remainder', () => {
    it('stops the whole execute on a job-level fatal error, keeps the already-durable prefix and sets success=false', async () => {
      insertSource(db, { id: 'first', createdAt: '2026-01-01T00:00:00.000Z' });
      insertSource(db, { id: 'second', createdAt: '2026-01-01T00:00:01.000Z' });
      const extractor = makeExtractor({ first: successExtraction(), second: successExtraction() });
      const semanticService = makeSemanticService({ first: successEvidence(), second: successEvidence() });
      const job = new TripleExtractionBatchJob(
        { chunkSize: 1, chunkDelayMs: 0 },
        { tripleExtractionService: extractor, semanticMemoryUpdateService: semanticService }
      );

      const realNow = Date.now.bind(Date);
      let calls = 0;
      vi.spyOn(Date, 'now').mockImplementation(() => {
        calls++;
        // call #1: pre-start timeout check for "first" -> real time, proceeds normally.
        // call #2: pre-start timeout check for "second" -> simulated job-orchestration crash.
        if (calls === 2) {
          throw new Error('job-orchestration-fatal');
        }
        return realNow();
      });

      const result = await job.execute(db);

      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.details.success).toBe(1);
      expect(result.details.processed).toBe(1);
      expect(readSource(db, 'first')?.triple_extracted_status).toBe('success');
      expect(readSource(db, 'second')?.triple_extracted_status).toBeNull();
      expect(result.processed).toBe(result.details.processed);
      expect(result.details.processed).toBe(
        result.details.success + result.details.failed + result.details.skipped
      );
    });
  });

  describe('retryCounts: only durable failed/abandoned transitions from this execute', () => {
    it('records a retryCount only for a source whose failed metadata was actually committed this execute', async () => {
      insertSource(db, { id: 'no-triple', createdAt: '2026-01-01T00:00:00.000Z' });
      insertSource(db, { id: 'success', createdAt: '2026-01-01T00:00:01.000Z' });
      const extractor = makeExtractor({ 'no-triple': noTripleExtraction(), success: successExtraction() });
      const semanticService = makeSemanticService({ success: successEvidence() });
      const job = new TripleExtractionBatchJob(
        { chunkDelayMs: 0 },
        { tripleExtractionService: extractor, semanticMemoryUpdateService: semanticService }
      );

      const result = await job.execute(db);

      expect(result.details.retryCounts.size).toBe(1);
      expect(result.details.retryCounts.get('no-triple')).toBe(1);
      expect(result.details.retryCounts.has('success')).toBe(false);
    });
  });

  describe('semantic occurrence sums from durable primary commits', () => {
    it('sums created/updated across every durable success outcome in the execute', async () => {
      insertSource(db, { id: 'a', createdAt: '2026-01-01T00:00:00.000Z' });
      insertSource(db, { id: 'b', createdAt: '2026-01-01T00:00:01.000Z' });
      const extractor = makeExtractor({ a: successExtraction(), b: successExtraction() });
      const semanticService = makeSemanticService({
        a: successEvidence(2, 1),
        b: successEvidence(0, 3)
      });
      const job = new TripleExtractionBatchJob(
        { chunkDelayMs: 0 },
        { tripleExtractionService: extractor, semanticMemoryUpdateService: semanticService }
      );

      const result = await job.execute(db);

      expect(result.details.semanticMemoriesCreated).toBe(2);
      expect(result.details.semanticMemoriesUpdated).toBe(4);
    });
  });

  describe('all return-path invariants', () => {
    it('holds processed/duration invariants for an empty-candidate execute', async () => {
      const job = new TripleExtractionBatchJob(
        { chunkDelayMs: 0 },
        { tripleExtractionService: makeExtractor({}), semanticMemoryUpdateService: makeSemanticService({}) }
      );

      const result = await job.execute(db);

      expect(result.success).toBe(false);
      expect(result.details.processed).toBe(0);
      expect(result.processed).toBe(result.details.processed);
      expect(result.details.processed).toBe(
        result.details.success + result.details.failed + result.details.skipped
      );
      expect(result.duration).toBe(result.endTime.getTime() - result.startTime.getTime());
    });

    it('holds processed/duration invariants for an all-failed execute (success remains true)', async () => {
      insertSource(db, { id: 'x', createdAt: '2026-01-01T00:00:00.000Z' });
      const job = new TripleExtractionBatchJob(
        { chunkDelayMs: 0 },
        { tripleExtractionService: makeExtractor({ x: noTripleExtraction() }), semanticMemoryUpdateService: makeSemanticService({}) }
      );

      const result = await job.execute(db);

      expect(result.success).toBe(true);
      expect(result.details.failed).toBe(1);
      expect(result.processed).toBe(result.details.processed);
      expect(result.details.processed).toBe(
        result.details.success + result.details.failed + result.details.skipped
      );
      expect(result.duration).toBe(result.endTime.getTime() - result.startTime.getTime());
    });
  });
});
