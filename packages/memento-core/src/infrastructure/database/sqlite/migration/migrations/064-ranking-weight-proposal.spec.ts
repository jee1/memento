import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { RankingWeightProposalMigration } from './064-ranking-weight-proposal.js';

const schemaSql = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'schema.sql'),
  'utf8',
);

function insertProposal(db: Database.Database, id = 'p1'): void {
  db.prepare(
    `INSERT INTO ranking_weight_proposal (id, actor, reason, current_json, proposed_json, patch, created_at)
     VALUES (?, 'session:abc', '사유', '{}', '{}', 'diff', '2026-11-01T00:00:00.000Z')`,
  ).run(id);
}

const shape = (db: Database.Database) => ({
  columns: db.prepare('PRAGMA table_info(ranking_weight_proposal)').all(),
  indexes: db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type='index' AND tbl_name = 'ranking_weight_proposal' AND name NOT LIKE 'sqlite_autoindex%' ORDER BY name`,
    )
    .all(),
  triggers: db
    .prepare(`SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name = 'ranking_weight_proposal' ORDER BY name`)
    .all(),
});

describe('064-ranking-weight-proposal', () => {
  it('is idempotent', async () => {
    const db = new Database(':memory:');
    const migration = new RankingWeightProposalMigration();
    await migration.up(db);
    await migration.up(db);
    await migration.validateAfter(db);
    db.close();
  });

  it('fills preview_json and previewed_at once and refuses every other change', async () => {
    const db = new Database(':memory:');
    await new RankingWeightProposalMigration().up(db);
    insertProposal(db);

    expect(() => db.prepare("UPDATE ranking_weight_proposal SET reason = '바꿈'").run()).toThrow(/append-only/);
    expect(() => db.prepare("UPDATE ranking_weight_proposal SET patch = 'x', preview_json = '{}', previewed_at = 't'").run()).toThrow(/append-only/);
    expect(() => db.prepare("UPDATE ranking_weight_proposal SET preview_json = '{}'").run()).toThrow(/append-only/);

    db.prepare("UPDATE ranking_weight_proposal SET preview_json = '{\"a\":1}', previewed_at = '2026-11-01T01:00:00.000Z'").run();
    expect(() => db.prepare("UPDATE ranking_weight_proposal SET preview_json = '{\"a\":2}', previewed_at = 't2'").run()).toThrow(/append-only/);
    expect(db.prepare('SELECT preview_json FROM ranking_weight_proposal').get()).toEqual({ preview_json: '{"a":1}' });
    db.close();
  });

  it('refuses DELETE', async () => {
    const db = new Database(':memory:');
    await new RankingWeightProposalMigration().up(db);
    insertProposal(db);
    expect(() => db.prepare('DELETE FROM ranking_weight_proposal').run()).toThrow(/append-only/);
    expect(db.prepare('SELECT COUNT(*) AS n FROM ranking_weight_proposal').get()).toEqual({ n: 1 });
    db.close();
  });

  it('matches schema.sql columns, indexes and triggers', async () => {
    const fromMigration = new Database(':memory:');
    await new RankingWeightProposalMigration().up(fromMigration);
    const fromSchema = new Database(':memory:');
    const statements = schemaSql.match(
      /CREATE (?:TABLE|INDEX) IF NOT EXISTS (?:ranking_weight_proposal\b|idx_ranking_weight_proposal_\w+)[\s\S]*?;|CREATE TRIGGER IF NOT EXISTS ranking_weight_proposal_\w+[\s\S]*?END;/g,
    );
    expect(statements).toHaveLength(4);
    fromSchema.exec(statements!.join('\n'));
    expect(shape(fromSchema)).toEqual(shape(fromMigration));
    fromMigration.close();
    fromSchema.close();
  });

  it('down drops the table and the version row', async () => {
    const db = new Database(':memory:');
    db.exec(`CREATE TABLE memento_schema_version (version TEXT PRIMARY KEY);
             INSERT INTO memento_schema_version (version) VALUES ('64.0');`);
    const migration = new RankingWeightProposalMigration();
    await migration.up(db);
    await migration.down(db);
    expect(db.prepare(`SELECT name FROM sqlite_master WHERE name LIKE 'ranking_weight_proposal%'`).all()).toEqual([]);
    expect(db.prepare('SELECT COUNT(*) AS n FROM memento_schema_version').get()).toEqual({ n: 0 });
    db.close();
  });
});
