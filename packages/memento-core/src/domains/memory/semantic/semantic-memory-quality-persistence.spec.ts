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
});
