import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { HybridSearchEngine } from '@memento/core';
import { createSeededBenchmarkDatabase, type SeededBenchmarkDb } from './lib/benchmark-search-database.js';
import { evaluateProfile } from './compare-weight-profiles.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MINI = join(ROOT, 'tests/fixtures/search-quality/ranking-preview-mini');
const PROFILE = join(ROOT, 'config/ranking-weights.toml');

describe('evaluateProfile queryIds', () => {
  const previousProvider = process.env.EMBEDDING_PROVIDER;
  let seeded: SeededBenchmarkDb;

  beforeAll(async () => {
    process.env.EMBEDDING_PROVIDER = 'tfidf';
    seeded = await createSeededBenchmarkDatabase(MINI);
  });

  afterAll(() => {
    seeded.close();
    if (previousProvider === undefined) delete process.env.EMBEDDING_PROVIDER;
    else process.env.EMBEDDING_PROVIDER = previousProvider;
  });

  it('queryIds 를 주지 않으면 전체 쿼리를 실행한다', async () => {
    const all = await evaluateProfile(seeded.db, PROFILE, MINI);
    expect(all.query_ids).toHaveLength(8);
  });

  it('queryIds 를 주면 그 쿼리만 검색을 실행한다 (실행 뒤 거르지 않는다)', async () => {
    const search = vi.spyOn(HybridSearchEngine.prototype, 'search');
    try {
      const dev = await evaluateProfile(seeded.db, PROFILE, MINI, { queryIds: ['q_01', 'q_03'] });
      expect(dev.query_ids.sort()).toEqual(['q_01', 'q_03']);
      expect(search).toHaveBeenCalledTimes(2);
      const searched = search.mock.calls.map((call) => (call[1] as { query: string }).query).sort();
      expect(searched).toEqual(['FTS5 한국어 trigram 인덱스', 'canary release 첫 단계 요청 비율'].sort());
    } finally {
      search.mockRestore();
    }
  });

  it('ground truth 에 없는 query id 는 실패한다', async () => {
    await expect(evaluateProfile(seeded.db, PROFILE, MINI, { queryIds: ['q_01', 'q_nope'] })).rejects.toThrow(/q_nope/);
  });
});
