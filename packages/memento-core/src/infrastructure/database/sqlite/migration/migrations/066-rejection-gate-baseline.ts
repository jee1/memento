/**
 * Migration: 066 — rejection gate baseline (#1681)
 * Version: 66.0
 *
 * 기각 게이트 임계값을 잰 조건의 append-only 기록이다. 활성 기준은 MAX(id) 행이고,
 * 참조 분포를 채우는 일도 UPDATE 가 아니라 값을 복사한 새 행을 덧붙인다.
 * 시드는 기존 DB 에만 들어간다(신규 DB 는 schema.sql 로 만들어 빈 테이블로 시작한다).
 * 시드 참조 창은 측정일(10/18) 뒤 첫 주가 아니라 ISO 45 다. 10/25 부터 지침 훅 질의가 운영 트래픽을 바꿔
 * 그 전 주는 지금의 트래픽을 대표하지 못한다(설계 변경 b).
 */

import type Database from 'better-sqlite3';
import type { Migration } from '../types.js';

export class RejectionGateBaselineMigration implements Migration {
  version = '66.0';
  name = 'rejection-gate-baseline';
  description = 'Append-only rejection gate baseline with the 0.40 measurement seeds (#1681)';

  async validateBefore(_db: Database.Database): Promise<void> {}

  async up(db: Database.Database): Promise<void> {
    db.exec(`
      CREATE TABLE IF NOT EXISTS rejection_gate_baseline (
        id                       INTEGER PRIMARY KEY AUTOINCREMENT,
        threshold                REAL    NOT NULL CHECK (threshold >= 0 AND threshold <= 1),
        n_items                  INTEGER NOT NULL CHECK (n_items >= 0),
        measured_at              TEXT    NOT NULL,
        judge_model              TEXT    NOT NULL,
        label_set_id             TEXT,
        source                   TEXT    NOT NULL CHECK (source IN ('measurement', 'setting_change', 'startup', 'reference_fill')),
        reference_window_start   TEXT,
        reference_window_end     TEXT,
        reference_decided_n      INTEGER,
        reference_rejection_rate REAL,
        reference_knee_mass      REAL,
        captured_at              TEXT    NOT NULL,
        CHECK (
          (reference_window_start IS NULL AND reference_window_end IS NULL AND reference_decided_n IS NULL
            AND reference_rejection_rate IS NULL AND reference_knee_mass IS NULL)
          OR (reference_window_start IS NOT NULL AND reference_window_end IS NOT NULL AND reference_decided_n IS NOT NULL
            AND reference_rejection_rate IS NOT NULL AND reference_knee_mass IS NOT NULL)
        )
      );
      CREATE TRIGGER IF NOT EXISTS rejection_gate_baseline_prevent_update
      BEFORE UPDATE ON rejection_gate_baseline
      BEGIN
        SELECT RAISE(ABORT, 'rejection_gate_baseline is append-only');
      END;
      CREATE TRIGGER IF NOT EXISTS rejection_gate_baseline_prevent_delete
      BEFORE DELETE ON rejection_gate_baseline
      BEGIN
        SELECT RAISE(ABORT, 'rejection_gate_baseline is append-only');
      END;
    `);

    const seed = db.prepare(
      `INSERT OR IGNORE INTO rejection_gate_baseline
         (id, threshold, n_items, measured_at, judge_model, label_set_id, source,
          reference_window_start, reference_window_end, reference_decided_n,
          reference_rejection_rate, reference_knee_mass, captured_at)
       VALUES (?, 0.4, 11121, ?, 'jev-latest', '#1387 라벨 팩', 'measurement',
               '2026-11-02T00:00:00.000Z', '2026-11-09T00:00:00.000Z', 621, ?, ?, ?)`,
    );
    const capturedAt = new Date().toISOString();
    seed.run(1, '2026-10-18T00:00:00.000Z', 313 / 621, 75 / 621, capturedAt);
    seed.run(2, '2026-11-09T00:00:00.000Z', 313 / 621, 75 / 621, capturedAt);
  }

  async down(db: Database.Database): Promise<void> {
    db.exec('DROP TABLE IF EXISTS rejection_gate_baseline;');
    const ver = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='memento_schema_version'`)
      .get();
    if (ver) {
      db.prepare('DELETE FROM memento_schema_version WHERE version = ?').run(this.version);
    }
  }

  async validateAfter(db: Database.Database): Promise<void> {
    if (!db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='rejection_gate_baseline'`).get()) {
      throw new Error('Migration 066 did not create rejection_gate_baseline');
    }
    const triggers = db
      .prepare(`SELECT COUNT(*) AS n FROM sqlite_master WHERE type='trigger' AND tbl_name='rejection_gate_baseline'`)
      .get() as { n: number };
    if (triggers.n !== 2) {
      throw new Error('Migration 066 did not create the append-only triggers');
    }
  }
}

export default RejectionGateBaselineMigration;
