import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import { WINDOW_CANDIDATE_MIN_CHARS, WINDOW_PROJECTION_PREFIX } from '@memento/core';
import type { BenchmarkCorpusEntry } from '@memento/core/domains/monitoring/services/quality-assurance/search-quality-benchmark-fixtures.js';

import { assertWindowEmbeddingsSeeded } from './benchmark-search-database.js';

/**
 * #1103: stale dist 로 시드하면 window:N 행이 하나도 안 생기는데 에러가 없었다.
 * 그 상태로 잰 숫자는 #1112 이전 동작이다.
 */
function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(
    `CREATE TABLE memory_embedding (memory_id TEXT, embedding_provider TEXT, projection_type TEXT)`
  );
  return db;
}

function entry(chars: number, id: string): BenchmarkCorpusEntry {
  return {
    benchmark_id: id,
    source_memory_id: `src_${id}`,
    type: 'episodic',
    content: 'ㄱ'.repeat(chars),
  };
}

function insertWindowRow(db: Database.Database, memoryId: string): void {
  db.prepare(
    `INSERT INTO memory_embedding (memory_id, embedding_provider, projection_type) VALUES (?, ?, ?)`
  ).run(memoryId, 'minilm', `${WINDOW_PROJECTION_PREFIX}0`);
}

describe('#1103: assertWindowEmbeddingsSeeded', () => {
  let db: Database.Database | undefined;

  afterEach(() => {
    db?.close();
    db = undefined;
  });

  it('긴 문서가 있는데 윈도 행이 0개면 빌드 안내와 함께 실패한다', () => {
    db = makeDb();
    const corpus = [entry(WINDOW_CANDIDATE_MIN_CHARS, 'long_1')];

    expect(() => assertWindowEmbeddingsSeeded(db!, 'minilm', corpus)).toThrow(
      /npm run build -w @memento\/core/
    );
  });

  it('윈도 행이 있으면 통과한다', () => {
    db = makeDb();
    insertWindowRow(db, 'src_long_1');
    const corpus = [entry(WINDOW_CANDIDATE_MIN_CHARS, 'long_1')];

    expect(() => assertWindowEmbeddingsSeeded(db!, 'minilm', corpus)).not.toThrow();
  });

  it('임계값 미만 문서뿐이면 검사하지 않는다', () => {
    db = makeDb();
    const corpus = [entry(WINDOW_CANDIDATE_MIN_CHARS - 1, 'short_1')];

    expect(() => assertWindowEmbeddingsSeeded(db!, 'minilm', corpus)).not.toThrow();
  });

  it('minilm 이 아닌 provider 는 윈도 행을 만들지 않으므로 검사하지 않는다', () => {
    db = makeDb();
    const corpus = [entry(WINDOW_CANDIDATE_MIN_CHARS, 'long_1')];

    expect(() => assertWindowEmbeddingsSeeded(db!, 'openai', corpus)).not.toThrow();
  });
});
