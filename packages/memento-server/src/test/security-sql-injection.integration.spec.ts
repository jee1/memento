import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  cleanupTestDatabase,
  createTestMemory,
  setupTestDatabase,
} from '../../../memento-core/test/helpers/test-database.js';
import { SearchEngine } from '../../../memento-core/src/domains/search/algorithms/search-engine.js';
import { DatabaseUtils } from '../../../memento-core/src/shared/utils/database.js';

function tableCount(db: Database.Database): number {
  const rows = DatabaseUtils.all(
    db,
    "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
  ) as Array<{ count: number }>;
  return rows[0]?.count ?? 0;
}

function expectDatabaseIntact(db: Database.Database, initialTableCount: number): void {
  expect(tableCount(db)).toBe(initialTableCount);
  expect(
    DatabaseUtils.all(
      db,
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'memory_item'",
    ),
  ).toHaveLength(1);
  expect(
    (DatabaseUtils.all(db, 'SELECT COUNT(*) AS count FROM memory_item') as Array<{ count: number }>)[0]
      ?.count,
  ).toBe(2);
}

describe('SQL injection search hardening', () => {
  let db: Database.Database;
  let initialTableCount: number;
  const searchEngine = new SearchEngine();

  beforeEach(async () => {
    db = await setupTestDatabase();
    createTestMemory(db, { content: 'Test memory 1', type: 'episodic', importance: 0.5 });
    createTestMemory(db, { content: 'Test memory 2', type: 'semantic', importance: 0.7 });
    initialTableCount = tableCount(db);
  });

  afterEach(() => {
    cleanupTestDatabase(db);
  });

  it.each([
    "'; DROP TABLE memory_item--",
    "' OR '1'='1",
    "' UNION SELECT * FROM memory_item--",
    "test'--",
    "test'/*",
  ])('treats %j as search text without exposing or corrupting data', async (query) => {
    try {
      const result = await searchEngine.search(db, { query, limit: 10 });
      expect(result.items.length).toBeLessThanOrEqual(2);
    } catch {
      // Rejecting malformed FTS input is also safe; integrity assertions below remain mandatory.
    }

    expectDatabaseIntact(db, initialTableCount);
  });
});
