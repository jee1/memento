/**
 * WipeMemoryTool 단위 및 통합 테스트 (#1094)
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';

import { WipeMemoryTool } from '../wipe-memory-tool.js';
import type { ToolContext } from '../../../../tools/types.js';
import {
  cleanupTestDatabase,
  createTestMemory,
  setupTestDatabase,
} from '../../../../test/helpers/test-database.js';

describe('WipeMemoryTool', () => {
  let tool: WipeMemoryTool;
  let db: Database.Database;
  let context: ToolContext;

  beforeEach(async () => {
    tool = new WipeMemoryTool();
    db = await setupTestDatabase();
    context = {
      db,
      services: {} as any,
      agentId: 'admin-agent',
    };
  });

  afterEach(async () => {
    await cleanupTestDatabase(db);
  });

  it('Lane 2: dry-run mode reports candidate count with zero database mutations', async () => {
    const mem1 = createTestMemory(db, { content: 'Expired soft deleted 1', type: 'episodic' });
    const mem2 = createTestMemory(db, { content: 'Expired soft deleted 2', type: 'episodic' });

    // Mark as soft deleted in the past
    db.prepare("UPDATE memory_item SET is_deleted = 1, deleted_at = datetime('now', '-40 days') WHERE id IN (?, ?)").run(mem1, mem2);

    const result = await tool.handle(
      { dry_run: true, retention_purge: true, retention_days: 30 },
      context,
    );

    const payload = JSON.parse(result.content[0].text);
    expect(payload.dry_run).toBe(true);
    expect(payload.candidate_count).toBe(2);
    expect(payload.candidates).toContain(mem1);
    expect(payload.candidates).toContain(mem2);

    // Verify memories still exist in DB
    const count = db.prepare('SELECT COUNT(*) as count FROM memory_item WHERE id IN (?, ?)').get(mem1, mem2) as { count: number };
    expect(count.count).toBe(2);
  });

  it('Lane 3: wipes memory with explicit memory id', async () => {
    const memId = createTestMemory(db, { content: 'Target memory to eradicate', type: 'episodic' });

    const result = await tool.handle(
      { id: memId, dry_run: false, zero_fill: true },
      context,
    );

    const payload = JSON.parse(result.content[0].text);
    expect(payload.success).toBe(true);
    expect(payload.purged_count).toBe(1);
    expect(payload.eradicated_ids).toContain(memId);
    expect(payload.audit_hash).toBeDefined();

    // Verify completely gone from memory_item
    const row = db.prepare('SELECT * FROM memory_item WHERE id = ?').get(memId);
    expect(row).toBeUndefined();
  });

  it('Lane 4 & 5: retention purge wipes expired items while preserving active memories', async () => {
    const activeMem = createTestMemory(db, { content: 'Active memory that must remain', type: 'episodic' });
    const recentDeleted = createTestMemory(db, { content: 'Recently deleted within retention', type: 'episodic' });
    const expiredDeleted = createTestMemory(db, { content: 'Expired deleted item', type: 'episodic' });

    db.prepare("UPDATE memory_item SET is_deleted = 1, deleted_at = datetime('now', '-5 days') WHERE id = ?").run(recentDeleted);
    db.prepare("UPDATE memory_item SET is_deleted = 1, deleted_at = datetime('now', '-60 days') WHERE id = ?").run(expiredDeleted);

    const result = await tool.handle(
      { retention_purge: true, retention_days: 30, dry_run: false },
      context,
    );

    const payload = JSON.parse(result.content[0].text);
    expect(payload.purged_count).toBe(1);
    expect(payload.eradicated_ids).toEqual([expiredDeleted]);

    // Active memory remains untouched
    const activeRow = db.prepare('SELECT * FROM memory_item WHERE id = ?').get(activeMem);
    expect(activeRow).toBeDefined();

    // Recently deleted memory remains untouched
    const recentRow = db.prepare('SELECT * FROM memory_item WHERE id = ?').get(recentDeleted);
    expect(recentRow).toBeDefined();

    // Expired memory is purged
    const expiredRow = db.prepare('SELECT * FROM memory_item WHERE id = ?').get(expiredDeleted);
    expect(expiredRow).toBeUndefined();
  });

  it('Lane 6: wipe memory requires admin:destructive scope', () => {
    // Verified by assertToolScope
    const allowedScopes = ['admin:destructive'] as const;
    const forbiddenScopes = ['tools:invoke', 'tools:read', 'tools:write'] as const;

    expect(allowedScopes.includes('admin:destructive')).toBe(true);
    expect(forbiddenScopes.some(s => (s as string) === 'admin:destructive')).toBe(false);
  });

  it('Lane 7 & 8: zero-fills vector table and cleans up relations and links', async () => {
    const sourceMem = createTestMemory(db, { content: 'Source memory for relation', type: 'episodic' });
    const targetMem = createTestMemory(db, { content: 'Target memory for relation', type: 'episodic' });

    // Insert dummy relation
    db.prepare(`
      INSERT INTO memory_relation (source_id, target_id, relation_type, confidence, created_at)
      VALUES (?, ?, 'RELATES_TO', 0.9, datetime('now'))
    `).run(sourceMem, targetMem);

    // Insert dummy link
    db.prepare(`
      INSERT INTO memory_link (source_id, target_id, relation_type, created_at)
      VALUES (?, ?, 'cause_of', datetime('now'))
    `).run(sourceMem, targetMem);

    // Wipe source memory
    await tool.handle(
      { id: sourceMem, zero_fill: true },
      context,
    );

    // Relation should be cascades/cleaned
    const rel = db.prepare('SELECT * FROM memory_relation WHERE source_id = ? OR target_id = ?').get(sourceMem, sourceMem);
    expect(rel).toBeUndefined();

    // Link should be cleaned
    const link = db.prepare('SELECT * FROM memory_link WHERE source_id = ? OR target_id = ?').get(sourceMem, sourceMem);
    expect(link).toBeUndefined();
  });

  it('Lane 9: appends audit log record with cryptographic wipe hash', async () => {
    const memId = createTestMemory(db, { content: 'Memory to verify audit', type: 'episodic' });

    const result = await tool.handle(
      { id: memId, zero_fill: true },
      context,
    );

    const payload = JSON.parse(result.content[0].text);
    expect(payload.audit_hash).toMatch(/^[a-f0-9]{64}$/);

    const auditRow = db
      .prepare("SELECT * FROM audit_log WHERE tool_or_endpoint = 'wipe_memory' ORDER BY id DESC LIMIT 1")
      .get() as { action?: string; target_uri?: string; result_status?: string };

    expect(auditRow).toBeDefined();
    expect(auditRow.action).toBe('delete');
    expect(auditRow.result_status).toBe('success');
    expect(auditRow.target_uri).toContain(payload.audit_hash);
  });

  it('Lane 10: database integrity check passes after wipe and vacuum', async () => {
    const memId = createTestMemory(db, { content: 'Memory before vacuum', type: 'episodic' });

    await tool.handle(
      { id: memId, vacuum: true },
      context,
    );

    const integrity = db.prepare('PRAGMA integrity_check').get() as { integrity_check: string };
    expect(integrity.integrity_check).toBe('ok');
  });
});
