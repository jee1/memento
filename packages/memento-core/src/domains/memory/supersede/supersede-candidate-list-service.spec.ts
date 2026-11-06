import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';
import { mementoConfig } from '../../../shared/config/index.js';
import { querySupersedeCandidates } from './supersede-candidate-list-service.js';
import { dismissSupersedeCandidate, applySupersedeCandidate, restoreSupersededMemory } from './supersede-apply-service.js';
import {
  closeSupersedeTestDb,
  createSupersedeTestDb,
  insertSeedMemory,
  isoDaysAgo,
} from './__tests__/supersede-test-support.js';

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

describe('querySupersedeCandidates (#1618)', () => {
  let db: Database.Database;

  beforeEach(async () => {
    db = await createSupersedeTestDb();
  });

  afterEach(() => {
    closeSupersedeTestDb(db);
  });

  function insertCandidate(
    oldId: string,
    newId: string,
    opts: { projectId?: string | null; verdict?: string } = {},
  ): string {
    const id = randomUUID();
    const old = db.prepare('SELECT content FROM memory_item WHERE id = ?').get(oldId) as { content: string };
    const next = db.prepare('SELECT content FROM memory_item WHERE id = ?').get(newId) as { content: string };
    db.prepare(
      `INSERT INTO memory_supersede_candidate (
         id, old_memory_id, new_memory_id, owner_id, project_id, privacy_scope, memory_type, verdict,
         rationale, evidence_quote, old_content_sha256, new_content_sha256, provider, model,
         prompt_version, input_hash, llm_logical_request_id, created_at
       ) VALUES (?, ?, ?, NULL, ?, 'private', 'semantic', ?, '근거', NULL, ?, ?, 'gemini', 'm', 'v', ?, NULL, ?)`,
    ).run(
      id,
      oldId,
      newId,
      opts.projectId ?? null,
      opts.verdict ?? 'confirmed',
      sha256(old.content),
      sha256(next.content),
      id,
      '2026-11-01T00:00:00.000Z',
    );
    return id;
  }

  it('defaults to confirmed and pending without dismissed rows', () => {
    insertSeedMemory(db, { id: 'mem_A', content: 'A', createdAt: isoDaysAgo(10), projectId: 'p1' });
    insertSeedMemory(db, { id: 'mem_B', content: 'B', createdAt: isoDaysAgo(5), projectId: 'p1' });
    insertSeedMemory(db, { id: 'mem_C', content: 'C', createdAt: isoDaysAgo(5), projectId: 'p2' });
    insertSeedMemory(db, { id: 'mem_D', content: 'D', createdAt: isoDaysAgo(5), projectId: 'p2' });
    const keep = insertCandidate('mem_A', 'mem_B', { projectId: 'p1' });
    insertCandidate('mem_C', 'mem_D', { projectId: 'p2', verdict: 'compatible' });
    const dismissedId = insertCandidate('mem_A', 'mem_C', { projectId: 'p1', verdict: 'pending' });
    dismissSupersedeCandidate(db, { candidateId: dismissedId, actor: 'op' });

    const scoped = querySupersedeCandidates(db, { project_id: 'p1' });
    expect(scoped.candidates.map((row) => row.id)).toEqual([keep]);
    expect(scoped.filters_applied.project_id).toBe('p1');
  });

  it('reflects applied lifecycle after approval', () => {
    mementoConfig.supersedeApplyEnabled = true;
    insertSeedMemory(db, { id: 'mem_A', content: 'A', createdAt: isoDaysAgo(10) });
    insertSeedMemory(db, { id: 'mem_B', content: 'B', createdAt: isoDaysAgo(5) });
    const id = insertCandidate('mem_A', 'mem_B');
    applySupersedeCandidate(db, { candidateId: id, actor: 'op' });
    const row = querySupersedeCandidates(db, { lifecycle_status: 'applied' }).candidates[0];
    expect(row.lifecycle_status).toBe('applied');
    mementoConfig.supersedeApplyEnabled = false;
  });

  it('#1638: shows target_deleted when new is soft-deleted (matches read path)', () => {
    mementoConfig.supersedeApplyEnabled = true;
    insertSeedMemory(db, { id: 'mem_A', content: 'A', createdAt: isoDaysAgo(10) });
    insertSeedMemory(db, { id: 'mem_B', content: 'B', createdAt: isoDaysAgo(5) });
    const id = insertCandidate('mem_A', 'mem_B');
    applySupersedeCandidate(db, { candidateId: id, actor: 'op' });
    db.prepare('UPDATE memory_item SET is_deleted = 1, deleted_at = ? WHERE id = ?').run(isoDaysAgo(0), 'mem_B');

    const row = querySupersedeCandidates(db, { lifecycle_status: 'target_deleted' }).candidates[0];
    expect(row.lifecycle_status).toBe('target_deleted');
    expect(row.old_superseded_by).toBe('mem_B');
    mementoConfig.supersedeApplyEnabled = false;
  });

  it('#1637: dangling pointer on old lists dangling_pointer and exposes old_superseded_by for restore', () => {
    mementoConfig.supersedeApplyEnabled = true;
    insertSeedMemory(db, { id: 'mem_old', content: 'old', createdAt: isoDaysAgo(10) });
    insertSeedMemory(db, { id: 'mem_new1', content: 'n1', createdAt: isoDaysAgo(5) });
    insertSeedMemory(db, { id: 'mem_new2', content: 'n2', createdAt: isoDaysAgo(4) });
    insertCandidate('mem_old', 'mem_new2', { verdict: 'confirmed' });
    const appliedId = insertCandidate('mem_old', 'mem_new1', { verdict: 'confirmed' });
    applySupersedeCandidate(db, { candidateId: appliedId, actor: 'op' });
    db.prepare('DELETE FROM memory_item WHERE id = ?').run('mem_new1');

    const dangling = querySupersedeCandidates(db, { lifecycle_status: 'dangling_pointer' }).candidates[0];
    expect(dangling.old_memory_id).toBe('mem_old');
    expect(dangling.new_memory_id).toBe('mem_new2');
    expect(dangling.old_superseded_by).toBe('mem_new1');

    const restored = restoreSupersededMemory(db, {
      oldMemoryId: 'mem_old',
      expectedNewMemoryId: 'mem_new1',
      actor: 'op',
    });
    expect(restored.kind).toBe('restored');
    applySupersedeCandidate(db, { candidateId: dangling.id, actor: 'op' });
    const applied = querySupersedeCandidates(db, { lifecycle_status: 'applied' }).candidates.find((r) => r.id === dangling.id);
    expect(applied?.lifecycle_status).toBe('applied');

    mementoConfig.supersedeApplyEnabled = false;
  });
});
