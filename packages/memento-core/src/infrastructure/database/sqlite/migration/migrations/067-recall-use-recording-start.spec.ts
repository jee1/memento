import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { RecallUseRecordingStartMigration } from './067-recall-use-recording-start.js';

describe('067 recall use recording start', () => {
  it('스키마를 바꾸지 않는다', async () => {
    const db = new Database(':memory:');
    db.exec('CREATE TABLE memento_schema_version (version TEXT PRIMARY KEY, applied_at TIMESTAMP, migration_name TEXT NOT NULL)');
    const before = db.prepare('SELECT type, name, sql FROM sqlite_master ORDER BY name').all();

    await new RecallUseRecordingStartMigration().up(db);

    expect(db.prepare('SELECT type, name, sql FROM sqlite_master ORDER BY name').all()).toEqual(before);
    db.close();
  });

  it('망각 정책이 읽는 이름을 쓰고, down 은 버전 행을 지운다', async () => {
    const migration = new RecallUseRecordingStartMigration();
    expect(migration.name).toBe('recall-use-recording-start');
    const db = new Database(':memory:');
    db.exec('CREATE TABLE memento_schema_version (version TEXT PRIMARY KEY, applied_at TIMESTAMP, migration_name TEXT NOT NULL)');
    db.prepare("INSERT INTO memento_schema_version VALUES ('67.0', CURRENT_TIMESTAMP, 'recall-use-recording-start')").run();

    await migration.down(db);

    expect(db.prepare('SELECT COUNT(*) AS n FROM memento_schema_version').get()).toEqual({ n: 0 });
    db.close();
  });
});
