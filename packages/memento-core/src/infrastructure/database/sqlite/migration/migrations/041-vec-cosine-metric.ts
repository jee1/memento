/**
 * Migration: 041 - vec0 cosine distance metric
 *
 * 왜 필요한가? (issue #713)
 * - 기존 DB의 vec 테이블은 `vec0(embedding float[N])`로 만들어져 metric이 sqlite-vec 기본값인 L2였다.
 * - 검색 mapper는 `1 - distance`를 cosine similarity로 해석하고 slot threshold(0.8/0.6/0.4)도
 *   cosine similarity를 가정하므로, L2 거리(범위 무제한)에서는 threshold를 통과하는 결과가 사실상 없었다.
 * - 이 마이그레이션은 대상 vec 테이블을 `distance_metric=cosine`으로 재생성하고,
 *   memory_embedding에서 재적재한 뒤 insert/update/delete 트리거를 다시 만든다.
 *
 * 신규 DB는 schema.sql이 이미 cosine으로 만들기 때문에 이 마이그레이션은 baseline으로 기록만 된다.
 */

import type Database from 'better-sqlite3';
import { logger } from '../../../../../shared/utils/logger.js';
import {
  VEC_TABLES,
  VEC_TRIGGER_NAMES,
  checkVecCardinality,
  hasCosineDistanceMetric,
  listExistingVecTables,
  reconcileVecDistanceMetric,
  recreateVecTriggers
} from '../../vec-schema.js';
import type { Migration } from '../types.js';

function tableExists(db: Database.Database, table: string): boolean {
  return Boolean(
    db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table)
  );
}

function triggerExists(db: Database.Database, trigger: string): boolean {
  return Boolean(
    db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'trigger' AND name = ?").get(trigger)
  );
}

function getTableSql(db: Database.Database, table: string): string | undefined {
  return (
    db.prepare('SELECT sql FROM sqlite_master WHERE name = ?').get(table) as
      | { sql?: string }
      | undefined
  )?.sql;
}

export class VecCosineMetricMigration implements Migration {
  version = '41.0';
  name = 'vec-cosine-metric';
  description = 'Recreate sqlite-vec tables with distance_metric=cosine and reload vec triggers';

  async validateBefore(db: Database.Database): Promise<void> {
    if (!tableExists(db, 'memory_embedding')) {
      throw new Error('memory_embedding table does not exist. Cannot proceed with migration.');
    }
  }

  async up(db: Database.Database): Promise<void> {
    // 테이블을 DROP하는 동안 트리거가 사라진 테이블을 참조하지 않도록 먼저 제거한다.
    for (const triggerName of VEC_TRIGGER_NAMES) {
      db.exec(`DROP TRIGGER IF EXISTS ${triggerName}`);
    }

    const recreated = reconcileVecDistanceMetric(db);
    if (recreated.length > 0) {
      logger.info('🧭 vec 테이블을 cosine metric으로 재생성했습니다', { tables: recreated });
    }

    const existingTables = listExistingVecTables(db);
    if (existingTables.length === 0) {
      logger.warn('⚠️  vec 테이블이 없습니다 (sqlite-vec 확장 미설치). 트리거 생성을 건너뜁니다.');
      return;
    }

    recreateVecTriggers(db, existingTables);

    const mismatched = checkVecCardinality(db).filter(row => !row.matched);
    if (mismatched.length > 0) {
      logger.warn('⚠️  vec 인덱스 cardinality 불일치 (native 필터 기준)', { mismatched });
    }
  }

  async down(db: Database.Database): Promise<void> {
    for (const triggerName of VEC_TRIGGER_NAMES) {
      db.exec(`DROP TRIGGER IF EXISTS ${triggerName}`);
    }

    const restored = VEC_TABLES.filter(table => tableExists(db, table.name));
    for (const table of restored) {
      db.exec(`DROP TABLE IF EXISTS ${table.name}`);
      db.exec(
        `CREATE VIRTUAL TABLE IF NOT EXISTS ${table.name} USING vec0(embedding float[${table.dimension}])`
      );
      db.exec(
        `INSERT OR IGNORE INTO ${table.name}(rowid, embedding) ` +
          `SELECT id, embedding FROM memory_embedding WHERE ${table.filter}`
      );
    }

    if (restored.length > 0) {
      recreateVecTriggers(db, restored);
    }

    if (tableExists(db, 'memento_schema_version')) {
      db.prepare('DELETE FROM memento_schema_version WHERE version = ?').run(this.version);
    }
  }

  async validateAfter(db: Database.Database): Promise<void> {
    const existingTables = listExistingVecTables(db);
    if (existingTables.length === 0) {
      return;
    }

    for (const table of existingTables) {
      if (!hasCosineDistanceMetric(getTableSql(db, table.name))) {
        throw new Error(`${table.name} was not recreated with distance_metric=cosine`);
      }
    }

    for (const triggerName of VEC_TRIGGER_NAMES) {
      if (!triggerExists(db, triggerName)) {
        throw new Error(`${triggerName} trigger was not recreated`);
      }
    }
  }
}

export default VecCosineMetricMigration;
