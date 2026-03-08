/**
 * SQLite Core Memory Adapter 테스트
 * TDD: RED-GREEN-REFACTOR
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { SqliteCoreMemoryAdapter } from '../sqlite-core-memory-adapter.js';
import type { CoreMemoryDatabaseConnection } from '../../../../domains/memory/repositories/core-memory-database.interface.js';

describe('SqliteCoreMemoryAdapter', () => {
  let db: Database.Database;
  let adapter: CoreMemoryDatabaseConnection;

  beforeEach(() => {
    // Given: better-sqlite3 Database 객체가 주어졌을 때
    db = new Database(':memory:');
    adapter = new SqliteCoreMemoryAdapter(db);
  });

  describe('생성자 및 인터페이스 구현', () => {
    it('should implement CoreMemoryDatabaseConnection interface', () => {
      // When: SqliteCoreMemoryAdapter를 생성하고
      // Then: CoreMemoryDatabaseConnection 인터페이스를 구현하는지 테스트
      expect(adapter).toBeDefined();
      expect(typeof adapter.prepare).toBe('function');
      expect(typeof adapter.exec).toBe('function');
      expect(typeof adapter.close).toBe('function');
      expect(typeof adapter.isOpen).toBe('function');
    });
  });

  describe('prepare', () => {
    it('should return Promise<CoreMemoryPreparedStatement>', async () => {
      // Given: 어댑터가 준비되었을 때
      // When: prepare(sql)을 호출하면
      const stmt = await adapter.prepare('SELECT 1');
      
      // Then: Promise<CoreMemoryPreparedStatement>를 반환하는지 테스트
      expect(stmt).toBeDefined();
      expect(typeof stmt.all).toBe('function');
      expect(typeof stmt.get).toBe('function');
      expect(typeof stmt.run).toBe('function');
    });
  });

  describe('exec', () => {
    it('should return Promise<void>', async () => {
      // Given: 어댑터가 준비되었을 때
      // When: exec(sql)을 호출하면
      const result = await adapter.exec('CREATE TABLE test (id INTEGER)');
      
      // Then: Promise<void>를 반환하는지 테스트
      expect(result).toBeUndefined();
    });
  });

  describe('isOpen', () => {
    it('should return Promise<boolean>', async () => {
      // Given: 어댑터가 준비되었을 때
      // When: isOpen()을 호출하면
      const result = await adapter.isOpen();
      
      // Then: Promise<boolean>을 반환하는지 테스트
      expect(typeof result).toBe('boolean');
      expect(result).toBe(true);
    });
  });

  describe('PreparedStatement.all', () => {
    it('should return Promise<any[]>', async () => {
      // Given: PreparedStatement가 준비되었을 때
      await adapter.exec('CREATE TABLE test (id INTEGER, name TEXT)');
      await adapter.exec("INSERT INTO test (id, name) VALUES (1, 'test1'), (2, 'test2')");
      
      const stmt = await adapter.prepare('SELECT * FROM test');
      
      // When: all(...params)를 호출하면
      const result = await stmt.all();
      
      // Then: Promise<any[]>를 반환하는지 테스트
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(2);
    });
  });

  describe('PreparedStatement.get', () => {
    it('should return Promise<any>', async () => {
      // Given: PreparedStatement가 준비되었을 때
      await adapter.exec('CREATE TABLE test (id INTEGER, name TEXT)');
      await adapter.exec("INSERT INTO test (id, name) VALUES (1, 'test1')");
      
      const stmt = await adapter.prepare('SELECT * FROM test WHERE id = ?');
      
      // When: get(...params)를 호출하면
      const result = await stmt.get(1);
      
      // Then: Promise<any>를 반환하는지 테스트
      expect(result).toBeDefined();
      expect(result).toHaveProperty('id', 1);
    });
  });

  describe('PreparedStatement.run', () => {
    it('should return Promise<{ changes: number; lastInsertRowid: number }>', async () => {
      // Given: PreparedStatement가 준비되었을 때
      await adapter.exec('CREATE TABLE test (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT)');
      
      const stmt = await adapter.prepare('INSERT INTO test (name) VALUES (?)');
      
      // When: run(...params)를 호출하면
      const result = await stmt.run('test');
      
      // Then: Promise<{ changes: number; lastInsertRowid: number }>를 반환하는지 테스트
      expect(result).toHaveProperty('changes');
      expect(result).toHaveProperty('lastInsertRowid');
      expect(typeof result.changes).toBe('number');
      expect(typeof result.lastInsertRowid).toBe('number');
      expect(result.changes).toBe(1);
    });
  });

  describe('에러 처리', () => {
    it('should reject Promise when SQL error occurs', async () => {
      // Given: SQL 에러가 발생했을 때
      // When: 어댑터 메서드를 호출하면
      // Then: Promise.reject()로 에러를 전달하는지 테스트
      await expect(adapter.exec('INVALID SQL')).rejects.toThrow();
    });

    it('should reject Promise when prepare fails', async () => {
      // Given: 잘못된 SQL이 주어졌을 때
      // When: prepare를 호출하면
      // Then: Promise.reject()로 에러를 전달하는지 테스트
      await expect(adapter.prepare('INVALID SQL')).rejects.toThrow();
    });
  });

  describe('close', () => {
    it('should close database connection', async () => {
      // Given: 어댑터가 준비되었을 때
      // When: close()를 호출하면
      await adapter.close();
      
      // Then: 연결이 닫혔는지 확인
      const isOpen = await adapter.isOpen();
      expect(isOpen).toBe(false);
    });
  });
});

