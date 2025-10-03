import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createBatchScheduler, BatchScheduler } from '../services/batch-scheduler.js';
import Database from 'better-sqlite3';

describe('BatchScheduler (Simple)', () => {
  let db: Database.Database;
  let batchScheduler: BatchScheduler;

  beforeEach(() => {
    // Create in-memory database for testing
    db = new Database(':memory:');
    // Initialize database schema
    db.exec(`
      CREATE TABLE memory_item (
        id TEXT PRIMARY KEY,
        type TEXT CHECK (type IN ('working','episodic','semantic','procedural')),
        content TEXT NOT NULL,
        importance REAL CHECK (importance >= 0 AND importance <= 1) DEFAULT 0.5,
        privacy_scope TEXT CHECK (privacy_scope IN ('private','team','public')) DEFAULT 'private',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_accessed TIMESTAMP,
        pinned BOOLEAN DEFAULT FALSE,
        source TEXT,
        agent_id TEXT,
        user_id TEXT,
        project_id TEXT,
        origin_trace TEXT
      );
    `);
    
    batchScheduler = createBatchScheduler({
      cleanupInterval: 1000, // 1초 for testing
      monitoringInterval: 500, // 0.5초 for testing
      enableLogging: false
    });
  });

  afterEach(() => {
    if (db) {
      db.close();
    }
    batchScheduler.stop();
  });

  describe('초기화', () => {
    it('should initialize successfully', async () => {
      await expect(batchScheduler.start(db)).resolves.not.toThrow();
    });

    it('should not start if already running', async () => {
      await batchScheduler.start(db);
      await expect(batchScheduler.start(db)).rejects.toThrow('BatchScheduler is already running');
    });
  });

  describe('상태 관리', () => {
    it('should return correct status when not running', () => {
      const status = batchScheduler.getStatus();
      expect(status.isRunning).toBe(false);
      expect(status.activeJobs).toEqual([]);
    });

    it('should return correct status when running', async () => {
      await batchScheduler.start(db);
      const status = batchScheduler.getStatus();
      expect(status.isRunning).toBe(true);
      expect(status.activeJobs).toContain('cleanup');
      expect(status.activeJobs).toContain('monitoring');
    });
  });

  describe('작업 실행', () => {
    beforeEach(async () => {
      await batchScheduler.start(db);
    });

    it('should run cleanup job successfully', async () => {
      const result = await batchScheduler.runJob('cleanup');
      expect(result.jobType).toBe('memory_cleanup');
      expect(result.success).toBe(true);
    });

    it('should run monitoring job successfully', async () => {
      const result = await batchScheduler.runJob('monitoring');
      expect(result.jobType).toBe('monitoring');
      expect(result.success).toBe(true);
    });

    it('should handle unknown job type', async () => {
      await expect(batchScheduler.runJob('unknown' as any)).rejects.toThrow('Unknown job type: unknown');
    });
  });

  describe('중지', () => {
    it('should stop all jobs', async () => {
      await batchScheduler.start(db);
      batchScheduler.stop();
      
      const status = batchScheduler.getStatus();
      expect(status.isRunning).toBe(false);
      expect(status.activeJobs).toEqual([]);
    });
  });

  describe('데이터베이스 통계', () => {
    beforeEach(async () => {
      await batchScheduler.start(db);
      
      // Add some test data
      db.prepare(`
        INSERT INTO memory_item (id, type, content, importance, created_at)
        VALUES ('test1', 'episodic', 'Test memory 1', 0.5, datetime('now'))
      `).run();
    });

    it('should collect database statistics', async () => {
      const result = await batchScheduler.runJob('monitoring');
      expect(result.success).toBe(true);
      expect(result.details?.stats).toBeDefined();
    });
  });
});
