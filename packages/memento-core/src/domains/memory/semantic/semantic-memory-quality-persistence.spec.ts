import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { setupTestDatabase, cleanupTestDatabase } from '../../../../test/helpers/test-database.js';
import { DatabaseUtils } from '../../../shared/utils/database.js';
import type { TripleExtractionResult } from '../../../shared/types/triple-extraction.js';
import { createRelationGraph } from '../../../infrastructure/relation-graph-factory.js';
import type { MemoryEmbeddingService } from '../services/memory-embedding-service.js';
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
      steps: { canonicalization: true, entityLinking: true },
      triple: { subject: 'original', predicate: 'use', object: 'feature' }
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
      vi.spyOn(kgTripleRepo, 'upsertTriple').mockImplementation(() => {
        throw new Error('synthetic KG write failure');
      });

      const result = await service.updateSemanticMemory(
        { triples: [validTriple()], extractionInfo: validExtractionInfo() },
        { episodicMemoryId: 'episode-1', confidenceThreshold: 0.7 }
      );

      expect(result).toMatchObject({ created: 0, updated: 0, skipped: 1 });
      expect(countRows('memory_item', "type = 'semantic'")).toBe(0);
      expect(countRows('kg_triple')).toBe(0);
      expect(countRows('memory_relation')).toBe(0);
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
    importance: number;
  } | undefined {
    return DatabaseUtils.get(db, `
      SELECT subject, predicate, object, importance
      FROM memory_item
      WHERE type = 'semantic'
    `) as {
      subject: string;
      predicate: string;
      object: string;
      importance: number;
    } | undefined;
  }

  function readSemantic(id: string): {
    subject: string;
    predicate: string;
    object: string;
    confidence: number | null;
    importance: number;
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
      importance: number;
      num_times: number;
      owner_id: string | null;
      project_id: string | null;
      origin_source: string;
      privacy_scope: string;
    } | undefined;
  }
});
