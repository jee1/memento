import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { DatabaseUtils } from '../../shared/utils/database.js';
import { initializeLegacyFullSchemaBootstrap } from './legacy-full-schema-bootstrap.js';

describe('legacy full-schema bootstrap (#1535)', () => {
  it('데이터베이스를 초기화해야 함', async () => {
    const newDb = new Database(':memory:');
    await initializeLegacyFullSchemaBootstrap(newDb);

    const memoryItemTable = DatabaseUtils.get(newDb, `
        SELECT name FROM sqlite_master WHERE type='table' AND name='memory_item'
      `);
    expect(memoryItemTable).toBeDefined();

    const memoryTagTable = DatabaseUtils.get(newDb, `
        SELECT name FROM sqlite_master WHERE type='table' AND name='memory_tag'
      `);
    expect(memoryTagTable).toBeDefined();

    newDb.close();
  });

  it('기본 테이블들을 생성해야 함', async () => {
    const newDb = new Database(':memory:');
    await initializeLegacyFullSchemaBootstrap(newDb);

    const tables = DatabaseUtils.all(newDb, `
        SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'
      `);
    const tableNames = tables.map((t: { name: string }) => t.name);
    expect(tableNames).toContain('memory_item');
    expect(tableNames).toContain('memory_tag');
    expect(tableNames).toContain('memory_item_tag');

    newDb.close();
  });
});
