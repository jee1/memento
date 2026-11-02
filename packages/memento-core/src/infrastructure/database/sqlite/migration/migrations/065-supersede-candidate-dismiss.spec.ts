import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { MemorySupersedeCandidateMigration } from './059-memory-supersede-candidate.js';
import { MemorySupersedePointerMigration } from './060-memory-supersede-pointer.js';
import { SupersedeCandidateDismissMigration } from './065-supersede-candidate-dismiss.js';

function seededDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE memory_item (id TEXT PRIMARY KEY);
           INSERT INTO memory_item (id) VALUES ('old'), ('new');`);
  return db;
}

describe('065-supersede-candidate-dismiss', () => {
  it('adds dismissed_at and extends audit actions', async () => {
    const db = seededDb();
    await new MemorySupersedeCandidateMigration().up(db);
    await new MemorySupersedePointerMigration().up(db);
    const migration = new SupersedeCandidateDismissMigration();
    await migration.up(db);
    await migration.validateAfter(db);

    db.prepare(
      `INSERT INTO memory_supersede_candidate (
         id, old_memory_id, new_memory_id, owner_id, project_id, privacy_scope, memory_type, verdict,
         rationale, evidence_quote, old_content_sha256, new_content_sha256, provider, model,
         prompt_version, input_hash, llm_logical_request_id, created_at, dismissed_at
       ) VALUES ('c1', 'old', 'new', NULL, NULL, 'private', 'semantic', 'confirmed', 'r', NULL,
                 'a', 'b', 'gemini', 'm', 'v', 'h1', NULL, '2026-11-01T00:00:00.000Z', '2026-11-02T00:00:00.000Z')`,
    ).run();

    db.prepare(
      `INSERT INTO memory_supersede_event (
         id, action, old_memory_id, new_memory_id, candidate_id, actor, reason,
         old_content_sha256, new_content_sha256, created_at
       ) VALUES ('e1', 'dismissed', 'old', 'new', 'c1', 'op', NULL, 'a', 'b', '2026-11-02T00:00:00.000Z')`,
    ).run();

    expect(
      db.prepare(`SELECT dismissed_at FROM memory_supersede_candidate WHERE id = 'c1'`).get(),
    ).toEqual({ dismissed_at: '2026-11-02T00:00:00.000Z' });
    db.close();
  });

  it('down keeps dismissed audit events', async () => {
    const db = seededDb();
    await new MemorySupersedeCandidateMigration().up(db);
    await new MemorySupersedePointerMigration().up(db);
    const migration = new SupersedeCandidateDismissMigration();
    await migration.up(db);

    db.prepare(
      `INSERT INTO memory_supersede_event (
         id, action, old_memory_id, new_memory_id, candidate_id, actor, reason,
         old_content_sha256, new_content_sha256, created_at
       ) VALUES ('e-dismiss', 'dismissed', 'old', 'new', NULL, 'op', 'no', 'a', 'b', '2026-11-02T00:00:00.000Z')`,
    ).run();

    await migration.down(db);

    expect(
      db.prepare(`SELECT COUNT(*) AS c FROM memory_supersede_event WHERE action = 'dismissed'`).get(),
    ).toEqual({ c: 1 });
    db.close();
  });
});
