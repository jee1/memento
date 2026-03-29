/**
 * Migration: 026 — Flip extracted_from / supported_by edge directions for legacy DBs
 * Version: 26.0
 *
 * Prior builds stored:
 *   extracted_from: episodic → semantic
 *   supported_by: semantic → episodic
 * Current model (data-model.md): semantic → episodic (extracted_from), episodic → semantic (supported_by).
 * This migration swaps source/target only for rows that still match the old orientation.
 *
 * UNIQUE(source_id, target_id, relation_type): if the post-swap tuple already exists (correct row
 * inserted by newer code), swapping the legacy row would violate UNIQUE — those legacy rows are
 * deleted first. Ops: after migrate, optional `SELECT COUNT` sanity check; duplicates should be rare.
 */

import type Database from 'better-sqlite3';
import type { Migration } from '../types.js';

export class FlipConsolidationRelationDirectionsMigration implements Migration {
  version = '26.0';
  name = 'flip-consolidation-relation-directions';
  description =
    'Swap memory_relation endpoints for legacy extracted_from / supported_by rows after direction fix';

  async validateBefore(_db: Database.Database): Promise<void> {}

  async validateAfter(_db: Database.Database): Promise<void> {}

  async up(db: Database.Database): Promise<void> {
    const table = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='memory_relation'`)
      .get() as { name: string } | undefined;
    if (!table) {
      return;
    }

    db.exec(`
      DELETE FROM memory_relation
      WHERE id IN (
        SELECT mr.id FROM memory_relation mr
        INNER JOIN memory_relation o ON o.relation_type = 'extracted_from'
          AND o.source_id = mr.target_id AND o.target_id = mr.source_id AND o.id <> mr.id
        WHERE mr.relation_type = 'extracted_from'
          AND EXISTS (
            SELECT 1 FROM memory_item s WHERE s.id = mr.source_id AND s.type = 'episodic'
          )
          AND EXISTS (
            SELECT 1 FROM memory_item t WHERE t.id = mr.target_id AND t.type = 'semantic'
          )
      );

      DELETE FROM memory_relation
      WHERE id IN (
        SELECT mr.id FROM memory_relation mr
        INNER JOIN memory_relation o ON o.relation_type = 'supported_by'
          AND o.source_id = mr.target_id AND o.target_id = mr.source_id AND o.id <> mr.id
        WHERE mr.relation_type = 'supported_by'
          AND EXISTS (
            SELECT 1 FROM memory_item s WHERE s.id = mr.source_id AND s.type = 'semantic'
          )
          AND EXISTS (
            SELECT 1 FROM memory_item t WHERE t.id = mr.target_id AND t.type = 'episodic'
          )
      );

      UPDATE memory_relation AS mr
      SET source_id = mr.target_id,
          target_id = mr.source_id
      WHERE mr.relation_type = 'extracted_from'
        AND EXISTS (
          SELECT 1 FROM memory_item s WHERE s.id = mr.source_id AND s.type = 'episodic'
        )
        AND EXISTS (
          SELECT 1 FROM memory_item t WHERE t.id = mr.target_id AND t.type = 'semantic'
        );

      UPDATE memory_relation AS mr
      SET source_id = mr.target_id,
          target_id = mr.source_id
      WHERE mr.relation_type = 'supported_by'
        AND EXISTS (
          SELECT 1 FROM memory_item s WHERE s.id = mr.source_id AND s.type = 'semantic'
        )
        AND EXISTS (
          SELECT 1 FROM memory_item t WHERE t.id = mr.target_id AND t.type = 'episodic'
        );
    `);
  }

  async down(db: Database.Database): Promise<void> {
    // 방향 복원은 마이그레이션 이후 삽입된 올바른 행과 구분할 수 없어 데이터 롤백은 수행하지 않음.
    const ver = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='memento_schema_version'`)
      .get();
    if (ver) {
      db.prepare('DELETE FROM memento_schema_version WHERE version = ?').run('26.0');
    }
  }
}

export default FlipConsolidationRelationDirectionsMigration;
