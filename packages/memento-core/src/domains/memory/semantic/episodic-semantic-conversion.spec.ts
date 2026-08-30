import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { setupTestDatabase, cleanupTestDatabase } from '../../../../test/helpers/test-database.js';
import { DatabaseUtils } from '../../../shared/utils/database.js';
import { createRelationGraph } from '../../../infrastructure/relation-graph-factory.js';
import type { TripleExtractionResult } from '../../../shared/types/triple-extraction.js';
import type { MemoryEmbeddingService } from '../services/memory-embedding-service.js';
import { SemanticMemoryUpdateService } from './semantic-memory-update-service.js';
import type { SemanticMemoryUpdateResult } from './semantic-memory-update-types.js';
import {
  convertEpisodicSource,
  type EpisodicSemanticConversionDependencies,
  type EpisodicSemanticConversionOptions
} from './episodic-semantic-conversion.js';

describe('convertEpisodicSource', () => {
  let db: Database.Database;

  beforeEach(async () => {
    db = await setupTestDatabase();
  });

  afterEach(() => {
    cleanupTestDatabase(db);
    vi.restoreAllMocks();
  });

  function insertEpisodic(overrides: {
    id?: string;
    content?: string;
    importance?: number | null;
    ownerId?: string | null;
    projectId?: string | null;
    tripleExtracted?: number | null;
    tripleExtractedStatus?: string | null;
    tripleExtractionMetadata?: Record<string, unknown> | null;
    isDeleted?: 0 | 1;
  } = {}): string {
    const id = overrides.id ?? 'episode-1';
    DatabaseUtils.run(db, `
      INSERT INTO memory_item (
        id, type, content, importance, owner_id, project_id, is_deleted,
        triple_extracted, triple_extracted_status, triple_extraction_metadata
      ) VALUES (?, 'episodic', ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      id,
      overrides.content ?? `${id} content`,
      overrides.importance === undefined ? 0.5 : overrides.importance,
      overrides.ownerId ?? null,
      overrides.projectId ?? null,
      overrides.isDeleted ?? 0,
      overrides.tripleExtracted ?? 0,
      overrides.tripleExtractedStatus ?? null,
      overrides.tripleExtractionMetadata ? JSON.stringify(overrides.tripleExtractionMetadata) : null
    ]);
    return id;
  }

  function readSource(id: string): {
    triple_extracted: number | null;
    triple_extracted_status: string | null;
    triple_extraction_metadata: string | null;
    content: string;
  } | undefined {
    return DatabaseUtils.get(db, `
      SELECT triple_extracted, triple_extracted_status, triple_extraction_metadata, content
      FROM memory_item WHERE id = ?
    `, [id]) as {
      triple_extracted: number | null;
      triple_extracted_status: string | null;
      triple_extraction_metadata: string | null;
      content: string;
    } | undefined;
  }

  function readMetadata(id: string): Record<string, unknown> {
    const row = readSource(id);
    return row?.triple_extraction_metadata ? JSON.parse(row.triple_extraction_metadata) : {};
  }

  function validExtraction(triples: Array<{ subject: string; predicate: string; object: string }> = [
    { subject: 'system', predicate: 'use', object: 'feature' }
  ]): TripleExtractionResult {
    return {
      triples,
      extractionInfo: { steps: { canonicalization: true, entityLinking: true } }
    };
  }

  function baseOptions(overrides: Partial<EpisodicSemanticConversionOptions> = {}): EpisodicSemanticConversionOptions {
    return {
      sourceId: 'episode-1',
      skipConverted: true,
      maxRetries: 3,
      retryBackoffDays: [1, 2, 4],
      now: () => new Date('2024-06-01T00:00:00.000Z'),
      ...overrides
    };
  }

  function fakeEvidenceService(
    impl: (extractionResult: unknown, options: unknown) => Promise<{
      result: SemanticMemoryUpdateResult;
      hasError: boolean;
      committedConfidences: number[];
    }>
  ): SemanticMemoryUpdateService {
    return {
      updateSemanticMemoryWithEvidence: vi.fn(impl)
    } as unknown as SemanticMemoryUpdateService;
  }

  function realService(): SemanticMemoryUpdateService {
    return new SemanticMemoryUpdateService(
      db,
      createRelationGraph(db),
      undefined,
      undefined,
      { createAndStoreEmbedding: vi.fn().mockResolvedValue(undefined) } as unknown as MemoryEmbeddingService
    );
  }

  function deps(
    overrides: Partial<EpisodicSemanticConversionDependencies> = {}
  ): EpisodicSemanticConversionDependencies {
    return {
      db,
      tripleExtractionService: { extractTriples: vi.fn().mockResolvedValue(validExtraction()) },
      semanticMemoryUpdateService: realService(),
      ...overrides
    };
  }

  describe('primary + source success atomic commit', () => {
    it('commits the semantic evidence and source success tuple together for a real conversion', async () => {
      insertEpisodic({ importance: 0.8 });
      const extractTriples = vi.fn().mockResolvedValue(validExtraction([
        { subject: 'system', predicate: 'use', object: 'feature' }
      ]));

      const outcome = await convertEpisodicSource(
        deps({ tripleExtractionService: { extractTriples } }),
        baseOptions()
      );

      expect(outcome.kind).toBe('success');
      if (outcome.kind !== 'success') throw new Error('expected success');
      expect(outcome.update.created).toBe(1);
      expect(readSource('episode-1')).toMatchObject({
        triple_extracted: 1,
        triple_extracted_status: 'success'
      });
      const metadata = readMetadata('episode-1');
      expect(metadata.triple_count).toBe(1);
      expect(metadata.confidence_avg).toBeCloseTo(1, 6);
      expect(metadata.extracted_at).toBe('2024-06-01T00:00:00.000Z');
    });

    it('never downgrades a committed success when post-commit relation settlement fails', async () => {
      insertEpisodic({ importance: 0.6 });
      const service = realService();
      const relations = (service as unknown as {
        relations: { createEpisodicRelation: (...args: unknown[]) => Promise<void> };
      }).relations;
      vi.spyOn(relations, 'createEpisodicRelation').mockRejectedValue(new Error('relation unavailable'));

      const outcome = await convertEpisodicSource(
        deps({ semanticMemoryUpdateService: service }),
        baseOptions()
      );

      expect(outcome.kind).toBe('success');
      expect(readSource('episode-1')).toMatchObject({
        triple_extracted: 1,
        triple_extracted_status: 'success'
      });
    });
  });

  describe('status-write rollback', () => {
    it('does not write source success when the source content changed before commit', async () => {
      insertEpisodic();
      const service = fakeEvidenceService(async () => {
        DatabaseUtils.run(db, `UPDATE memory_item SET content = 'changed' WHERE id = 'episode-1'`);
        return {
          result: { created: 1, updated: 0, skipped: 0, semanticMemoryIds: ['sem-1'] },
          hasError: false,
          committedConfidences: [0.9]
        };
      });

      const outcome = await convertEpisodicSource(
        deps({ semanticMemoryUpdateService: service }),
        baseOptions()
      );

      expect(outcome).toEqual({ kind: 'skipped' });
      expect(readSource('episode-1')).toMatchObject({
        triple_extracted: 0,
        triple_extracted_status: null,
        content: 'changed'
      });
    });
  });

  describe('policy-only success', () => {
    it('treats zero primary outcomes without error as success with empty semantic IDs', async () => {
      insertEpisodic();
      const service = fakeEvidenceService(async () => ({
        result: { created: 0, updated: 0, skipped: 2, semanticMemoryIds: [] },
        hasError: false,
        committedConfidences: []
      }));

      const outcome = await convertEpisodicSource(
        deps({
          semanticMemoryUpdateService: service,
          tripleExtractionService: { extractTriples: vi.fn().mockResolvedValue(validExtraction([
            { subject: 'a', predicate: 'b', object: 'c' },
            { subject: 'd', predicate: 'e', object: 'f' }
          ])) }
        }),
        baseOptions()
      );

      expect(outcome.kind).toBe('success');
      if (outcome.kind !== 'success') throw new Error('expected success');
      expect(outcome.update.semanticMemoryIds).toEqual([]);
      const metadata = readMetadata('episode-1');
      expect(metadata.triple_count).toBe(2);
      expect(metadata.confidence_avg).toBeUndefined();
      expect(readSource('episode-1')?.triple_extracted_status).toBe('success');
    });
  });

  describe('service-empty vs automatic no-triple', () => {
    it('treats a raw extraction with zero triples as the automatic no-triple failure/retry path', async () => {
      insertEpisodic();
      const extractTriples = vi.fn().mockResolvedValue({
        triples: [],
        extractionInfo: { steps: { canonicalization: false, entityLinking: false }, failureReason: 'no_triple' }
      });
      const updateSpy = vi.fn();
      const service = fakeEvidenceService(updateSpy);

      const outcome = await convertEpisodicSource(
        deps({ tripleExtractionService: { extractTriples }, semanticMemoryUpdateService: service }),
        baseOptions()
      );

      expect(outcome).toEqual({ kind: 'failed', retryCount: 1 });
      expect(updateSpy).not.toHaveBeenCalled();
      expect(readSource('episode-1')).toMatchObject({
        triple_extracted: 0,
        triple_extracted_status: 'failed'
      });
      const metadata = readMetadata('episode-1');
      expect(metadata.failureReason).toBe('no_triple');
      expect(metadata.retry_count).toBe(1);
      expect(metadata.next_retry_after_days).toBe(1);
    });

    it('treats a non-empty extraction fully excluded by policy as a service-boundary success no-op', async () => {
      insertEpisodic();
      const service = fakeEvidenceService(async () => ({
        result: { created: 0, updated: 0, skipped: 1, semanticMemoryIds: [] },
        hasError: false,
        committedConfidences: []
      }));

      const outcome = await convertEpisodicSource(
        deps({ semanticMemoryUpdateService: service }),
        baseOptions()
      );

      expect(outcome.kind).toBe('success');
      expect(readSource('episode-1')?.triple_extracted_status).toBe('success');
    });
  });

  describe('malformed / pre-primary failed retry', () => {
    it('normalizes a structurally malformed extractor result to llm_parse_fail', async () => {
      insertEpisodic();
      const extractTriples = vi.fn().mockResolvedValue({ notTriples: true });

      const outcome = await convertEpisodicSource(
        deps({ tripleExtractionService: { extractTriples } }),
        baseOptions()
      );

      expect(outcome).toEqual({ kind: 'failed', retryCount: 1 });
      const metadata = readMetadata('episode-1');
      expect(metadata.failureReason).toBe('llm_parse_fail');
    });

    it('normalizes an extractor rejection to llm_parse_fail', async () => {
      insertEpisodic();
      const extractTriples = vi.fn().mockRejectedValue(new Error('boom'));

      const outcome = await convertEpisodicSource(
        deps({ tripleExtractionService: { extractTriples } }),
        baseOptions()
      );

      expect(outcome).toEqual({ kind: 'failed', retryCount: 1 });
      expect(readMetadata('episode-1').failureReason).toBe('llm_parse_fail');
    });

    it('escalates a genuine semantic-update processing failure to a durable failed transition', async () => {
      insertEpisodic();
      const service = fakeEvidenceService(async () => ({
        result: { created: 0, updated: 0, skipped: 1, semanticMemoryIds: [] },
        hasError: true,
        committedConfidences: []
      }));

      const outcome = await convertEpisodicSource(
        deps({ semanticMemoryUpdateService: service }),
        baseOptions()
      );

      expect(outcome).toEqual({ kind: 'failed', retryCount: 1 });
      expect(readMetadata('episode-1').failureReason).toBe('semantic_update_failed');
    });

    it('escalates to abandoned once the new retry count reaches maxRetries', async () => {
      insertEpisodic({
        tripleExtracted: 0,
        tripleExtractedStatus: 'failed',
        tripleExtractionMetadata: { failureReason: 'no_triple', retry_count: 2, last_attempt: '2024-01-01T00:00:00.000Z', next_retry_after_days: 4 }
      });
      const extractTriples = vi.fn().mockResolvedValue({ triples: [], extractionInfo: { steps: { canonicalization: false, entityLinking: false } } });

      const outcome = await convertEpisodicSource(
        deps({ tripleExtractionService: { extractTriples } }),
        baseOptions({ maxRetries: 3 })
      );

      expect(outcome).toEqual({ kind: 'failed', retryCount: 3 });
      expect(readSource('episode-1')?.triple_extracted_status).toBe('abandoned');
      const metadata = readMetadata('episode-1');
      expect(metadata.abandoned_at).toBe('2024-06-01T00:00:00.000Z');
      expect(metadata.next_retry_after_days).toBeUndefined();
    });
  });

  describe('single winner', () => {
    it('loses the source-tuple race when another process commits success first', async () => {
      insertEpisodic();
      const service = fakeEvidenceService(async () => {
        DatabaseUtils.run(db, `
          UPDATE memory_item SET
            triple_extracted = 1,
            triple_extracted_status = 'success',
            triple_extraction_metadata = ?
          WHERE id = 'episode-1'
        `, [JSON.stringify({ triple_count: 1, extracted_at: '2024-01-01T00:00:00.000Z' })]);
        return {
          result: { created: 1, updated: 0, skipped: 0, semanticMemoryIds: ['sem-1'] },
          hasError: false,
          committedConfidences: [0.9]
        };
      });

      const outcome = await convertEpisodicSource(
        deps({ semanticMemoryUpdateService: service }),
        baseOptions({ skipConverted: false })
      );

      expect(outcome).toEqual({ kind: 'skipped' });
      const metadata = readMetadata('episode-1');
      expect(metadata.extracted_at).toBe('2024-01-01T00:00:00.000Z');
    });
  });

  describe('stale source skipped', () => {
    it('skips without attempting extraction when the source is missing', async () => {
      const extractTriples = vi.fn();

      const outcome = await convertEpisodicSource(
        deps({ tripleExtractionService: { extractTriples } }),
        baseOptions({ sourceId: 'missing-episode' })
      );

      expect(outcome).toEqual({ kind: 'skipped' });
      expect(extractTriples).not.toHaveBeenCalled();
    });

    it('skips when skipConverted and the source is already successfully converted', async () => {
      insertEpisodic({
        tripleExtracted: 1,
        tripleExtractedStatus: 'success',
        tripleExtractionMetadata: { triple_count: 1, extracted_at: '2024-01-01T00:00:00.000Z' }
      });
      const extractTriples = vi.fn();

      const outcome = await convertEpisodicSource(
        deps({ tripleExtractionService: { extractTriples } }),
        baseOptions({ skipConverted: true })
      );

      expect(outcome).toEqual({ kind: 'skipped' });
      expect(extractTriples).not.toHaveBeenCalled();
    });

    it('skips when the source becomes deleted before the semantic commit resolves', async () => {
      insertEpisodic();
      const service = fakeEvidenceService(async () => {
        DatabaseUtils.run(db, `UPDATE memory_item SET is_deleted = 1 WHERE id = 'episode-1'`);
        throw new Error('Invalid episodic source memory: episode-1');
      });

      const outcome = await convertEpisodicSource(
        deps({ semanticMemoryUpdateService: service }),
        baseOptions()
      );

      expect(outcome).toEqual({ kind: 'skipped' });
    });
  });

  describe('forced success new occurrence', () => {
    it('commits a new success metadata snapshot when reprocessing an already-successful source', async () => {
      insertEpisodic({
        tripleExtracted: 1,
        tripleExtractedStatus: 'success',
        tripleExtractionMetadata: { triple_count: 1, extracted_at: '2020-01-01T00:00:00.000Z' }
      });
      const service = fakeEvidenceService(async () => ({
        result: { created: 0, updated: 1, skipped: 0, semanticMemoryIds: ['sem-1'] },
        hasError: false,
        committedConfidences: [0.95]
      }));

      const outcome = await convertEpisodicSource(
        deps({ semanticMemoryUpdateService: service }),
        baseOptions({ skipConverted: false })
      );

      expect(outcome.kind).toBe('success');
      const metadata = readMetadata('episode-1');
      expect(metadata.extracted_at).toBe('2024-06-01T00:00:00.000Z');
      expect(metadata.confidence_avg).toBeCloseTo(0.95, 12);
    });
  });

  describe('forced failure prior success preservation', () => {
    it('preserves the existing success tuple byte-for-byte when a forced reprocess fails', async () => {
      const originalMetadata = { triple_count: 1, extracted_at: '2020-01-01T00:00:00.000Z' };
      insertEpisodic({
        tripleExtracted: 1,
        tripleExtractedStatus: 'success',
        tripleExtractionMetadata: originalMetadata
      });
      const extractTriples = vi.fn().mockResolvedValue({
        triples: [],
        extractionInfo: { steps: { canonicalization: false, entityLinking: false }, failureReason: 'no_triple' }
      });

      const outcome = await convertEpisodicSource(
        deps({ tripleExtractionService: { extractTriples } }),
        baseOptions({ skipConverted: false })
      );

      expect(outcome).toEqual({ kind: 'failed' });
      expect(readSource('episode-1')).toMatchObject({
        triple_extracted: 1,
        triple_extracted_status: 'success'
      });
      expect(readMetadata('episode-1')).toEqual(originalMetadata);
    });
  });

  describe('failure-state commit failure no retry report', () => {
    it('skips without a retry count when the no-triple path sees a stale source before writing failure state', async () => {
      insertEpisodic();
      const extractTriples = vi.fn(async () => {
        DatabaseUtils.run(db, `UPDATE memory_item SET content = 'raced content' WHERE id = 'episode-1'`);
        return {
          triples: [],
          extractionInfo: { steps: { canonicalization: false, entityLinking: false }, failureReason: 'no_triple' }
        };
      });

      const outcome = await convertEpisodicSource(
        deps({ tripleExtractionService: { extractTriples } }),
        baseOptions()
      );

      expect(outcome).toEqual({ kind: 'skipped' });
      expect(readSource('episode-1')).toMatchObject({
        triple_extracted: 0,
        triple_extracted_status: null,
        triple_extraction_metadata: null,
        content: 'raced content'
      });
    });
  });

  describe('post-commit failure no downgrade', () => {
    it('keeps the success outcome and tuple when hasError is false despite settled post-commit issues', async () => {
      insertEpisodic();
      const service = fakeEvidenceService(async () => ({
        result: { created: 1, updated: 0, skipped: 0, semanticMemoryIds: ['sem-1'] },
        hasError: false,
        committedConfidences: [1]
      }));

      const outcome = await convertEpisodicSource(
        deps({ semanticMemoryUpdateService: service }),
        baseOptions()
      );

      expect(outcome.kind).toBe('success');
      expect(readSource('episode-1')?.triple_extracted_status).toBe('success');
    });
  });

  describe('triple_count original positions', () => {
    it('uses the original input length even when most positions are filtered', async () => {
      insertEpisodic();
      const service = fakeEvidenceService(async () => ({
        result: { created: 1, updated: 0, skipped: 3, semanticMemoryIds: ['sem-1'] },
        hasError: false,
        committedConfidences: [0.8]
      }));

      const outcome = await convertEpisodicSource(
        deps({
          semanticMemoryUpdateService: service,
          tripleExtractionService: { extractTriples: vi.fn().mockResolvedValue(validExtraction([
            { subject: 'a', predicate: 'b', object: 'c' },
            { subject: 'd', predicate: 'e', object: 'f' },
            { subject: 'g', predicate: 'h', object: 'i' },
            { subject: 'j', predicate: 'k', object: 'l' }
          ])) }
        }),
        baseOptions()
      );

      expect(outcome.kind).toBe('success');
      expect(readMetadata('episode-1').triple_count).toBe(4);
    });
  });

  describe('confidence_avg current committed only', () => {
    it('averages only the current call committed confidences, ignoring historical relation rows', async () => {
      insertEpisodic();
      DatabaseUtils.run(db, `
        INSERT INTO memory_item (id, type, content, importance)
        VALUES ('stale-semantic', 'semantic', 'stale semantic content', 0.5)
      `);
      DatabaseUtils.run(db, `
        INSERT INTO memory_relation (source_id, target_id, relation_type, confidence, metadata)
        VALUES ('stale-semantic', 'episode-1', 'extracted_from', 0.1, '{}')
      `);
      const service = fakeEvidenceService(async () => ({
        result: { created: 1, updated: 1, skipped: 0, semanticMemoryIds: ['sem-1', 'sem-2'] },
        hasError: false,
        committedConfidences: [0.8, 0.95]
      }));

      const outcome = await convertEpisodicSource(
        deps({ semanticMemoryUpdateService: service }),
        baseOptions()
      );

      expect(outcome.kind).toBe('success');
      expect(readMetadata('episode-1').confidence_avg).toBeCloseTo(0.875, 12);
    });
  });
});
