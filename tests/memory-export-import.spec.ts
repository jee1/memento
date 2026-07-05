/**
 * JSONL memory export/import round-trip (Issue #668)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  exportMemoryJsonlSync,
  importMemoryJsonl,
  MEMENTO_LATEST_SCHEMA_VERSION,
} from '@memento/core';
import {
  cleanupTestDatabase,
  createTestMemory,
  setupTestDatabase,
} from '../packages/memento-core/src/test/helpers/test-database.js';
import { DatabaseUtils } from '../packages/memento-core/src/shared/utils/database.js';

describe('memory export/import JSONL round-trip', () => {
  let db: Database.Database;
  let tempDir: string;

  beforeEach(async () => {
    db = await setupTestDatabase();
    tempDir = mkdtempSync(join(tmpdir(), 'memento-jsonl-'));
  });

  afterEach(() => {
    cleanupTestDatabase(db);
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('exports and imports memory_item rows with manifest checksum', async () => {
    const idA = createTestMemory(db, {
      content: 'Round trip memory A',
      type: 'semantic',
      tags: ['export', 'test'],
    });
    const idB = createTestMemory(db, {
      content: 'Round trip memory B',
      type: 'episodic',
      importance: 0.8,
    });

    const jsonl = exportMemoryJsonlSync(db, { includeRelations: false });
    const manifest = JSON.parse(jsonl.split('\n')[0]!);
    expect(manifest.type).toBe('manifest');
    expect(manifest.schema_version).toBe(MEMENTO_LATEST_SCHEMA_VERSION);
    expect(manifest.record_counts.memory_item).toBe(2);

    const targetDb = await setupTestDatabase();
    try {
      const result = importMemoryJsonl(targetDb, jsonl);
      expect(result.memoryItems).toBe(2);

      const rowA = DatabaseUtils.get(
        targetDb,
        'SELECT content, type FROM memory_item WHERE id = ?',
        [idA],
      ) as { content: string; type: string };
      const rowB = DatabaseUtils.get(
        targetDb,
        'SELECT content, importance FROM memory_item WHERE id = ?',
        [idB],
      ) as { content: string; importance: number };

      expect(rowA.content).toBe('Round trip memory A');
      expect(rowA.type).toBe('semantic');
      expect(rowB.content).toBe('Round trip memory B');
      expect(rowB.importance).toBe(0.8);
    } finally {
      cleanupTestDatabase(targetDb);
    }
  });

  it('includes optional memory_relation rows when requested', async () => {
    const sourceId = createTestMemory(db, { content: 'Source', type: 'semantic' });
    const targetId = createTestMemory(db, { content: 'Target', type: 'semantic' });

    DatabaseUtils.run(db, `
      INSERT INTO memory_relation (source_id, target_id, relation_type, confidence)
      VALUES (?, ?, 'REFERENCES', 0.85)
    `, [sourceId, targetId]);

    const jsonl = exportMemoryJsonlSync(db, { includeRelations: true });
    const manifest = JSON.parse(jsonl.split('\n')[0]!);
    expect(manifest.record_counts.memory_relation).toBe(1);

    const targetDb = await setupTestDatabase();
    try {
      const result = importMemoryJsonl(targetDb, jsonl);
      expect(result.memoryRelations).toBe(1);

      const relation = DatabaseUtils.get(
        targetDb,
        `SELECT source_id, target_id, relation_type FROM memory_relation
         WHERE source_id = ? AND target_id = ?`,
        [sourceId, targetId],
      );
      expect(relation).toBeDefined();
    } finally {
      cleanupTestDatabase(targetDb);
    }
  });
});
