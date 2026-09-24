/**
 * #1137: 재조립 불가 triple이 원본 episodic 본문을 content로 복사하지 않는지 고정한다.
 *
 * 게이트(#813)는 triple-extraction-service 앞단에 있고,
 * semantic-memory-update-pipeline.ts:212 의 prepareNormalizedTriple 은 canonicalize 실패를
 * 통과시킨다. 즉 게이트를 우회해 들어오는 경로가 존재하므로 쓰기 측 방어선이 필요하다.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { setupTestDatabase, cleanupTestDatabase } from '../../../../test/helpers/test-database.js';
import { DatabaseUtils } from '../../../shared/utils/database.js';
import { createRelationGraph } from '../../../infrastructure/relation-graph-factory.js';
import type { MemoryEmbeddingService } from '../services/memory-embedding-service.js';
import { SemanticMemoryUpdateService } from './semantic-memory-update-service.js';
import type { Triple } from '../../../shared/types/triple-extraction.js';

describe('재조립 불가 triple의 content (#1137)', () => {
  let db: Database.Database;
  let service: SemanticMemoryUpdateService;
  const episodicContent = '합성 episodic 원문 — 원문 폴백이면 이 문자열이 content가 된다';

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
      VALUES ('episode-1137', 'episodic', ?, 0.5, 0)
    `, [episodicContent]);
  });

  afterEach(() => {
    cleanupTestDatabase(db);
    vi.restoreAllMocks();
  });

  function semanticRows(): Array<{ content: string; predicate: string }> {
    return DatabaseUtils.all(db, `
      SELECT content, predicate FROM memory_item WHERE type = 'semantic' AND is_deleted = 0
    `, []) as Array<{ content: string; predicate: string }>;
  }

  it('한 episodic에서 나온 재조립 불가 triple 3개가 서로 다른 content를 갖는다', async () => {
    // 정규화를 거치지 않고 직접 투입한다 — 게이트 밖 경로를 재현한다
    const triples: Triple[] = [
      { subject: 'llmbasedrelationextractor', predicate: 'zzstores', object: 'initializedproviders' },
      { subject: 'isollamaavailable', predicate: 'zzchecks', object: 'ollama' },
      { subject: 'tests', predicate: 'zzcover', object: 'determineprovider' },
    ];

    const evidence = await service.updateSemanticMemoryWithEvidence(
      {
        triples,
        extractionInfo: {
          steps: { canonicalization: false, entityLinking: false },
        },
      },
      { episodicMemoryId: 'episode-1137', confidenceThreshold: 0.25 }
    );

    expect(evidence.result.created).toBe(3);

    const rows = semanticRows();
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.content).not.toBe(episodicContent);
    }
    expect(new Set(rows.map((row) => row.content)).size).toBe(3);
  });
});
