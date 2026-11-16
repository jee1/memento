/**
 * Migration: 067 — recall 쓰임 기록 시작 표식 (#1751)
 * Version: 67.0
 *
 * 테이블과 컬럼을 바꾸지 않는다. 이 마이그레이션이 적용된 시각(memento_schema_version.applied_at)이
 * 「memory_injection 이 쓰인 시각을 남기기 시작한 때」다. 망각은 그 전 기간을 쓰이지 않은 기간으로 세지 않는다.
 */

import type Database from 'better-sqlite3';
import type { Migration } from '../types.js';

export class RecallUseRecordingStartMigration implements Migration {
  version = '67.0';
  /** forgetting-policy-service 가 이 이름으로 적용 시각을 읽는다 */
  name = 'recall-use-recording-start';
  description = 'Marker: memory_injection starts recording use in meta_memory_stats (#1751), no schema change';

  async validateBefore(_db: Database.Database): Promise<void> {}

  async up(_db: Database.Database): Promise<void> {}

  async down(db: Database.Database): Promise<void> {
    const ver = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='memento_schema_version'`)
      .get();
    if (ver) {
      db.prepare('DELETE FROM memento_schema_version WHERE version = ?').run(this.version);
    }
  }

  async validateAfter(_db: Database.Database): Promise<void> {}
}
