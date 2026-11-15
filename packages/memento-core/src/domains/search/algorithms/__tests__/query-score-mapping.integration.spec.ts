/**
 * #1729: 질의 점수 사상은 질의 벡터를 가진 검색 경로에만 걸리고 기억끼리 비교에는 걸리지 않는다.
 * 지금 모델의 계수는 { a: 1, b: 0 } 이라 차이가 안 보인다. 계수를 바꾼 모델로 경로를 가른다.
 */

import type Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { LOCAL_EMBEDDING_MODEL } from '../../../../shared/config/embedding-models.js';
import { initializeDatabase } from '../../../../infrastructure/database/sqlite/init.js';
import { encodeFloat32Embedding } from '../../../../shared/utils/embedding-serialization.js';
import type { ToolContext } from '../../../../tools/types.js';
import { findNearDuplicateCandidates } from '../../../memory/remember/remember-tool-near-duplicate.js';
import { getRankingWeights } from '../../../../shared/config/ranking-weights-loader.js';
import { backfillTextOnlyVectorResults } from '../hybrid-vector-backfill.js';
import { applyVectorLengthDecay } from '../vector-length-decay.js';

const DIMENSIONS = 384;
const CONTENT = '질의 점수 사상 경로를 가르는 같은 글';
const RAW_COSINE = 0.6;
const MAPPED = 2 * RAW_COSINE - 0.5;

let vecAvailable = false;

type MutableMapping = { queryScoreMapping: { a: number; b: number } };
const originalMapping = LOCAL_EMBEDDING_MODEL.queryScoreMapping;

beforeAll(async () => {
  try {
    await import('sqlite-vec');
    vecAvailable = true;
  } catch {
    vecAvailable = false;
  }
  // mapQueryScore 는 모듈 안의 정의를 직접 읽어 모듈 mock 이 닿지 않는다. 테스트 동안만 계수를 바꾼다.
  (LOCAL_EMBEDDING_MODEL as unknown as MutableMapping).queryScoreMapping = { a: 2, b: -0.5 };
});

afterAll(() => {
  (LOCAL_EMBEDDING_MODEL as unknown as MutableMapping).queryScoreMapping = originalMapping;
});

function vector(x: number, y: number): number[] {
  const values = new Array<number>(DIMENSIONS).fill(0);
  values[0] = x;
  values[1] = y;
  return values;
}

const QUERY = vector(1, 0);
const STORED = vector(RAW_COSINE, 0.8);

describe('질의 점수 사상 경로 (#1729)', () => {
  let db: Database.Database | undefined;
  let tempDir: string | undefined;

  afterEach(() => {
    db?.close();
    db = undefined;
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  async function seed(): Promise<Database.Database> {
    tempDir = mkdtempSync(join(tmpdir(), 'memento-query-score-mapping-'));
    db = await initializeDatabase(join(tempDir, 'memory.db'));
    db.prepare(`INSERT INTO memory_item (id, type, content, importance, created_at)
                VALUES ('stored', 'semantic', ?, 0.5, CURRENT_TIMESTAMP)`).run(CONTENT);
    db.prepare(`INSERT INTO memory_embedding
                  (memory_id, embedding_provider, projection_type, embedding, dim, model, dimensions, precision, normalized, version, created_by)
                VALUES ('stored', 'minilm', 'native', ?, ?, ?, ?, 32, 1, 1, 'test')`)
      .run(encodeFloat32Embedding(STORED), DIMENSIONS, LOCAL_EMBEDDING_MODEL.storedName, DIMENSIONS);
    return db;
  }

  it('remember 중복 판정 점수는 사상되지 않는다', async () => {
    if (!vecAvailable) return;
    const database = await seed();
    const context = {
      services: {
        embeddingService: {
          isAvailable: () => true,
          getUnifiedEmbeddingService: () => ({
            generateEmbedding: async () => ({ embedding: QUERY, provider: 'minilm', model: 'm' }),
            getCurrentProviderName: () => 'minilm',
          }),
        },
      },
    } as unknown as ToolContext;

    const { candidates } = await findNearDuplicateCandidates(
      database,
      CONTENT,
      { type: 'semantic', ownerId: null, projectId: null },
      0.5,
      context
    );

    expect(candidates.map((candidate) => candidate.id)).toEqual(['stored']);
    expect(candidates[0]!.similarity).toBeCloseTo(RAW_COSINE, 5);
  });

  it('질의 경로(backfill)는 로컬 임베딩 모델 점수만 사상한다', async () => {
    if (!vecAvailable) return;
    const database = await seed();
    const textResults = [{ id: 'stored', content: CONTENT, type: 'semantic', importance: 0.5, created_at: '2026-01-01' }];

    const [mapped] = backfillTextOnlyVectorResults(database, textResults, [], [{ provider: 'minilm', embedding: QUERY }]);

    // backfill 은 사상한 점수에 길이 감쇠(#921)를 건다.
    const [expected] = applyVectorLengthDecay(
      [{ similarity: MAPPED, content: CONTENT }],
      getRankingWeights().vector_length_decay
    );
    expect(mapped!.similarity).toBeCloseTo(expected!.similarity, 5);
  });
});
