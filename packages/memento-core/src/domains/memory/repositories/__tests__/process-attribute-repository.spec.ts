/**
 * ProcessAttributeRepository 테스트 (Issue #91)
 *
 * Given/When/Then:
 * - Given: DB with process_attribute table (020 applied)
 * - When: getByProcessId('p1') after insert (process_id='p1', topics=['budget','finance'], ...)
 * - Then: returns { process_id: 'p1', topics: ['budget','finance'], workflow_names: [], skill_names: [] }
 * - When: getByProcessId('p2') (no row)
 * - Then: returns null
 * - When: upsert({ process_id: 'p2', topics: ['code-review'] })
 * - Then: getByProcessId('p2') returns that record
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { ProcessAttributeRepository } from '../process-attribute-repository.js';

function createProcessAttributeTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS process_attribute (
      process_id TEXT PRIMARY KEY,
      topics TEXT NULL,
      workflow_names TEXT NULL,
      skill_names TEXT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    )
  `);
}

describe('ProcessAttributeRepository', () => {
  let db: Database.Database;
  let repo: ProcessAttributeRepository;

  beforeEach(() => {
    db = new Database(':memory:');
    createProcessAttributeTable(db);
    repo = new ProcessAttributeRepository(db);
  });

  afterEach(() => {
    if (db) db.close();
  });

  describe('getByProcessId', () => {
    it('Given: process_attribute에 (p1, topics=["budget","finance"], workflow_names=[], skill_names=[]) 삽입, When: getByProcessId("p1"), Then: 해당 객체 반환', () => {
      db.prepare(
        `INSERT INTO process_attribute (process_id, topics, workflow_names, skill_names)
         VALUES (?, ?, ?, ?)`
      ).run('p1', '["budget","finance"]', '[]', '[]');

      const result = repo.getByProcessId('p1');
      expect(result).not.toBeNull();
      expect(result!.process_id).toBe('p1');
      expect(result!.topics).toEqual(['budget', 'finance']);
      expect(result!.workflow_names).toEqual([]);
      expect(result!.skill_names).toEqual([]);
    });

    it('Given: process_attribute에 p2 없음, When: getByProcessId("p2"), Then: null 반환', () => {
      const result = repo.getByProcessId('p2');
      expect(result).toBeNull();
    });
  });

  describe('upsert', () => {
    it('Given: 빈 process_attribute, When: upsert({ process_id: "p2", topics: ["code-review"] }), Then: getByProcessId("p2")가 해당 레코드 반환', () => {
      repo.upsert({ process_id: 'p2', topics: ['code-review'] });

      const result = repo.getByProcessId('p2');
      expect(result).not.toBeNull();
      expect(result!.process_id).toBe('p2');
      expect(result!.topics).toEqual(['code-review']);
    });

    it('Given: p2가 이미 있음, When: upsert로 workflow_names 갱신, Then: getByProcessId("p2")가 갱신된 값 반환', () => {
      repo.upsert({ process_id: 'p2', topics: ['code-review'] });
      repo.upsert({ process_id: 'p2', workflow_names: ['코드리뷰'], skill_names: ['정적분석'] });

      const result = repo.getByProcessId('p2');
      expect(result).not.toBeNull();
      expect(result!.workflow_names).toEqual(['코드리뷰']);
      expect(result!.skill_names).toEqual(['정적분석']);
    });
  });
});
