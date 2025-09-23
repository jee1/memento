import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sqlite3 from 'sqlite3';
import { DatabaseUtils } from './database.js';

let db: sqlite3.Database;

beforeEach(async () => {
  db = new sqlite3.Database(':memory:');
  await DatabaseUtils.run(
    db,
    `CREATE TABLE test_items (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL
    )`
  );
});

afterEach(async () => {
  await new Promise<void>((resolve, reject) => {
    db.close((err) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
});

describe('DatabaseUtils.runTransaction', () => {
  it('성공한 트랜잭션은 커밋되어 데이터를 저장한다', async () => {
    const result = await DatabaseUtils.runTransaction(db, async () => {
      await DatabaseUtils.run(db, 'INSERT INTO test_items (id, content) VALUES (?, ?)', [
        'item_success',
        '첫 번째 항목'
      ]);

      return DatabaseUtils.get(db, 'SELECT id, content FROM test_items WHERE id = ?', ['item_success']);
    });

    expect(result).toEqual({ id: 'item_success', content: '첫 번째 항목' });

    const rows = await DatabaseUtils.all(db, 'SELECT id FROM test_items');
    expect(rows).toHaveLength(1);
  });

  it('SQLITE_BUSY 오류가 발생하면 지정된 횟수까지 재시도한다', async () => {
    let attempts = 0;

    const result = await DatabaseUtils.runTransaction(db, async () => {
      attempts += 1;
      if (attempts < 3) {
        const error: NodeJS.ErrnoException = new Error('busy');
        error.code = 'SQLITE_BUSY';
        throw error;
      }

      await DatabaseUtils.run(db, 'INSERT INTO test_items (id, content) VALUES (?, ?)', [
        'item_retry',
        '재시도 후 성공'
      ]);

      return attempts;
    }, 5);

    expect(attempts).toBe(3);
    expect(result).toBe(3);

    const stored = await DatabaseUtils.get(db, 'SELECT id, content FROM test_items WHERE id = ?', ['item_retry']);
    expect(stored).toEqual({ id: 'item_retry', content: '재시도 후 성공' });
  });

  it('SQLITE_BUSY가 아닌 오류는 즉시 전파한다', async () => {
    const fatalError = new Error('fatal transaction error');

    await expect(
      DatabaseUtils.runTransaction(db, async () => {
        throw fatalError;
      })
    ).rejects.toBe(fatalError);

    const rows = await DatabaseUtils.all(db, 'SELECT id FROM test_items');
    expect(rows).toHaveLength(0);
  });
});
