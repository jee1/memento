/**
 * Procedural Versioning 서비스 테스트 (Issue #57 Phase 2)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { DatabaseUtils } from '../../../../shared/utils/database.js';
import {
  getVersionChain,
  getLatestVersionInSeries,
  getNextVersionNumber
} from '../procedural-versioning.js';

function createSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE memory_item (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      version INTEGER NULL,
      version_series_id TEXT NULL,
          project_id TEXT,
          is_deleted BOOLEAN DEFAULT FALSE NOT NULL,
          deleted_at TEXT
    )
  `);
  db.exec(`
    INSERT INTO memory_item (id, type, content, version, version_series_id, created_at) VALUES ('proc-1', 'procedural', 'A', 1, 'series-x', '2026-01-01T00:00:00Z'),
      ('proc-2', 'procedural', 'B', 2, 'series-x', '2026-01-02T00:00:00Z'),
      ('proc-3', 'procedural', 'C', 3, 'series-x', '2026-01-03T00:00:00Z'),
      ('standalone', 'procedural', 'S', 1, NULL, '2026-01-04T00:00:00Z'),
      ('other', 'episodic', 'E', NULL, NULL, '2026-01-05T00:00:00Z')
  `);
}

describe('procedural-versioning', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    createSchema(db);
  });

  afterEach(() => {
    if (db) db.close();
  });

  describe('getVersionChain', () => {
    it('Given: 시리즈에 속한 메모리 id, When: getVersionChain 호출하면, Then: version 오름차순 VersionChainItem[] 반환', () => {
      const chain = getVersionChain(db, 'proc-2');
      expect(chain).toHaveLength(3);
      expect(chain[0]).toEqual({ id: 'proc-1', version: 1, created_at: '2026-01-01T00:00:00Z' });
      expect(chain[1].version).toBe(2);
      expect(chain[2].version).toBe(3);
    });

    it('Given: 존재하지 않는 id, When: getVersionChain 호출하면, Then: 빈 배열 반환', () => {
      const chain = getVersionChain(db, 'nonexistent');
      expect(chain).toEqual([]);
    });

    it('Given: version_series_id가 NULL인 standalone, When: getVersionChain 호출하면, Then: 해당 1건만 반환', () => {
      const chain = getVersionChain(db, 'standalone');
      expect(chain).toHaveLength(1);
      expect(chain[0].id).toBe('standalone');
      expect(chain[0].version).toBe(1);
    });
  });

  describe('getLatestVersionInSeries', () => {
    it('Given: version_series_id, When: getLatestVersionInSeries 호출하면, Then: version 최대인 1건 반환', () => {
      const latest = getLatestVersionInSeries(db, 'series-x');
      expect(latest).not.toBeNull();
      expect(latest!.id).toBe('proc-3');
      expect(latest!.version).toBe(3);
    });

    it('Given: 존재하지 않는 시리즈, When: getLatestVersionInSeries 호출하면, Then: null 반환', () => {
      const latest = getLatestVersionInSeries(db, 'no-series');
      expect(latest).toBeNull();
    });
  });

  describe('getNextVersionNumber', () => {
    it('Given: 시리즈에 3건 있으면, When: getNextVersionNumber 호출하면, Then: 4 반환', () => {
      const next = getNextVersionNumber(db, 'series-x');
      expect(next).toBe(4);
    });

    it('Given: 행이 없는 시리즈, When: getNextVersionNumber 호출하면, Then: 1 반환', () => {
      const next = getNextVersionNumber(db, 'empty-series');
      expect(next).toBe(1);
    });
  });
});
