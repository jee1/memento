/**
 * Migration: 064 — ranking weight proposal (#1584)
 * Version: 64.0
 *
 * 제안 한 건이 한 행이다. 행은 만든 뒤 고치지 않는다. 미리보기 결과(preview_json, previewed_at)만
 * 한 번 채울 수 있고, 그 밖의 UPDATE 와 모든 DELETE 는 트리거가 막는다.
 */

import type Database from 'better-sqlite3';
import type { Migration } from '../types.js';

export class RankingWeightProposalMigration implements Migration {
  version = '64.0';
  name = 'ranking-weight-proposal';
  description = 'Append-only ranking weight proposals with a once-fillable preview result (#1584)';

  async validateBefore(_db: Database.Database): Promise<void> {}

  async up(db: Database.Database): Promise<void> {
    db.exec(`
      CREATE TABLE IF NOT EXISTS ranking_weight_proposal (
        id            TEXT PRIMARY KEY,
        actor         TEXT NOT NULL,
        reason        TEXT NOT NULL,
        current_json  TEXT NOT NULL,
        proposed_json TEXT NOT NULL,
        patch         TEXT NOT NULL,
        preview_json  TEXT,
        previewed_at  TEXT,
        created_at    TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_ranking_weight_proposal_created
        ON ranking_weight_proposal(created_at);
      CREATE TRIGGER IF NOT EXISTS ranking_weight_proposal_guard_update
      BEFORE UPDATE ON ranking_weight_proposal
      WHEN OLD.preview_json IS NOT NULL OR OLD.previewed_at IS NOT NULL
        OR NEW.preview_json IS NULL OR NEW.previewed_at IS NULL
        OR NEW.id IS NOT OLD.id OR NEW.actor IS NOT OLD.actor OR NEW.reason IS NOT OLD.reason
        OR NEW.current_json IS NOT OLD.current_json OR NEW.proposed_json IS NOT OLD.proposed_json
        OR NEW.patch IS NOT OLD.patch OR NEW.created_at IS NOT OLD.created_at
      BEGIN
        SELECT RAISE(ABORT, 'ranking_weight_proposal is append-only');
      END;
      CREATE TRIGGER IF NOT EXISTS ranking_weight_proposal_prevent_delete
      BEFORE DELETE ON ranking_weight_proposal
      BEGIN
        SELECT RAISE(ABORT, 'ranking_weight_proposal is append-only');
      END;
    `);
  }

  async down(db: Database.Database): Promise<void> {
    db.exec('DROP TABLE IF EXISTS ranking_weight_proposal;');
    const ver = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='memento_schema_version'`)
      .get();
    if (ver) {
      db.prepare('DELETE FROM memento_schema_version WHERE version = ?').run(this.version);
    }
  }

  async validateAfter(db: Database.Database): Promise<void> {
    if (!db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='ranking_weight_proposal'`).get()) {
      throw new Error('Migration 064 did not create ranking_weight_proposal');
    }
    const triggers = db
      .prepare(`SELECT COUNT(*) AS n FROM sqlite_master WHERE type='trigger' AND tbl_name='ranking_weight_proposal'`)
      .get() as { n: number };
    if (triggers.n !== 2) {
      throw new Error('Migration 064 did not create the append-only triggers');
    }
  }
}

export default RankingWeightProposalMigration;
