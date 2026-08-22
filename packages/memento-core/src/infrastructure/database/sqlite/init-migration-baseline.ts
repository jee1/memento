import type Database from 'better-sqlite3';
import { MigrationDetector } from './migration/migration-detector.js';
import { SchemaVersionManager } from './migration/schema-version-manager.js';

export const BASELINE_FROM_SCHEMA_SQL_CHECKSUM = 'bundled-schema-sql';

/**
 * 신규 DB에 schema.sql만 적용한 경우, 증분 마이그레이션 목록과 memento_schema_version을 맞춘다.
 * 그렇지 않으면 다음 기동 시 pending 마이그레이션이 중복 실행된다.
 */
export async function recordBundledSchemaSqlMigrationBaseline(db: Database.Database): Promise<void> {
  const detector = new MigrationDetector();
  const all = await detector.detectAllMigrations();
  if (all.length === 0) {
    throw new Error(
      '[memento] 마이그레이션 모듈을 로드할 수 없습니다. 빌드 산출물에 migration 스크립트가 포함됐는지 확인하세요.'
    );
  }
  const versionManager = new SchemaVersionManager(db);
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const { migration } of all) {
      await versionManager.recordVersion({
        version: migration.version,
        appliedAt: new Date(),
        migrationName: migration.name,
        checksum: BASELINE_FROM_SCHEMA_SQL_CHECKSUM,
        appliedBy: 'system',
        description: migration.description
          ? `${migration.description} (baseline: schema.sql)`
          : 'Baseline: full schema applied via bundled schema.sql (fresh DB)',
      });
    }
    db.exec('COMMIT');
  } catch (e) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // ignore rollback failure
    }
    throw e;
  }
}
