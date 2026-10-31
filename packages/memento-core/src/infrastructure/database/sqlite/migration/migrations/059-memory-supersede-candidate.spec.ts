import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MemorySupersedeCandidateMigration } from './059-memory-supersede-candidate.js';

const schemaSql = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'schema.sql'),
  'utf8',
);

function candidateRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'c1',
    old_memory_id: 'old',
    new_memory_id: 'new',
    owner_id: null,
    project_id: null,
    privacy_scope: 'private',
    memory_type: 'semantic',
    verdict: 'pending',
    rationale: '근거',
    evidence_quote: null,
    old_content_sha256: 'a',
    new_content_sha256: 'b',
    provider: 'gemini',
    model: 'm',
    prompt_version: 'v',
    input_hash: 'h1',
    llm_logical_request_id: null,
    created_at: '2026-11-01T00:00:00.000Z',
    ...overrides,
  };
}

function insert(db: Database.Database, row: Record<string, unknown>): void {
  const cols = Object.keys(row);
  db.prepare(
    `INSERT INTO memory_supersede_candidate (${cols.join(', ')}) VALUES (${cols.map((c) => `@${c}`).join(', ')})`,
  ).run(row);
}

function seededDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE memory_item (id TEXT PRIMARY KEY);
           INSERT INTO memory_item (id) VALUES ('old'), ('new');`);
  return db;
}

describe('059-memory-supersede-candidate', () => {
  it('후보 테이블을 만들고 input_hash 유일성과 verdict CHECK 를 강제한다', async () => {
    const db = seededDb();
    const migration = new MemorySupersedeCandidateMigration();
    await migration.up(db);
    await migration.validateAfter(db);

    insert(db, candidateRow());
    expect(() => insert(db, candidateRow({ id: 'c2' }))).toThrow(/UNIQUE/);
    expect(() => insert(db, candidateRow({ id: 'c3', input_hash: 'h3', verdict: 'applied' }))).toThrow(/CHECK/);
    db.close();
  });

  it('기억이 지워지면 후보 행도 함께 지워진다', async () => {
    const db = seededDb();
    await new MemorySupersedeCandidateMigration().up(db);
    insert(db, candidateRow());
    db.prepare(`DELETE FROM memory_item WHERE id = 'new'`).run();
    expect(db.prepare('SELECT COUNT(*) AS n FROM memory_supersede_candidate').get()).toEqual({ n: 0 });
    db.close();
  });

  it('schema.sql 과 열, 인덱스가 일치한다', async () => {
    const fromMigration = seededDb();
    await new MemorySupersedeCandidateMigration().up(fromMigration);

    const fromSchema = seededDb();
    const statements = schemaSql.match(
      /CREATE (?:UNIQUE )?(?:TABLE|INDEX) IF NOT EXISTS (?:memory_supersede_candidate|idx_memory_supersede_candidate_\w+)[\s\S]*?;/g,
    );
    expect(statements).not.toBeNull();
    fromSchema.exec(statements!.join('\n'));

    const shape = (db: Database.Database) => ({
      columns: db.prepare('PRAGMA table_info(memory_supersede_candidate)').all(),
      foreignKeys: db.prepare('PRAGMA foreign_key_list(memory_supersede_candidate)').all(),
      indexes: (db.prepare(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='memory_supersede_candidate' AND name NOT LIKE 'sqlite_autoindex%' ORDER BY name`).all()),
    });
    expect(shape(fromSchema)).toEqual(shape(fromMigration));
    expect(shape(fromMigration).indexes).toHaveLength(2);
    fromMigration.close();
    fromSchema.close();
  });

  it('down 은 테이블과 버전 행을 지운다', async () => {
    const db = seededDb();
    db.exec(`CREATE TABLE memento_schema_version (version TEXT PRIMARY KEY);
             INSERT INTO memento_schema_version (version) VALUES ('59.0');`);
    const migration = new MemorySupersedeCandidateMigration();
    await migration.up(db);
    await migration.down(db);
    expect(db.prepare(`SELECT name FROM sqlite_master WHERE name = 'memory_supersede_candidate'`).get()).toBeUndefined();
    expect(db.prepare('SELECT COUNT(*) AS n FROM memento_schema_version').get()).toEqual({ n: 0 });
    db.close();
  });
});
