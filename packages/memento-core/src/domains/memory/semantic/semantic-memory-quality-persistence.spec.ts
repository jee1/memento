import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { setupTestDatabase, cleanupTestDatabase } from '../../../../test/helpers/test-database.js';
import { DatabaseUtils } from '../../../shared/utils/database.js';
import type { TripleExtractionResult } from '../../../shared/types/triple-extraction.js';
import { createRelationGraph } from '../../../infrastructure/relation-graph-factory.js';
import { logger } from '../../../shared/utils/logger.js';
import type { UnifiedEmbeddingService } from '../../embedding/services/unified-embedding-service.js';
import type { MemoryEmbeddingService } from '../services/memory-embedding-service.js';
import { SemanticMemorySimilarity } from './semantic-memory-similarity.js';
import { SemanticMemoryUpdateService } from './semantic-memory-update-service.js';

describe('SemanticMemoryUpdateService quality persistence boundary', () => {
  let db: Database.Database;
  let service: SemanticMemoryUpdateService;

  beforeEach(async () => {
    db = await setupTestDatabase();
    service = new SemanticMemoryUpdateService(
      db,
      createRelationGraph(db),
      undefined,
      undefined,
      {
        createAndStoreEmbedding: vi.fn().mockResolvedValue(undefined)
      } as unknown as MemoryEmbeddingService
    );
  });

  afterEach(() => {
    cleanupTestDatabase(db);
    vi.restoreAllMocks();
  });

  it('returns an empty result for an actual empty triple array without reading the database', async () => {
    const prepareSpy = vi.spyOn(db, 'prepare');

    const result = await service.updateSemanticMemory(
      { triples: [], extractionInfo: null },
      null
    );

    expect(result).toEqual({ created: 0, updated: 0, skipped: 0, semanticMemoryIds: [] });
    expect(prepareSpy).not.toHaveBeenCalled();
  });

  it.each([
    ['null result', null, { episodicMemoryId: 'episode-1' }],
    ['missing triples', { extractionInfo: validExtractionInfo() }, { episodicMemoryId: 'episode-1' }],
    ['array-like triples', { triples: { length: 0 }, extractionInfo: validExtractionInfo() }, { episodicMemoryId: 'episode-1' }],
    ['missing extractionInfo', { triples: [validTriple()] }, { episodicMemoryId: 'episode-1' }],
    ['non-boolean steps', { triples: [validTriple()], extractionInfo: { steps: { canonicalization: 'yes', entityLinking: true } } }, { episodicMemoryId: 'episode-1' }],
    ['unknown failureReason', { triples: [validTriple()], extractionInfo: { ...validExtractionInfo(), failureReason: 'new_reason' } }, { episodicMemoryId: 'episode-1' }],
    ['null options', { triples: [validTriple()], extractionInfo: validExtractionInfo() }, null],
    ['blank episodicMemoryId', { triples: [validTriple()], extractionInfo: validExtractionInfo() }, { episodicMemoryId: ' ' }],
    ['negative episodicImportance', { triples: [validTriple()], extractionInfo: validExtractionInfo() }, { episodicMemoryId: 'episode-1', episodicImportance: -0.1 }],
    ['null confidenceThreshold', { triples: [validTriple()], extractionInfo: validExtractionInfo() }, { episodicMemoryId: 'episode-1', confidenceThreshold: null }],
    ['out-of-range similarityThreshold', { triples: [validTriple()], extractionInfo: validExtractionInfo() }, { episodicMemoryId: 'episode-1', similarityThreshold: 1.1 }],
  ])('rejects malformed non-empty input before source lookup: %s', async (_name, result, options) => {
    const prepareSpy = vi.spyOn(db, 'prepare');

    await expect(service.updateSemanticMemory(result, options)).rejects.toThrow();

    expect(prepareSpy).not.toHaveBeenCalled();
  });

  it.each([
    ['missing source', 'missing-episode'],
    ['semantic source', 'semantic-source'],
    ['deleted source', 'deleted-episode'],
  ])('rejects invalid episodic source before semantic state changes: %s', async (_name, episodicMemoryId) => {
    insertMemory('semantic-source', 'semantic', 0);
    insertMemory('deleted-episode', 'episodic', 1);

    await expect(
      service.updateSemanticMemory(
        { triples: [validTriple()], extractionInfo: validExtractionInfo() },
        { episodicMemoryId, confidenceThreshold: 0.25 }
      )
    ).rejects.toThrow();

    expect(countRows('memory_item', "type = 'semantic' AND id != 'semantic-source'")).toBe(0);
    expect(countRows('kg_triple')).toBe(0);
    expect(countRows('memory_relation')).toBe(0);
  });

  it('skips sparse, non-object, and malformed triple positions locally while processing valid positions', async () => {
    insertMemory('episode-1', 'episodic', 0);
    const triples = new Array(6);
    triples[0] = validTriple('first');
    triples[2] = null;
    triples[3] = ['array'];
    triples[4] = { subject: ' ', predicate: 'use', object: 'feature' };
    triples[5] = validTriple('second');

    const result = await service.updateSemanticMemory(
      { triples, extractionInfo: validExtractionInfo() },
      { episodicMemoryId: 'episode-1', confidenceThreshold: 0.25 }
    );

    expect(result).toMatchObject({ created: 2, updated: 0, skipped: 4 });
    expect(countRows('memory_item', "type = 'semantic'")).toBe(2);
    expect(countRows('kg_triple')).toBe(2);
  });

  it('uses invocation snapshots after caller mutation and does not pass raw output to relation metadata', async () => {
    insertMemory('episode-1', 'episodic', 0);
    const result = {
      triples: [validTriple('original')],
      extractionInfo: {
        steps: { canonicalization: true, entityLinking: true },
        rawLLMOutput: 'raw secret must not cross the boundary'
      }
    } satisfies TripleExtractionResult;
    const options = {
      episodicMemoryId: 'episode-1',
      episodicImportance: 0.8,
      confidenceThreshold: 0.95,
      similarityThreshold: 0.9
    };

    const pending = service.updateSemanticMemory(result, options);
    options.episodicImportance = 0.1;
    options.confidenceThreshold = 1;
    result.extractionInfo.steps.canonicalization = false;
    result.triples.push(validTriple('late'));
    result.triples[0]!.subject = 'mutated';
    await pending;

    expect(readStoredTriple()).toMatchObject({
      subject: 'original',
      predicate: '사용함',
      object: 'feature'
    });
    expect(readStoredTriple()?.importance).toBe(0.8);
    expect(countRows('memory_item', "type = 'semantic'")).toBe(1);

    const relationMetadata = DatabaseUtils.all(db, `
      SELECT metadata
      FROM memory_relation
      WHERE relation_type = 'extracted_from'
    `) as Array<{ metadata: string }>;
    expect(relationMetadata).toHaveLength(1);
    expect(relationMetadata[0].metadata).not.toContain('raw secret');
    expect(JSON.parse(relationMetadata[0].metadata)).toMatchObject({
      method: 'llm'
    });
  });

  describe('post-commit settlement', () => {
    it('rejects an invalid relation type registry contract before primary writes', async () => {
      insertEpisodic('episode-1');
      DatabaseUtils.run(db, `
        UPDATE relation_type_registry
        SET applicable_types = '["episodic"]'
        WHERE type_name = 'extracted_from'
      `);

      await expect(service.updateSemanticMemory(
        { triples: [validTriple()], extractionInfo: validExtractionInfo() },
        { episodicMemoryId: 'episode-1', confidenceThreshold: 0.7 }
      )).rejects.toThrow(/관계.*오류/);

      expect(countRows('memory_item', "type = 'semantic'")).toBe(0);
      expect(countRows('kg_triple')).toBe(0);
      expect(countRows('memory_relation')).toBe(0);
    });

    it('treats existing post-commit relations in both directions as unchanged duplicates', async () => {
      insertEpisodic('episode-1');
      const first = await service.updateSemanticMemory(
        { triples: [validTriple()], extractionInfo: validExtractionInfo() },
        { episodicMemoryId: 'episode-1', confidenceThreshold: 0.7 }
      );
      const before = readRelations();

      const second = await service.updateSemanticMemory(
        { triples: [validTriple()], extractionInfo: validExtractionInfo() },
        { episodicMemoryId: 'episode-1', confidenceThreshold: 0.7 }
      );

      expect(second).toMatchObject({ created: 0, updated: 1, skipped: 0 });
      expect(second.semanticMemoryIds).toEqual(first.semanticMemoryIds);
      expect(readRelations()).toEqual(before);
    });

    it('treats post-commit unique-constraint races in both directions as unchanged duplicates', async () => {
      insertEpisodic('episode-1');
      const first = await service.updateSemanticMemory(
        { triples: [validTriple()], extractionInfo: validExtractionInfo() },
        { episodicMemoryId: 'episode-1', confidenceThreshold: 0.7 }
      );
      const before = readRelations();
      const relations = (service as unknown as {
        relations: {
          relationGraph: { addRelation: (...args: unknown[]) => Promise<number> };
        };
      }).relations;
      vi.spyOn(relations.relationGraph, 'addRelation').mockRejectedValue(
        Object.assign(new Error('UNIQUE constraint failed'), { code: 'SQLITE_CONSTRAINT_UNIQUE' })
      );

      const second = await service.updateSemanticMemory(
        { triples: [validTriple()], extractionInfo: validExtractionInfo() },
        { episodicMemoryId: 'episode-1', confidenceThreshold: 0.7 }
      );

      expect(second).toMatchObject({ created: 0, updated: 1, skipped: 0 });
      expect(second.semanticMemoryIds).toEqual(first.semanticMemoryIds);
      expect(readRelations()).toEqual(before);
    });

    it('attempts both post-commit directions and create-time embedding independently', async () => {
      insertEpisodic('episode-1');
      const relations = (service as unknown as {
        relations: {
          createEpisodicRelation: (kind: string, sourceId: string, targetId: string, confidence: number) => Promise<void>;
        };
      }).relations;
      const crud = (service as unknown as {
        crud: { createSemanticEmbedding: (memoryId: string, content: string) => Promise<void> };
      }).crud;
      const warn = vi.spyOn(logger, 'warn');
      const relationAttempt = vi.spyOn(relations, 'createEpisodicRelation')
        .mockRejectedValueOnce(new Error('RAW_RELATION_SECRET'))
        .mockResolvedValueOnce();
      const embeddingAttempt = vi.spyOn(crud, 'createSemanticEmbedding').mockResolvedValue();

      const result = await service.updateSemanticMemory(
        { triples: [validTriple()], extractionInfo: validExtractionInfo() },
        { episodicMemoryId: 'episode-1', confidenceThreshold: 0.7 }
      );

      expect(result).toMatchObject({ created: 1, updated: 0, skipped: 0 });
      expect(relationAttempt).toHaveBeenCalledTimes(2);
      expect(relationAttempt.mock.calls.map(([kind]) => kind)).toEqual(['extracted_from', 'supported_by']);
      expect(embeddingAttempt).toHaveBeenCalledOnce();
      expect(readSemantic(result.semanticMemoryIds[0])).toBeDefined();
      expect(warn).toHaveBeenCalledWith(
        'SemanticMemoryUpdateService: post-commit 작업 실패 (무시)',
        {
          sourceId: 'episode-1',
          index: 0,
          kind: 'extracted_from',
          reason: 'Error'
        }
      );
      expect(JSON.stringify(warn.mock.calls)).not.toContain('RAW_RELATION_SECRET');
    });

    it('preserves a committed result when debug logging throws', async () => {
      insertEpisodic('episode-1');
      vi.spyOn(logger, 'debug').mockImplementation(() => {
        throw new Error('debug logger unavailable');
      });

      const result = await service.updateSemanticMemory(
        { triples: [validTriple()], extractionInfo: validExtractionInfo() },
        { episodicMemoryId: 'episode-1', confidenceThreshold: 0.7 }
      );

      expect(result).toMatchObject({ created: 1, updated: 0, skipped: 0 });
      expect(readSemantic(result.semanticMemoryIds[0])).toBeDefined();
    });

    it('preserves a committed result when warn logging throws', async () => {
      insertEpisodic('episode-1');
      const relations = (service as unknown as {
        relations: {
          createEpisodicRelation: (kind: string, sourceId: string, targetId: string, confidence: number) => Promise<void>;
        };
      }).relations;
      vi.spyOn(relations, 'createEpisodicRelation').mockRejectedValue(new Error('relation unavailable'));
      vi.spyOn(logger, 'warn').mockImplementation(() => {
        throw new Error('warn logger unavailable');
      });

      const result = await service.updateSemanticMemory(
        { triples: [validTriple()], extractionInfo: validExtractionInfo() },
        { episodicMemoryId: 'episode-1', confidenceThreshold: 0.7 }
      );

      expect(result).toMatchObject({ created: 1, updated: 0, skipped: 0 });
      expect(readSemantic(result.semanticMemoryIds[0])).toBeDefined();
    });

    it('keeps a committed result and processing outcome when error logging throws', async () => {
      insertEpisodic('episode-1');
      const scoring = (service as unknown as {
        scoring: {
          prepareNormalizedTriple: (triple: unknown, index: number) => unknown;
        };
      }).scoring;
      const originalPrepare = scoring.prepareNormalizedTriple.bind(scoring);
      vi.spyOn(scoring, 'prepareNormalizedTriple')
        .mockImplementationOnce(originalPrepare)
        .mockImplementationOnce(() => {
          throw new Error('processing sentinel');
        });
      const error = vi.spyOn(logger, 'error').mockImplementation(() => {
        throw new Error('error logger unavailable');
      });

      const result = await service.updateSemanticMemory(
        {
          triples: [validTriple('committed'), validTriple('failed')],
          extractionInfo: validExtractionInfo()
        },
        { episodicMemoryId: 'episode-1', confidenceThreshold: 0.7 }
      );

      expect(result).toMatchObject({ created: 1, updated: 0, skipped: 1 });
      expect(result.semanticMemoryIds).toHaveLength(1);
      expect(readSemantic(result.semanticMemoryIds[0])).toBeDefined();
      expect(error).toHaveBeenCalledWith(
        'SemanticMemoryUpdateService: Triple 처리 실패',
        { sourceId: 'episode-1', index: 1, reason: 'Error' }
      );
    });

    it('preserves a committed post-commit result when relation, embedding, statistics, and logger fail', async () => {
      insertEpisodic('episode-1');
      const relations = (service as unknown as {
        relations: {
          createEpisodicRelation: (kind: string, sourceId: string, targetId: string, confidence: number) => Promise<void>;
        };
      }).relations;
      const crud = (service as unknown as {
        crud: { createSemanticEmbedding: (memoryId: string, content: string) => Promise<void> };
      }).crud;
      const statistics = (service as unknown as {
        statistics: { recordUpdate: (...args: unknown[]) => void };
      }).statistics;
      vi.spyOn(relations, 'createEpisodicRelation').mockRejectedValue(new Error('relation unavailable'));
      vi.spyOn(crud, 'createSemanticEmbedding').mockRejectedValue(new Error('embedding unavailable'));
      vi.spyOn(statistics, 'recordUpdate').mockImplementation(() => {
        throw new Error('statistics unavailable');
      });
      vi.spyOn(logger, 'warn').mockImplementation(() => {
        throw new Error('logger unavailable');
      });

      const result = await service.updateSemanticMemory(
        { triples: [validTriple()], extractionInfo: validExtractionInfo() },
        { episodicMemoryId: 'episode-1', confidenceThreshold: 0.7 }
      );

      expect(result).toMatchObject({ created: 1, updated: 0, skipped: 0 });
      expect(result.semanticMemoryIds).toHaveLength(1);
      expect(readSemantic(result.semanticMemoryIds[0])).toBeDefined();
    });

    it('settles every delayed post-commit intent before returning', async () => {
      insertEpisodic('episode-1');
      const relations = (service as unknown as {
        relations: {
          createEpisodicRelation: (kind: string, sourceId: string, targetId: string, confidence: number) => Promise<void>;
        };
      }).relations;
      const crud = (service as unknown as {
        crud: { createSemanticEmbedding: (memoryId: string, content: string) => Promise<void> };
      }).crud;
      const extracted = deferred<void>();
      const supported = deferred<void>();
      const embedding = deferred<void>();
      const attempts: string[] = [];
      vi.spyOn(relations, 'createEpisodicRelation')
        .mockImplementationOnce(() => {
          attempts.push('extracted_from');
          return extracted.promise;
        })
        .mockImplementationOnce(() => {
          attempts.push('supported_by');
          return supported.promise;
        });
      vi.spyOn(crud, 'createSemanticEmbedding').mockImplementation(() => {
        attempts.push('embedding');
        return embedding.promise;
      });
      let returned = false;
      const pending = service.updateSemanticMemory(
        { triples: [validTriple()], extractionInfo: validExtractionInfo() },
        { episodicMemoryId: 'episode-1', confidenceThreshold: 0.7 }
      ).finally(() => {
        returned = true;
      });
      await vi.waitFor(() => {
        expect(attempts).toEqual(['extracted_from', 'supported_by', 'embedding']);
      });

      extracted.resolve();
      supported.reject(new Error('supported unavailable'));
      await Promise.resolve();
      expect(returned).toBe(false);
      embedding.resolve();

      await expect(pending).resolves.toMatchObject({ created: 1, updated: 0, skipped: 0 });
      expect(returned).toBe(true);
    });

    it('keeps raw triple, content, embedding, and LLM fields out of post-commit metadata and logs', async () => {
      insertEpisodic('episode-1');
      const relations = (service as unknown as {
        relations: {
          relationGraph: { addRelation: (...args: unknown[]) => Promise<number> };
        };
      }).relations;
      const addRelation = vi.spyOn(relations.relationGraph, 'addRelation');
      const debug = vi.spyOn(logger, 'debug');
      const warn = vi.spyOn(logger, 'warn');
      const error = vi.spyOn(logger, 'error');
      const rawMarkers = ['RAW_SUBJECT_SECRET', 'RAW_PREDICATE_SECRET', 'RAW_OBJECT_SECRET', 'RAW_LLM_SECRET'];

      await service.updateSemanticMemory(
        {
          triples: [{
            subject: rawMarkers[0],
            predicate: rawMarkers[1],
            object: rawMarkers[2]
          }],
          extractionInfo: {
            ...validExtractionInfo(),
            rawLLMOutput: rawMarkers[3]
          }
        },
        { episodicMemoryId: 'episode-1', confidenceThreshold: 0.6 }
      );

      const relationPayloads = addRelation.mock.calls.map(([, , , options]) => options);
      const logPayloads = [...debug.mock.calls, ...warn.mock.calls, ...error.mock.calls];
      expect(relationPayloads).toHaveLength(2);
      expect(relationPayloads).toEqual(expect.arrayContaining([
        expect.objectContaining({ updateOnConflict: false, metadata: { method: 'llm' } })
      ]));
      for (const marker of rawMarkers) {
        expect(JSON.stringify(relationPayloads)).not.toContain(marker);
        expect(JSON.stringify(logPayloads)).not.toContain(marker);
      }
      expect(JSON.stringify(relationPayloads)).not.toMatch(/"(triple|content|embedding|rawLLMOutput)"/);
    });
  });

  describe('new semantic persistence', () => {
    it('persists an accepted confidence 0.7 snapshot with source scope and automatic provenance', async () => {
      insertEpisodic('episode-1', 0.8, 'owner-1', 'project-1');

      const result = await service.updateSemanticMemory(
        {
          triples: [{ subject: 'system', predicate: 'bespoke relation', object: 'feature' }],
          extractionInfo: validExtractionInfo()
        },
        { episodicMemoryId: 'episode-1', confidenceThreshold: 0.69 }
      );

      expect(result).toMatchObject({ created: 1, updated: 0, skipped: 0 });
      const semantic = readSemantic(result.semanticMemoryIds[0]);
      expect(semantic).toMatchObject({
        subject: '시스템',
        predicate: 'bespoke relation',
        object: 'feature',
        confidence: 0.7,
        num_times: 1,
        owner_id: 'owner-1',
        project_id: 'project-1',
        privacy_scope: 'private'
      });
      expect(semantic?.importance).toBeCloseTo(0.56, 12);
      expect(JSON.parse(semantic!.origin_source)).toMatchObject({
        tool: 'extract_triples',
        caller: 'system',
        context: { source_episodic_id: 'episode-1' }
      });
    });

    it('accepts only positive confidence at threshold 0', async () => {
      insertEpisodic('episode-1');
      const scoring = (service as unknown as {
        scoring: {
          prepareNormalizedTriple: (triple: unknown, index: number) => unknown;
        };
      }).scoring;
      vi.spyOn(scoring, 'prepareNormalizedTriple')
        .mockReturnValueOnce({
          index: 0,
          subject: 'zero',
          predicate: 'uses',
          object: 'feature',
          predicateCanonicalized: false,
          subjectLinked: false,
          objectLinked: false,
          confidence: 0
        })
        .mockReturnValueOnce({
          index: 1,
          subject: 'positive',
          predicate: 'uses',
          object: 'feature',
          predicateCanonicalized: false,
          subjectLinked: false,
          objectLinked: false,
          confidence: 0.1
        });

      const result = await service.updateSemanticMemory(
        {
          triples: [validTriple('zero'), validTriple('positive')],
          extractionInfo: validExtractionInfo()
        },
        { episodicMemoryId: 'episode-1', confidenceThreshold: 0 }
      );

      expect(result).toMatchObject({ created: 1, updated: 0, skipped: 1 });
      expect(readSemantic(result.semanticMemoryIds[0])).toMatchObject({ confidence: 0.1 });
    });

    it('rejects confidence 1 at threshold 1 without primary writes', async () => {
      insertEpisodic('episode-1');

      const result = await service.updateSemanticMemory(
        { triples: [validTriple()], extractionInfo: validExtractionInfo() },
        { episodicMemoryId: 'episode-1', confidenceThreshold: 1 }
      );

      expect(result).toMatchObject({ created: 0, updated: 0, skipped: 1 });
      expect(countRows('memory_item', "type = 'semantic'")).toBe(0);
      expect(countRows('kg_triple')).toBe(0);
    });

    it('rejects invalid normalized confidence without primary writes', async () => {
      insertEpisodic('episode-1');
      const scoring = (service as unknown as {
        scoring: {
          prepareNormalizedTriple: (triple: unknown, index: number) => unknown;
        };
      }).scoring;
      vi.spyOn(scoring, 'prepareNormalizedTriple').mockReturnValue({
        index: 0,
        subject: 'system',
        predicate: 'uses',
        object: 'feature',
        predicateCanonicalized: true,
        subjectLinked: true,
        objectLinked: true,
        confidence: Number.NaN
      });

      const result = await service.updateSemanticMemory(
        { triples: [validTriple()], extractionInfo: validExtractionInfo() },
        { episodicMemoryId: 'episode-1', confidenceThreshold: 0 }
      );

      expect(result).toMatchObject({ created: 0, updated: 0, skipped: 1 });
      expect(countRows('memory_item', "type = 'semantic'")).toBe(0);
      expect(countRows('kg_triple')).toBe(0);
      expect(countRows('memory_relation')).toBe(0);
    });

    it.each([
      ['explicit zero', 0.9, 0, 0],
      ['source value when omitted', 0.8, undefined, 0.56],
      ['default 0.5 for NULL source when omitted', null, undefined, 0.35]
    ])('uses undefined/NULL-only importance defaults: %s', async (
      _name,
      sourceImportance,
      explicitImportance,
      expectedImportance
    ) => {
      insertEpisodic('episode-1', sourceImportance);
      const options = explicitImportance === undefined
        ? { episodicMemoryId: 'episode-1', confidenceThreshold: 0.69 }
        : {
            episodicMemoryId: 'episode-1',
            episodicImportance: explicitImportance,
            confidenceThreshold: 0.69
          };

      const result = await service.updateSemanticMemory(
        {
          triples: [{ subject: 'system', predicate: 'bespoke relation', object: 'feature' }],
          extractionInfo: validExtractionInfo()
        },
        options
      );

      expect(result.created).toBe(1);
      expect(readSemantic(result.semanticMemoryIds[0])?.importance).toBeCloseTo(expectedImportance, 12);
    });

    it('rolls back the new semantic when its required KG insert fails', async () => {
      insertEpisodic('episode-1');
      const kgTripleRepo = (service as unknown as {
        kgTripleRepo: { upsertTriple: (...args: unknown[]) => string };
      }).kgTripleRepo;
      const upsertTriple = kgTripleRepo.upsertTriple.bind(kgTripleRepo);
      vi.spyOn(kgTripleRepo, 'upsertTriple')
        .mockImplementationOnce(() => {
          throw new Error('synthetic KG write failure');
        })
        .mockImplementation((...args) => upsertTriple(...args));

      const result = await service.updateSemanticMemory(
        {
          triples: [validTriple('first'), validTriple('second')],
          extractionInfo: validExtractionInfo()
        },
        { episodicMemoryId: 'episode-1', confidenceThreshold: 0.7 }
      );

      expect(result).toMatchObject({ created: 1, updated: 0, skipped: 1 });
      expect(countRows('memory_item', "type = 'semantic'")).toBe(1);
      expect(countRows('kg_triple')).toBe(1);
      expect(readSemantic(result.semanticMemoryIds[0])?.subject).toBe('second');
    });

    it('keeps an ineligible global KG representative while committing a scoped fallback', async () => {
      insertEpisodic('episode-1', 0.8, 'owner-1', 'project-1');
      DatabaseUtils.run(db, `
        INSERT INTO memory_item (
          id, type, content, subject, predicate, object, confidence, importance,
          num_times, owner_id, project_id, origin_source, privacy_scope
        ) VALUES (?, 'semantic', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'private')
      `, [
        'global-representative',
        'user-authored semantic',
        '시스템',
        '사용함',
        'feature',
        0.9,
        0.9,
        4,
        'other-owner',
        'other-project',
        JSON.stringify({ tool: 'remember', caller: 'user' })
      ]);
      DatabaseUtils.run(db, `
        INSERT INTO kg_triple (id, subject, predicate, object, representative_memory_id)
        VALUES ('global-kg', '시스템', '사용함', 'feature', 'global-representative')
      `);

      const result = await service.updateSemanticMemory(
        { triples: [validTriple()], extractionInfo: validExtractionInfo() },
        { episodicMemoryId: 'episode-1', confidenceThreshold: 0.7 }
      );

      expect(result).toMatchObject({ created: 1, updated: 0, skipped: 0 });
      expect(result.semanticMemoryIds[0]).not.toBe('global-representative');
      expect(readSemantic('global-representative')).toMatchObject({
        confidence: 0.9,
        importance: 0.9,
        num_times: 4,
        owner_id: 'other-owner',
        project_id: 'other-project'
      });
      expect(readSemantic(result.semanticMemoryIds[0])).toMatchObject({
        owner_id: 'owner-1',
        project_id: 'project-1',
        confidence: 1,
        importance: 0.8
      });
      expect(DatabaseUtils.get(db, `
        SELECT representative_memory_id
        FROM kg_triple
        WHERE id = 'global-kg'
      `)).toEqual({ representative_memory_id: 'global-representative' });
      expect(countRows('kg_triple')).toBe(1);

      insertEpisodic('episode-2', 0.6, 'owner-1', 'project-1');
      const second = await service.updateSemanticMemory(
        { triples: [validTriple()], extractionInfo: validExtractionInfo() },
        { episodicMemoryId: 'episode-2', confidenceThreshold: 0.7 }
      );

      expect(second).toMatchObject({ created: 0, updated: 1, skipped: 0 });
      expect(second.semanticMemoryIds).toEqual(result.semanticMemoryIds);
      expect(countRows('memory_item', "type = 'semantic'")).toBe(2);
      expect(countRows('kg_triple')).toBe(1);
    });

    it('does not update a same-scope user-authored global representative', async () => {
      insertEpisodic('episode-1', 0.8, 'owner-1', 'project-1');
      insertGlobalRepresentative({
        originSource: JSON.stringify({ tool: 'remember', caller: 'user' })
      });

      const result = await service.updateSemanticMemory(
        { triples: [validTriple()], extractionInfo: validExtractionInfo() },
        { episodicMemoryId: 'episode-1', confidenceThreshold: 0.7 }
      );

      expect(result).toMatchObject({ created: 1, updated: 0, skipped: 0 });
      expect(readSemantic('global-representative')).toMatchObject({
        confidence: 0.9,
        importance: 0.9,
        num_times: 4
      });
    });

    it('does not update a stale-structure global representative', async () => {
      insertEpisodic('episode-1', 0.8, 'owner-1', 'project-1');
      insertGlobalRepresentative({ subject: 'stale subject' });

      const result = await service.updateSemanticMemory(
        { triples: [validTriple()], extractionInfo: validExtractionInfo() },
        { episodicMemoryId: 'episode-1', confidenceThreshold: 0.7 }
      );

      expect(result).toMatchObject({ created: 1, updated: 0, skipped: 0 });
      expect(readSemantic('global-representative')).toMatchObject({
        subject: 'stale subject',
        confidence: 0.9,
        importance: 0.9,
        num_times: 4
      });
    });

    it.each([
      ['invalid confidence', { confidence: 1.1 }],
      ['NULL importance', { importance: null }],
      ['invalid num_times', { numTimes: 0 }],
      ['exhausted num_times', { numTimes: Number.MAX_SAFE_INTEGER }]
    ])('does not update a global representative with %s', async (_name, overrides) => {
      insertEpisodic('episode-1', 0.8, 'owner-1', 'project-1');
      insertGlobalRepresentative(overrides);

      const result = await service.updateSemanticMemory(
        { triples: [validTriple()], extractionInfo: validExtractionInfo() },
        { episodicMemoryId: 'episode-1', confidenceThreshold: 0.7 }
      );

      expect(result).toMatchObject({ created: 1, updated: 0, skipped: 0 });
      expect(readSemantic('global-representative')).toMatchObject({
        confidence: overrides.confidence ?? 0.9,
        importance: overrides.importance === undefined ? 0.9 : null,
        num_times: overrides.numTimes ?? 4
      });
    });

    it('accepts an empty-origin legacy representative only with extracted_from provenance', async () => {
      insertEpisodic('episode-1', 0.8, 'owner-1', 'project-1');
      insertGlobalRepresentative({ originSource: '{}' });
      DatabaseUtils.run(db, `
        INSERT INTO memory_relation (
          source_id, target_id, relation_type, confidence, metadata
        ) VALUES ('global-representative', 'episode-1', 'extracted_from', 0.9, '{}')
      `);

      const result = await service.updateSemanticMemory(
        { triples: [validTriple()], extractionInfo: validExtractionInfo() },
        { episodicMemoryId: 'episode-1', confidenceThreshold: 0.7 }
      );

      expect(result).toMatchObject({ created: 0, updated: 1, skipped: 0 });
      expect(result.semanticMemoryIds).toEqual(['global-representative']);
    });

    it('uses the normalized snapshot without canonicalizing or linking again', async () => {
      insertEpisodic('episode-1');
      const scoring = (service as unknown as {
        scoring: { prepareNormalizedTriple: (triple: unknown, index: number) => unknown };
      }).scoring;
      const prepareSpy = vi.spyOn(scoring, 'prepareNormalizedTriple');

      const result = await service.updateSemanticMemory(
        { triples: [validTriple()], extractionInfo: validExtractionInfo() },
        { episodicMemoryId: 'episode-1', confidenceThreshold: 0.7 }
      );

      expect(result.created).toBe(1);
      expect(prepareSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('candidate selection', () => {
    it('prefers the oldest exact candidate by created_at and ID without similarity access', async () => {
      insertEpisodic('episode-1', 0.8, 'owner-1', 'project-1');
      insertCandidate({ id: 'exact-b', createdAt: '2024-01-01T00:00:00.000Z' });
      insertCandidate({ id: 'exact-a', createdAt: '2024-01-01T00:00:00.000Z' });
      insertCandidate({
        id: 'older-similar',
        subject: 'similar system',
        createdAt: '2023-01-01T00:00:00.000Z'
      });
      const generateEmbedding = vi.fn().mockRejectedValue(new Error('must not run'));
      const similarity = new SemanticMemorySimilarity(db, embeddingService(generateEmbedding));

      const decision = await similarity.findDuplicateSemanticMemory(
        normalizedSnapshot(),
        { ownerId: 'owner-1', projectId: 'project-1' },
        0.9
      );

      expect(decision).toMatchObject({
        kind: 'exact',
        candidate: {
          id: 'exact-a',
          confidence: 0.9,
          numTimes: 2,
          ownerId: 'owner-1',
          projectId: 'project-1',
          createdAt: '2024-01-01T00:00:00.000Z'
        }
      });
      expect(generateEmbedding).not.toHaveBeenCalled();
    });

    it('filters ineligible candidates before embeddings and reuses two input embeddings', async () => {
      insertEpisodic('episode-1', 0.8, 'owner-1', 'project-1');
      insertCandidate({ id: 'other-scope', subject: 'other-scope', ownerId: 'owner-2' });
      insertCandidate({
        id: 'user-authored',
        subject: 'user-authored',
        originSource: JSON.stringify({ tool: 'remember', caller: 'user' })
      });
      insertCandidate({ id: 'deleted', subject: 'deleted', isDeleted: 1 });
      insertCandidate({ id: 'blank-spo', subject: ' ' });
      insertCandidate({ id: 'invalid-confidence', subject: 'invalid-confidence', confidence: 1.1 });
      insertCandidate({ id: 'invalid-count', subject: 'invalid-count', numTimes: 0 });
      insertCandidate({
        id: 'stale-representative',
        subject: 'stale-representative',
        createdAt: '2020-01-01T00:00:00.000Z'
      });
      DatabaseUtils.run(db, `
        INSERT INTO kg_triple (id, subject, predicate, object, representative_memory_id)
        VALUES ('stale-kg', 'different', '사용함', 'different', 'stale-representative')
      `);
      insertCandidate({
        id: 'eligible-miss',
        subject: 'eligible-miss',
        createdAt: '2021-01-01T00:00:00.000Z'
      });
      insertCandidate({
        id: 'eligible-b',
        subject: 'eligible-subject',
        object: 'eligible-object',
        createdAt: '2022-01-01T00:00:00.000Z'
      });
      insertCandidate({
        id: 'eligible-a',
        subject: 'eligible-subject',
        object: 'eligible-object',
        createdAt: '2022-01-01T00:00:00.000Z'
      });
      const vectors: Record<string, number[]> = {
        '시스템': [1, 0],
        feature: [0, 1],
        'eligible-miss': [0, 1],
        'eligible-subject': [1, 0],
        'eligible-object': [0, 1]
      };
      const generateEmbedding = vi.fn(async (text: string) => embeddingResult(vectors[text] ?? [1, 1]));
      const similarity = new SemanticMemorySimilarity(db, embeddingService(generateEmbedding));

      const decision = await similarity.findDuplicateSemanticMemory(
        normalizedSnapshot(),
        { ownerId: 'owner-1', projectId: 'project-1' },
        0.9
      );

      expect(decision).toMatchObject({ kind: 'similar', candidate: { id: 'eligible-a' } });
      expect(generateEmbedding.mock.calls.filter(([text]) => text === '시스템')).toHaveLength(1);
      expect(generateEmbedding.mock.calls.filter(([text]) => text === 'feature')).toHaveLength(1);
      for (const ineligible of [
        'other-scope',
        'user-authored',
        'deleted',
        'invalid-confidence',
        'invalid-count',
        'stale-representative'
      ]) {
        expect(generateEmbedding).not.toHaveBeenCalledWith(ineligible);
      }
    });

    it('accepts similarity threshold equality', async () => {
      insertCandidate({ id: 'threshold-equal', subject: 'candidate-subject', object: 'candidate-object' });
      const input = [1, 0];
      const equal = [0.5, Math.sqrt(0.75)];
      const vectors: Record<string, number[]> = {
        '시스템': input,
        feature: input,
        'candidate-subject': equal,
        'candidate-object': equal
      };
      const similarity = new SemanticMemorySimilarity(
        db,
        embeddingService(vi.fn(async (text: string) => embeddingResult(vectors[text])))
      );

      const decision = await similarity.findDuplicateSemanticMemory(
        normalizedSnapshot(),
        { ownerId: 'owner-1', projectId: 'project-1' },
        0.5
      );

      expect(decision).toMatchObject({ kind: 'similar', candidate: { id: 'threshold-equal' } });
    });

    it.each([
      ['invalid score', vi.fn(async (text: string) => embeddingResult(
        text === '시스템' ? [1, 0] : [Number.NaN, 0]
      ))],
      ['provider failure', vi.fn().mockRejectedValue(new Error('provider unavailable'))]
    ])('returns indeterminate for required %s', async (_name, generateEmbedding) => {
      insertCandidate({ id: 'eligible-similar', subject: 'candidate-subject', object: 'candidate-object' });
      const similarity = new SemanticMemorySimilarity(db, embeddingService(generateEmbedding));

      const decision = await similarity.findDuplicateSemanticMemory(
        normalizedSnapshot(),
        { ownerId: 'owner-1', projectId: 'project-1' },
        0.9
      );

      expect(decision).toMatchObject({ kind: 'indeterminate' });
    });

    it('skips an indeterminate candidate decision without primary writes', async () => {
      insertEpisodic('episode-1', 0.8, 'owner-1', 'project-1');
      insertCandidate({ id: 'eligible-similar', subject: 'candidate-subject', object: 'candidate-object' });
      service = new SemanticMemoryUpdateService(
        db,
        createRelationGraph(db),
        embeddingService(vi.fn().mockRejectedValue(new Error('provider unavailable'))),
        undefined,
        { createAndStoreEmbedding: vi.fn().mockResolvedValue(undefined) } as unknown as MemoryEmbeddingService
      );

      const result = await service.updateSemanticMemory(
        { triples: [validTriple()], extractionInfo: validExtractionInfo() },
        { episodicMemoryId: 'episode-1', confidenceThreshold: 0.7 }
      );

      expect(result).toMatchObject({ created: 0, updated: 0, skipped: 1, semanticMemoryIds: [] });
      expect(countRows('memory_item', "type = 'semantic'")).toBe(1);
      expect(countRows('kg_triple')).toBe(0);
      expect(countRows('memory_relation')).toBe(0);
    });
  });

  function validExtractionInfo() {
    return { steps: { canonicalization: true, entityLinking: true } };
  }

  function validTriple(subject = 'system') {
    return { subject, predicate: 'use', object: 'feature' };
  }

  function insertMemory(id: string, type: 'episodic' | 'semantic', isDeleted: 0 | 1): void {
    DatabaseUtils.run(db, `
      INSERT INTO memory_item (id, type, content, importance, subject, predicate, object, is_deleted)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      id,
      type,
      `${id} content`,
      0.5,
      type === 'semantic' ? 'source' : null,
      type === 'semantic' ? 'uses' : null,
      type === 'semantic' ? 'object' : null,
      isDeleted
    ]);
  }

  function insertEpisodic(
    id: string,
    importance: number | null = 0.5,
    ownerId: string | null = null,
    projectId: string | null = null
  ): void {
    DatabaseUtils.run(db, `
      INSERT INTO memory_item (
        id, type, content, importance, owner_id, project_id, is_deleted
      ) VALUES (?, 'episodic', ?, ?, ?, ?, 0)
    `, [id, `${id} content`, importance, ownerId, projectId]);
  }

  function insertGlobalRepresentative(overrides: {
    subject?: string;
    confidence?: number | null;
    importance?: number | null;
    numTimes?: number;
    originSource?: string;
  } = {}): void {
    DatabaseUtils.run(db, `
      INSERT INTO memory_item (
        id, type, content, subject, predicate, object, confidence, importance,
        num_times, owner_id, project_id, origin_source, privacy_scope
      ) VALUES (?, 'semantic', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'private')
    `, [
      'global-representative',
      'automatic semantic',
      overrides.subject ?? '시스템',
      '사용함',
      'feature',
      overrides.confidence === undefined ? 0.9 : overrides.confidence,
      overrides.importance === undefined ? 0.9 : overrides.importance,
      overrides.numTimes ?? 4,
      'owner-1',
      'project-1',
      overrides.originSource ?? JSON.stringify({
        tool: 'extract_triples',
        caller: 'system',
        context: { source_episodic_id: 'original-episode' }
      })
    ]);
    DatabaseUtils.run(db, `
      INSERT INTO kg_triple (id, subject, predicate, object, representative_memory_id)
      VALUES ('global-kg', '시스템', '사용함', 'feature', 'global-representative')
    `);
  }

  function insertCandidate(overrides: {
    id: string;
    subject?: string;
    predicate?: string;
    object?: string;
    confidence?: number | null;
    importance?: number | null;
    numTimes?: number;
    ownerId?: string | null;
    projectId?: string | null;
    originSource?: string | null;
    isDeleted?: 0 | 1;
    createdAt?: string;
  }): void {
    DatabaseUtils.run(db, `
      INSERT INTO memory_item (
        id, type, content, subject, predicate, object, confidence, importance,
        num_times, owner_id, project_id, origin_source, is_deleted, created_at
      ) VALUES (?, 'semantic', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      overrides.id,
      `${overrides.id} content`,
      overrides.subject ?? '시스템',
      overrides.predicate ?? '사용함',
      overrides.object ?? 'feature',
      overrides.confidence === undefined ? 0.9 : overrides.confidence,
      overrides.importance === undefined ? 0.9 : overrides.importance,
      overrides.numTimes ?? 2,
      overrides.ownerId === undefined ? 'owner-1' : overrides.ownerId,
      overrides.projectId === undefined ? 'project-1' : overrides.projectId,
      overrides.originSource === undefined
        ? JSON.stringify({
            tool: 'extract_triples',
            caller: 'system',
            context: { source_episodic_id: 'original-episode' }
          })
        : overrides.originSource,
      overrides.isDeleted ?? 0,
      overrides.createdAt ?? '2024-01-01T00:00:00.000Z'
    ]);
  }

  function normalizedSnapshot() {
    return {
      index: 0,
      subject: '시스템',
      predicate: '사용함',
      object: 'feature',
      predicateCanonicalized: true,
      subjectLinked: true,
      objectLinked: false,
      confidence: 1
    };
  }

  function embeddingService(generateEmbedding: ReturnType<typeof vi.fn>): UnifiedEmbeddingService {
    return {
      isAvailable: vi.fn().mockReturnValue(true),
      generateEmbedding
    } as unknown as UnifiedEmbeddingService;
  }

  function embeddingResult(embedding: number[]) {
    return {
      embedding,
      model: 'test',
      provider: 'mock' as const,
      usage: { prompt_tokens: 0, total_tokens: 0 }
    };
  }

  function countRows(table: 'memory_item' | 'kg_triple' | 'memory_relation', where?: string): number {
    const query = where
      ? `SELECT COUNT(*) AS count FROM ${table} WHERE ${where}`
      : `SELECT COUNT(*) AS count FROM ${table}`;
    return (DatabaseUtils.get(db, query) as { count: number }).count;
  }

  function readStoredTriple(): {
    subject: string;
    predicate: string;
    object: string;
    importance: number | null;
  } | undefined {
    return DatabaseUtils.get(db, `
      SELECT subject, predicate, object, importance
      FROM memory_item
      WHERE type = 'semantic'
    `) as {
      subject: string;
      predicate: string;
      object: string;
      importance: number | null;
    } | undefined;
  }

  function readSemantic(id: string): {
    subject: string;
    predicate: string;
    object: string;
    confidence: number | null;
    importance: number | null;
    num_times: number;
    owner_id: string | null;
    project_id: string | null;
    origin_source: string;
    privacy_scope: string;
  } | undefined {
    return DatabaseUtils.get(db, `
      SELECT
        subject, predicate, object, confidence, importance, num_times,
        owner_id, project_id, origin_source, privacy_scope
      FROM memory_item
      WHERE id = ? AND type = 'semantic'
    `, [id]) as {
      subject: string;
      predicate: string;
      object: string;
      confidence: number | null;
      importance: number | null;
      num_times: number;
      owner_id: string | null;
      project_id: string | null;
      origin_source: string;
      privacy_scope: string;
    } | undefined;
  }

  function readRelations(): Array<{
    source_id: string;
    target_id: string;
    relation_type: string;
    confidence: number;
    metadata: string | null;
    created_at: string;
    updated_at: string;
  }> {
    return DatabaseUtils.all(db, `
      SELECT source_id, target_id, relation_type, confidence, metadata, created_at, updated_at
      FROM memory_relation
      ORDER BY source_id, target_id, relation_type
    `) as Array<{
      source_id: string;
      target_id: string;
      relation_type: string;
      confidence: number;
      metadata: string | null;
      created_at: string;
      updated_at: string;
    }>;
  }

  function deferred<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    });
    return { promise, resolve, reject };
  }
});
