/**
 * #813 T008: gated-path persist — form-(2) / bad kg_triple zero
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { setupTestDatabase, cleanupTestDatabase } from '../../../../test/helpers/test-database.js';
import { DatabaseUtils } from '../../../shared/utils/database.js';
import { createRelationGraph } from '../../../infrastructure/relation-graph-factory.js';
import type { MemoryEmbeddingService } from '../services/memory-embedding-service.js';
import { SemanticMemoryUpdateService } from './semantic-memory-update-service.js';
import { TripleNormalizer } from '../../relation/services/triple-extraction/triple-normalizer.js';
import { buildTripleSentence } from './triple-sentence.js';
import type { Triple } from '../../../shared/types/triple-extraction.js';

describe('predicate gate persist path (#813 SC-001/002)', () => {
  let db: Database.Database;
  let service: SemanticMemoryUpdateService;
  const normalizer = new TripleNormalizer();
  const episodicContent = '합성 episodic 원문 — 형태(2) 폴백이면 이 문자열이 content가 된다';

  beforeEach(async () => {
    db = await setupTestDatabase();
    service = new SemanticMemoryUpdateService(
      db,
      createRelationGraph(db),
      undefined,
      undefined,
      {
        createAndStoreEmbedding: vi.fn().mockResolvedValue(undefined),
      } as unknown as MemoryEmbeddingService
    );
    DatabaseUtils.run(db, `
      INSERT INTO memory_item (id, type, content, importance, is_deleted)
      VALUES ('episode-gate-1', 'episodic', ?, 0.5, 0)
    `, [episodicContent]);
  });

  afterEach(() => {
    cleanupTestDatabase(db);
    vi.restoreAllMocks();
  });

  function countKg(): number {
    return (DatabaseUtils.get(db, 'SELECT COUNT(*) as c FROM kg_triple', []) as { c: number }).c;
  }

  function semanticRows(): Array<{ content: string; predicate: string }> {
    return DatabaseUtils.all(db, `
      SELECT content, predicate FROM memory_item WHERE type = 'semantic' AND is_deleted = 0
    `, []) as Array<{ content: string; predicate: string }>;
  }

  it('phrase/Latin predicates → 0 semantic form-(2) and 0 kg_triple after gate', async () => {
    const raw: Triple[] = [
      { subject: '시스템', predicate: '관련 작업', object: '기능' },
      { subject: '시스템', predicate: 'xyzlatin', object: '기능' },
    ];
    const accepted = normalizer.normalize(raw);
    expect(accepted).toEqual([]);

    const evidence = await service.updateSemanticMemoryWithEvidence(
      {
        triples: accepted,
        extractionInfo: {
          steps: { canonicalization: false, entityLinking: false },
          predicateSkips: [
            { index: 0, predicate: '관련 작업', reason: 'predicate_canonicalize_failed' },
            { index: 1, predicate: 'xyzlatin', reason: 'predicate_canonicalize_failed' },
          ],
        },
      },
      { episodicMemoryId: 'episode-gate-1', confidenceThreshold: 0.25 }
    );

    expect(evidence.result.created).toBe(0);
    expect(semanticRows()).toEqual([]);
    expect(countKg()).toBe(0);
  });

  it('canonical / OOV Hangul → reassembled content only (not episodic fallback)', async () => {
    const raw: Triple[] = [
      { subject: '시스템', predicate: '사용함', object: '기능' },
      { subject: '패키지', predicate: '배포함', object: '모듈' },
      { subject: '시스템', predicate: '관련 작업', object: '기능' },
    ];
    const accepted = normalizer.normalize(raw);
    expect(accepted.map((t) => t.predicate)).toEqual(['사용함', '배포함']);

    const evidence = await service.updateSemanticMemoryWithEvidence(
      {
        triples: accepted,
        extractionInfo: {
          steps: { canonicalization: true, entityLinking: true },
          predicateSkips: [
            { index: 2, predicate: '관련 작업', reason: 'predicate_canonicalize_failed' },
          ],
          predicateSkipCounts: { predicate_canonicalize_failed: 1 },
        },
      },
      { episodicMemoryId: 'episode-gate-1', confidenceThreshold: 0.25 }
    );

    expect(evidence.result.created).toBe(2);
    const rows = semanticRows();
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.content).not.toBe(episodicContent);
      const stored = DatabaseUtils.get(db, `
        SELECT subject, predicate, object, content FROM memory_item
        WHERE type = 'semantic' AND predicate = ? AND is_deleted = 0
      `, [row.predicate]) as { subject: string; predicate: string; object: string; content: string };
      expect(stored.content).toBe(
        buildTripleSentence(stored.subject, stored.predicate, stored.object)
      );
      expect(stored.content).not.toBeNull();
    }

    const kg = DatabaseUtils.all(db, 'SELECT predicate FROM kg_triple', []) as Array<{ predicate: string }>;
    expect(kg).toHaveLength(2);
    for (const row of kg) {
      expect(/[\uAC00-\uD7A3]$/.test(row.predicate)).toBe(true);
      expect(/\s/.test(row.predicate)).toBe(false);
    }
  });
});
