import type Database from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findSupersededMemoryIds } from '../../repositories/memory-item-repository.js';
import { applySupersedeCandidate, restoreSupersededMemory } from '../supersede-apply-service.js';
import { SupersedeCandidateService } from '../supersede-candidate-service.js';
import {
  closeSupersedeTestDb,
  createSupersedeTestDb,
  fakeChatPort,
  insertSeedMemory,
  isoDaysAgo,
  judgeReply,
  type SeedMemory,
} from './supersede-test-support.js';

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

interface EventRow {
  action: string;
  old_memory_id: string;
  new_memory_id: string;
  candidate_id: string | null;
  actor: string;
  reason: string | null;
}

describe('direct supersede apply and restore (#1551)', () => {
  let db: Database.Database;

  beforeEach(async () => {
    db = await createSupersedeTestDb();
    db.pragma('foreign_keys = ON');
  });

  afterEach(() => {
    closeSupersedeTestDb(db);
  });

  function memory(id: string, daysAgo: number, overrides: Partial<SeedMemory> = {}): void {
    insertSeedMemory(db, { id, content: `${id} 본문`, createdAt: isoDaysAgo(daysAgo), ...overrides });
  }

  function candidate(oldId: string, newId: string, verdict = 'confirmed'): string {
    const read = (id: string) =>
      db
        .prepare('SELECT content, owner_id, project_id, privacy_scope, type FROM memory_item WHERE id = ?')
        .get(id) as { content: string; owner_id: string | null; project_id: string | null; privacy_scope: string; type: string };
    const old = read(oldId);
    const next = read(newId);
    const id = randomUUID();
    db.prepare(
      `INSERT INTO memory_supersede_candidate (
         id, old_memory_id, new_memory_id, owner_id, project_id, privacy_scope, memory_type, verdict,
         rationale, evidence_quote, old_content_sha256, new_content_sha256, provider, model,
         prompt_version, input_hash, llm_logical_request_id, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '근거', NULL, ?, ?, 'gemini', 'm', 'v', ?, NULL, ?)`,
    ).run(
      id,
      oldId,
      newId,
      next.owner_id,
      next.project_id,
      next.privacy_scope,
      next.type,
      verdict,
      sha256(old.content),
      sha256(next.content),
      id,
      new Date().toISOString(),
    );
    return id;
  }

  const approve = (candidateId: string) => applySupersedeCandidate(db, { candidateId, actor: 'operator' });

  function pointer(id: string): string | null {
    return (db.prepare('SELECT superseded_by FROM memory_item WHERE id = ?').get(id) as { superseded_by: string | null })
      .superseded_by;
  }

  function events(): EventRow[] {
    return db
      .prepare(
        'SELECT action, old_memory_id, new_memory_id, candidate_id, actor, reason FROM memory_supersede_event ORDER BY rowid',
      )
      .all() as EventRow[];
  }

  const superseded = (...ids: string[]) => [...findSupersededMemoryIds(db, ids)].sort();

  it('A→B→C keeps each pointer direct and leaves only C current', () => {
    memory('A', 30);
    memory('B', 20);
    memory('C', 10);

    expect(approve(candidate('A', 'B'))).toMatchObject({ kind: 'applied' });
    expect(approve(candidate('B', 'C'))).toMatchObject({ kind: 'applied' });

    expect([pointer('A'), pointer('B'), pointer('C')]).toEqual(['B', 'C', null]);
    expect(superseded('A', 'B', 'C')).toEqual(['A', 'B']);
    expect(events().map((e) => [e.action, e.old_memory_id, e.new_memory_id, e.actor])).toEqual([
      ['applied', 'A', 'B', 'operator'],
      ['applied', 'B', 'C', 'operator'],
    ]);

    db.prepare("UPDATE memory_item SET is_deleted = 1 WHERE id = 'B'").run();
    expect(superseded('A', 'C')).toEqual([]);
  });

  it('competing A→B and A→C: the second approval loses the CAS and writes nothing', () => {
    memory('A', 30);
    memory('B', 20);
    memory('C', 10);
    const toB = candidate('A', 'B');
    const toC = candidate('A', 'C');

    expect(approve(toB)).toMatchObject({ kind: 'applied' });
    expect(approve(toC)).toEqual({ kind: 'rejected', reason: 'already_superseded' });

    expect(pointer('A')).toBe('B');
    expect(events()).toHaveLength(1);
  });

  it('re-approving the applied candidate is a no-op', () => {
    memory('A', 30);
    memory('B', 20);
    const toB = candidate('A', 'B');

    expect(approve(toB)).toMatchObject({ kind: 'applied' });
    expect(approve(toB)).toEqual({ kind: 'already_applied' });
    expect(events()).toHaveLength(1);
  });

  it('rejects approvals that would close a cycle, directly or through a chain', () => {
    memory('A', 30);
    memory('B', 20);
    memory('C', 10);
    expect(approve(candidate('A', 'B'))).toMatchObject({ kind: 'applied' });
    expect(approve(candidate('B', 'A'))).toEqual({ kind: 'rejected', reason: 'cycle' });

    expect(approve(candidate('B', 'C'))).toMatchObject({ kind: 'applied' });
    expect(approve(candidate('C', 'A'))).toEqual({ kind: 'rejected', reason: 'cycle' });

    expect([pointer('A'), pointer('B'), pointer('C')]).toEqual(['B', 'C', null]);
    expect(events()).toHaveLength(2);
  });

  it('rejects a candidate whose old or new content changed after judgment', () => {
    memory('A', 30);
    memory('B', 20);
    memory('C', 10);
    memory('D', 5);
    const editedOld = candidate('A', 'B');
    const editedNew = candidate('C', 'D');
    db.prepare("UPDATE memory_item SET content = 'A 수정' WHERE id = 'A'").run();
    db.prepare("UPDATE memory_item SET content = 'D 수정' WHERE id = 'D'").run();

    expect(approve(editedOld)).toEqual({ kind: 'rejected', reason: 'input_changed' });
    expect(approve(editedNew)).toEqual({ kind: 'rejected', reason: 'input_changed' });
    expect([pointer('A'), pointer('C')]).toEqual([null, null]);
    expect(events()).toHaveLength(0);
  });

  it.each([
    ['owner_id', "'other-owner'"],
    ['project_id', "'other-project'"],
    ['privacy_scope', "'team'"],
    ['type', "'episodic'"],
  ])('rejects a scope violation when %s differs', (column, value) => {
    memory('A', 30, { ownerId: 'owner', projectId: 'project' });
    memory('B', 20, { ownerId: 'owner', projectId: 'project' });
    const id = candidate('A', 'B');
    db.prepare(`UPDATE memory_item SET ${column} = ${value} WHERE id = 'B'`).run();

    expect(approve(id)).toEqual({ kind: 'rejected', reason: 'scope_mismatch' });
    expect(pointer('A')).toBeNull();
  });

  it('applies only confirmed or pending verdicts', () => {
    memory('A', 30);
    memory('B', 20);
    memory('C', 10);
    memory('D', 5);

    expect(approve(candidate('A', 'B', 'compatible'))).toEqual({
      kind: 'rejected',
      reason: 'verdict_not_applicable',
    });
    expect(approve(candidate('C', 'D', 'pending'))).toMatchObject({ kind: 'applied' });
    expect(approve(randomUUID())).toEqual({ kind: 'rejected', reason: 'candidate_not_found' });
  });

  it('rejects approval when either memory is already deleted', () => {
    memory('A', 30);
    memory('B', 20);
    memory('C', 10);
    memory('D', 5);
    const deletedTarget = candidate('A', 'B');
    const deletedOld = candidate('C', 'D');
    db.prepare("UPDATE memory_item SET is_deleted = 1 WHERE id IN ('B', 'C')").run();

    expect(approve(deletedTarget)).toEqual({ kind: 'rejected', reason: 'memory_deleted' });
    expect(approve(deletedOld)).toEqual({ kind: 'rejected', reason: 'memory_deleted' });
    expect(events()).toHaveLength(0);
  });

  it('deleting the target makes the old memory current again without writing to it', () => {
    memory('A', 30);
    memory('B', 20);
    memory('C', 10);
    memory('D', 5);
    expect(approve(candidate('A', 'B'))).toMatchObject({ kind: 'applied' });
    expect(approve(candidate('C', 'D'))).toMatchObject({ kind: 'applied' });

    db.prepare("UPDATE memory_item SET is_deleted = 1, deleted_at = '2026-11-01' WHERE id = 'B'").run();
    db.prepare("DELETE FROM memory_item WHERE id = 'D'").run();

    expect(superseded('A', 'C')).toEqual([]);
    expect([pointer('A'), pointer('C')]).toEqual(['B', 'D']);
    expect(events()).toHaveLength(2);
  });

  it('a dangling pointer blocks a new approval until it is restored', () => {
    memory('A', 30);
    memory('B', 20);
    memory('C', 10);
    expect(approve(candidate('A', 'B'))).toMatchObject({ kind: 'applied' });
    const toC = candidate('A', 'C');
    db.prepare("DELETE FROM memory_item WHERE id = 'B'").run();

    expect(approve(toC)).toEqual({ kind: 'rejected', reason: 'already_superseded' });
    expect(
      restoreSupersededMemory(db, { oldMemoryId: 'A', expectedNewMemoryId: 'B', actor: 'operator', reason: 'target removed' }),
    ).toMatchObject({ kind: 'restored' });
    expect(approve(toC)).toMatchObject({ kind: 'applied' });
    expect(pointer('A')).toBe('C');
  });

  it('explicit restore clears the pointer with an audit event and refuses a stale target', () => {
    memory('A', 30);
    memory('B', 20);
    memory('C', 10);
    const toB = candidate('A', 'B');
    expect(approve(toB)).toMatchObject({ kind: 'applied' });

    expect(
      restoreSupersededMemory(db, { oldMemoryId: 'A', expectedNewMemoryId: 'C', actor: 'operator', reason: null }),
    ).toEqual({ kind: 'rejected', reason: 'pointer_changed' });
    expect(pointer('A')).toBe('B');

    expect(
      restoreSupersededMemory(db, { oldMemoryId: 'A', expectedNewMemoryId: 'B', actor: 'reviewer', reason: '잘못된 승인' }),
    ).toMatchObject({ kind: 'restored' });
    expect(pointer('A')).toBeNull();
    expect(superseded('A')).toEqual([]);
    expect(
      restoreSupersededMemory(db, { oldMemoryId: 'A', expectedNewMemoryId: 'B', actor: 'reviewer', reason: null }),
    ).toEqual({ kind: 'rejected', reason: 'not_superseded' });
    expect(
      restoreSupersededMemory(db, { oldMemoryId: 'missing', expectedNewMemoryId: 'B', actor: 'reviewer', reason: null }),
    ).toEqual({ kind: 'rejected', reason: 'memory_not_found' });

    expect(events()).toEqual([
      { action: 'applied', old_memory_id: 'A', new_memory_id: 'B', candidate_id: toB, actor: 'operator', reason: null },
      { action: 'restored', old_memory_id: 'A', new_memory_id: 'B', candidate_id: null, actor: 'reviewer', reason: '잘못된 승인' },
    ]);
  });

  it('relation and link edits never change validity', () => {
    memory('A', 30);
    memory('B', 20);
    memory('C', 10);
    const relate = (source: string, target: string) => {
      db.prepare("INSERT INTO memory_relation (source_id, target_id, relation_type) VALUES (?, ?, 'supersedes')").run(source, target);
      db.prepare("INSERT INTO memory_link (source_id, target_id, relation_type) VALUES (?, ?, 'supersedes')").run(source, target);
    };

    relate('C', 'A');
    expect(superseded('A', 'B', 'C')).toEqual([]);

    expect(approve(candidate('A', 'B'))).toMatchObject({ kind: 'applied' });
    db.prepare('DELETE FROM memory_relation').run();
    db.prepare('DELETE FROM memory_link').run();
    relate('A', 'B');
    expect(superseded('A', 'B', 'C')).toEqual(['A']);
    expect(pointer('A')).toBe('B');
  });

  it('pointer and audit event commit together or not at all', () => {
    memory('A', 30);
    memory('B', 20);
    const toB = candidate('A', 'B');
    db.exec('DROP TABLE memory_supersede_event');

    expect(() => approve(toB)).toThrow();
    expect(pointer('A')).toBeNull();
  });

  it('the candidate scan stops pairing an old memory once it is superseded', async () => {
    insertSeedMemory(db, { id: 'A', content: 'A 본문', createdAt: isoDaysAgo(3) });
    insertSeedMemory(db, { id: 'B', content: 'B 본문', createdAt: isoDaysAgo(2) });
    insertSeedMemory(db, { id: 'C', content: 'C 본문', createdAt: isoDaysAgo(1) });
    expect(approve(candidate('A', 'B'))).toMatchObject({ kind: 'applied' });

    const port = fakeChatPort(() => judgeReply('pending'));
    const service = new SupersedeCandidateService({ db, port, model: 'm' });
    await service.scan({ runId: 'r1' });

    const pairs = db
      .prepare("SELECT old_memory_id || '>' || new_memory_id AS pair FROM memory_supersede_candidate WHERE input_hash <> id")
      .all() as Array<{ pair: string }>;
    expect(pairs.map((p) => p.pair).sort()).toEqual(['B>C']);
  });
});
