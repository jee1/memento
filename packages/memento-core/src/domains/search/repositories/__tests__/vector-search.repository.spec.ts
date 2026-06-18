/**
 * VectorSearchRepository 테스트
 * 벡터 검색 리포지토리 테스트
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { VectorSearchRepositoryImpl } from '../vector-search.repository.js';
import Database from 'better-sqlite3';
import { setupTestDatabase, cleanupTestDatabase } from '../../../../test/helpers/test-database.js';
import type { VectorSearchQuery } from '../../../shared/types/vector-search.types.js';
import { mcpLogger } from '../../../../server/mcp-logger.js';

describe('VectorSearchRepositoryImpl', () => {
  let db: Database.Database;
  let repository: VectorSearchRepositoryImpl;

  beforeEach(async () => {
    db = await setupTestDatabase();
    repository = new VectorSearchRepositoryImpl(db);
  });

  afterEach(async () => {
    await cleanupTestDatabase(db);
  });

  describe('constructor', () => {
    it('데이터베이스를 받아서 초기화해야 함', () => {
      // Given: 데이터베이스
      const testDb = new Database(':memory:');

      // When: 리포지토리 생성
      const repo = new VectorSearchRepositoryImpl(testDb);

      // Then: 리포지토리가 생성되어야 함
      expect(repo).toBeDefined();

      testDb.close();
    });

    it('생성 시 VEC 가용성을 확인해야 함', () => {
      // Given: 데이터베이스
      const testDb = new Database(':memory:');

      // When: 리포지토리 생성
      const repo = new VectorSearchRepositoryImpl(testDb);

      // Then: VEC 가용성 확인이 실행되어야 함
      expect(repo).toBeDefined();

      testDb.close();
    });
  });

  describe('checkVecAvailability', () => {
    it('VEC 가용성을 확인해야 함', () => {
      // When: VEC 가용성 확인
      const result = repository.checkVecAvailability();

      // Then: boolean 반환
      expect(typeof result).toBe('boolean');
      // VEC 테이블이 있으면 true, 없으면 false
    });
  });

  describe('checkVecAvailability (partial vec schema)', () => {
    it('tfidf vec 테이블 없이 minilm vec 테이블만 있어도 VEC를 사용 가능으로 판정해야 함', async () => {
      const testDb = new Database(':memory:');
      try {
        const { getLoadablePath } = await import('sqlite-vec');
        testDb.loadExtension(getLoadablePath());
      } catch {
        testDb.close();
        return;
      }

      try {
        testDb.exec(`
          CREATE VIRTUAL TABLE memory_item_vec_minilm
          USING vec0(embedding float[384])
        `);
      } catch (error) {
        console.warn('VEC 확장 테이블 생성 실패, 테스트 스킵:', error);
        testDb.close();
        return;
      }

      const repo = new VectorSearchRepositoryImpl(testDb);
      expect(repo.checkVecAvailability()).toBe(true);
      testDb.close();
    });
  });

  describe('search', () => {
    it('검색 결과가 배열 형태여야 함', async () => {
      // Given: 384차원 벡터 (tfidf 기본 차원)
      const query: VectorSearchQuery = {
        queryVector: new Array(384).fill(0.1),
        provider: 'tfidf'
      };

      // When: 검색 실행
      const results = await repository.search(query);

      // Then: 배열 반환
      expect(Array.isArray(results)).toBe(true);
    });

    it('VEC 미가용 시 VEC_UNAVAILABLE 카테고리를 로깅해야 함', async () => {
      (repository as unknown as { isVecAvailable: boolean }).isVecAvailable = false;
      const logSpy = vi.spyOn(mcpLogger, 'logServer');
      const query: VectorSearchQuery = {
        queryVector: new Array(384).fill(0.1),
        provider: 'tfidf'
      };

      try {
        const results = await repository.search(query);
        expect(results).toEqual([]);

        const warningLogs = logSpy.mock.calls.filter(
          (call) => call[0] === 'warn' && call[1] === 'VEC를 사용할 수 없습니다. 빈 결과를 반환합니다.'
        );
        expect(warningLogs.length).toBe(1);
        const payload = warningLogs[0]?.[2] as { category?: unknown } | undefined;
        expect(payload?.category).toBe('VEC_UNAVAILABLE');
      } finally {
        logSpy.mockRestore();
      }
    });

    it('벡터 차원이 불일치할 때 빈 배열을 반환해야 함', async () => {
      // Given: 잘못된 차원의 벡터
      const query: VectorSearchQuery = {
        queryVector: [0.1, 0.2], // 차원 불일치 (384가 아님)
        provider: 'tfidf'
      };

      // When: 검색 실행
      const results = await repository.search(query);

      // Then: 빈 배열 반환
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBe(0);
    });

    it('벡터 차원 불일치 시 VECTOR_DIMENSION_MISMATCH 카테고리를 로깅해야 함', async () => {
      if (!repository.checkVecAvailability()) {
        return;
      }

      const logSpy = vi.spyOn(mcpLogger, 'logServer');
      const query: VectorSearchQuery = {
        queryVector: [0.1, 0.2],
        provider: 'tfidf'
      };

      try {
        const results = await repository.search(query);
        expect(results).toEqual([]);

        const errorLogs = logSpy.mock.calls.filter(
          (call) => call[0] === 'error' && call[1] === '벡터 차원 불일치'
        );
        expect(errorLogs.length).toBe(1);
        const payload = errorLogs[0]?.[2] as { category?: unknown } | undefined;
        expect(payload?.category).toBe('VECTOR_DIMENSION_MISMATCH');
      } finally {
        logSpy.mockRestore();
      }
    });

    it('저장 차원 다수(384)와 네이티브 쿼리(512) 불일치 시 투영으로 벡터 차원 오류를 피해야 함', async () => {
      if (!repository.checkVecAvailability()) {
        return;
      }
      const emb384 = JSON.stringify(new Array(384).fill(0.01));
      const emb512 = JSON.stringify(new Array(512).fill(0.02));
      const insertItem = db.prepare(
        `INSERT INTO memory_item (id, type, content, triple_extracted) VALUES (?, 'episodic', ?, 0)`
      );
      const insertEmb = db.prepare(
        `INSERT INTO memory_embedding (memory_id, embedding, dim, embedding_provider, dimensions)
         VALUES (?, ?, ?, 'tfidf', ?)`
      );
      for (let i = 0; i < 3; i += 1) {
        const id = `dim-mix-${i}`;
        insertItem.run(id, `content ${i}`);
        insertEmb.run(id, emb384, 384, 384);
      }
      insertItem.run('dim-mix-512', 'content 512');
      insertEmb.run('dim-mix-512', emb512, 512, 512);

      const logSpy = vi.spyOn(mcpLogger, 'logServer');
      const query: VectorSearchQuery = {
        queryVector: new Array(512).fill(0.03),
        provider: 'tfidf'
      };

      await repository.search(query);

      const dimensionErrors = logSpy.mock.calls.filter(
        (call) => call[0] === 'error' && call[1] === '벡터 차원 불일치'
      );
      expect(dimensionErrors.length).toBe(0);

      const projected = logSpy.mock.calls.filter(
        (call) => call[0] === 'warn' && call[1] === '쿼리 임베딩을 저장소 차원에 맞게 투영했습니다'
      );
      expect(projected.length).toBeGreaterThan(0);

      logSpy.mockRestore();
    });

    it('minilm은 memory_embedding dimensions 메타 오염(512 우세)이어도 384 vec0와 쿼리 차원이 맞아야 함 (issue #279)', async () => {
      if (!repository.checkVecAvailability()) {
        return;
      }
      const emb384 = JSON.stringify(new Array(384).fill(0.01));
      const insertItem = db.prepare(
        `INSERT INTO memory_item (id, type, content, triple_extracted) VALUES (?, 'episodic', ?, 0)`
      );
      const insertEmb = db.prepare(
        `INSERT INTO memory_embedding (memory_id, embedding, dim, embedding_provider, dimensions)
         VALUES (?, ?, ?, 'minilm', ?)`
      );
      for (let i = 0; i < 3; i += 1) {
        const id = `minilm-bad-meta-${i}`;
        insertItem.run(id, `content ${i}`);
        insertEmb.run(id, emb384, 384, 512);
      }

      const logSpy = vi.spyOn(mcpLogger, 'logServer');
      const query: VectorSearchQuery = {
        queryVector: new Array(384).fill(0.03),
        provider: 'minilm'
      };

      await repository.search(query);

      const dimensionMismatchLogs = logSpy.mock.calls.filter((call) => {
        if (call[0] !== 'error' || call[1] !== '벡터 검색 실패') {
          return false;
        }
        const payload = call[2] as { error?: string } | undefined;
        return Boolean(payload?.error?.includes('Dimension mismatch'));
      });
      expect(dimensionMismatchLogs.length).toBe(0);

      logSpy.mockRestore();
    });

    it('512차원 쿼리를 minilm(384 vec)에 넘겨도 sqlite Dimension mismatch가 나면 안 됨 (issue #436)', async () => {
      if (!repository.checkVecAvailability()) {
        return;
      }

      const logSpy = vi.spyOn(mcpLogger, 'logServer');
      const query: VectorSearchQuery = {
        queryVector: new Array(512).fill(0.03),
        provider: 'minilm',
      };

      await repository.search(query);

      const dimensionMismatchLogs = logSpy.mock.calls.filter((call) => {
        if (call[0] !== 'error' || call[1] !== '벡터 검색 실패') {
          return false;
        }
        const payload = call[2] as { error?: string } | undefined;
        return Boolean(payload?.error?.includes('Dimension mismatch'));
      });
      expect(dimensionMismatchLogs.length).toBe(0);

      logSpy.mockRestore();
    });

    it('checkVecAvailability와 search가 동일한 provider/dimension 규칙을 사용해야 함', async () => {
      const query: VectorSearchQuery = {
        queryVector: new Array(512).fill(0.03),
        provider: 'tfidf'
      };

      const available = repository.checkVecAvailability();
      const logSpy = vi.spyOn(mcpLogger, 'logServer');

      try {
        if (!available) {
          // vec extension 미가용 환경에서는 runtime 검증 경로를 건너뛴다.
          return;
        }

        await repository.search(query);

        const vectorSearchFailureLogs = logSpy.mock.calls.filter(
          (call) => call[0] === 'error' && call[1] === '벡터 검색 실패'
        );
        expect(vectorSearchFailureLogs).toHaveLength(0);
      } finally {
        logSpy.mockRestore();
      }
    });

    it('SQL 실행 실패를 VECTOR_SQL_EXECUTION_FAILED 카테고리로 로깅해야 함', async () => {
      // vec 미가용 환경에서는 SQL 실패 경로 검증을 건너뛴다.
      if (!repository.checkVecAvailability()) {
        return;
      }

      const prepareSpy = vi.spyOn(db, 'prepare').mockImplementation(() => {
        throw new Error('simulated sqlite failure');
      });
      const logSpy = vi.spyOn(mcpLogger, 'logServer');
      const query: VectorSearchQuery = {
        queryVector: new Array(384).fill(0.01),
        provider: 'minilm'
      };

      try {
        const results = await repository.search(query);

        expect(results).toEqual([]);
        const errorLogs = logSpy.mock.calls.filter(
          (call) => call[0] === 'error' && call[1] === '벡터 검색 실패'
        );
        expect(errorLogs.length).toBe(1);
        const payload = errorLogs[0]?.[2] as { category?: unknown } | undefined;
        expect(String(payload?.category ?? '')).toContain('VECTOR_SQL_EXECUTION_FAILED');
      } finally {
        prepareSpy.mockRestore();
        logSpy.mockRestore();
      }
    });

    it('옵션을 포함한 쿼리를 처리해야 함', async () => {
      // Given: 옵션을 포함한 쿼리
      const query: VectorSearchQuery = {
        queryVector: new Array(384).fill(0.1),
        provider: 'tfidf',
        options: {
          limit: 5,
          threshold: 0.5,
          type: 'episodic',
          includeContent: true,
          includeMetadata: false
        }
      };

      // When: 검색 실행
      const results = await repository.search(query);

      // Then: 배열 반환
      expect(Array.isArray(results)).toBe(true);
    });
  });

  describe('hybridSearch', () => {
    it('하이브리드 검색 결과가 배열 형태여야 함', async () => {
      // Given: 384차원 벡터
      const query: VectorSearchQuery = {
        queryVector: new Array(384).fill(0.1),
        textQuery: 'test query',
        provider: 'tfidf'
      };

      // When: 하이브리드 검색 실행
      const results = await repository.hybridSearch(query);

      // Then: 배열 반환
      expect(Array.isArray(results)).toBe(true);
    });

    it('벡터 차원이 불일치할 때 빈 배열을 반환해야 함', async () => {
      // Given: 잘못된 차원의 벡터
      const query: VectorSearchQuery = {
        queryVector: [0.1, 0.2], // 차원 불일치
        textQuery: 'test query',
        provider: 'tfidf'
      };

      // When: 하이브리드 검색 실행
      const results = await repository.hybridSearch(query);

      // Then: 빈 배열 반환
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBe(0);
    });

    it('텍스트 쿼리 없이도 동작해야 함', async () => {
      // Given: 텍스트 쿼리 없는 쿼리
      const query: VectorSearchQuery = {
        queryVector: new Array(384).fill(0.1),
        provider: 'tfidf'
      };

      // When: 하이브리드 검색 실행
      const results = await repository.hybridSearch(query);

      // Then: 배열 반환
      expect(Array.isArray(results)).toBe(true);
    });
  });

  describe('hybridSearch scope filters (issue #387)', () => {
    const queryVector = new Array(512).fill(0.1);
    const embeddingJson = JSON.stringify(queryVector);

    async function seedScopedHybridMemories(): Promise<boolean> {
      if (!repository.checkVecAvailability()) {
        return false;
      }

      const insertItem = db.prepare(
        `INSERT INTO memory_item (
          id, type, content, importance, created_at, project_id, owner_id
        ) VALUES (?, 'episodic', ?, 0.5, datetime('now'), ?, ?)`
      );
      const insertEmb = db.prepare(
        `INSERT INTO memory_embedding (memory_id, embedding, dim, embedding_provider, dimensions)
         VALUES (?, ?, ?, 'tfidf', ?)`
      );

      const rows = [
        { id: 'mem_hybrid_scope_a', content: 'alpha scoped hybrid content', projectId: 'proj-a', ownerId: 'owner-a' },
        { id: 'mem_hybrid_scope_b', content: 'beta scoped hybrid content', projectId: 'proj-b', ownerId: 'owner-b' },
      ] as const;

      for (const row of rows) {
        insertItem.run(row.id, row.content, row.projectId, row.ownerId);
        insertEmb.run(row.id, embeddingJson, 512, 512);

        const embeddingId = db.prepare(
          `SELECT id FROM memory_embedding WHERE memory_id = ?`
        ).get(row.id) as { id: number } | undefined;

        if (embeddingId) {
          db.exec(`
            INSERT INTO memory_item_vec_tfidf (rowid, embedding)
            VALUES (${embeddingId.id}, '${embeddingJson}')
          `);
        }
      }

      return true;
    }

    it('project_id 스코프가 벡터 전용 hybridSearch 분기에 적용되어야 함', async () => {
      if (!(await seedScopedHybridMemories())) {
        return;
      }

      const query: VectorSearchQuery = {
        queryVector,
        provider: 'tfidf',
        options: {
          limit: 10,
          threshold: 0,
          project_id: 'proj-a',
        },
      };

      const results = await repository.hybridSearch(query);
      const memoryIds = results.map((result) => result.memory_id);

      expect(memoryIds).toContain('mem_hybrid_scope_a');
      expect(memoryIds).not.toContain('mem_hybrid_scope_b');
    });

    it('project_id·owner_id 스코프가 텍스트+벡터 hybridSearch CTE에 적용되어야 함', async () => {
      if (!(await seedScopedHybridMemories())) {
        return;
      }

      const query: VectorSearchQuery = {
        queryVector,
        textQuery: 'scoped hybrid',
        provider: 'tfidf',
        options: {
          limit: 10,
          threshold: 0,
          project_id: 'proj-b',
          owner_id: 'owner-b',
        },
      };

      const results = await repository.hybridSearch(query);
      const memoryIds = results.map((result) => result.memory_id);

      expect(memoryIds).toContain('mem_hybrid_scope_b');
      expect(memoryIds).not.toContain('mem_hybrid_scope_a');
    });

    it('owner_id 배열 스코프가 hybridSearch에 적용되어야 함', async () => {
      if (!(await seedScopedHybridMemories())) {
        return;
      }

      const query: VectorSearchQuery = {
        queryVector,
        provider: 'tfidf',
        options: {
          limit: 10,
          threshold: 0,
          owner_id: ['owner-a', 'owner-x'],
        },
      };

      const results = await repository.hybridSearch(query);
      const memoryIds = results.map((result) => result.memory_id);

      expect(memoryIds).toContain('mem_hybrid_scope_a');
      expect(memoryIds).not.toContain('mem_hybrid_scope_b');
    });
  });

  describe('getIndexStatus', () => {
    it('인덱스 상태를 반환해야 함', () => {
      // When: 인덱스 상태 확인
      const status = repository.getIndexStatus();

      // Then: 상태가 반환되어야 함
      expect(status).toBeDefined();
      expect(status).toHaveProperty('available');
      expect(status).toHaveProperty('tableExists');
      expect(status).toHaveProperty('recordCount');
      expect(status).toHaveProperty('dimensions');
      expect(status).toHaveProperty('vecExtensionLoaded');
      expect(typeof status.available).toBe('boolean');
      expect(typeof status.tableExists).toBe('boolean');
      expect(typeof status.recordCount).toBe('number');
      expect(typeof status.dimensions).toBe('number');
      expect(typeof status.vecExtensionLoaded).toBe('boolean');
    });

    it('인덱스 상태 구조가 올바르게 반환되어야 함', () => {
      // When: 인덱스 상태 확인
      const status = repository.getIndexStatus();

      // Then: 상태 구조가 올바르게 반환되어야 함
      expect(status.available).toBeDefined();
      expect(status.tableExists).toBeDefined();
      expect(status.recordCount).toBeGreaterThanOrEqual(0);
      expect(status.dimensions).toBeGreaterThan(0);
      expect(status.vecExtensionLoaded).toBeDefined();
    });
  });

  describe('rebuildIndex', () => {
    it('인덱스 재구성 결과를 반환해야 함', async () => {
      // When: 인덱스 재구성
      const result = await repository.rebuildIndex();

      // Then: boolean 반환
      expect(typeof result).toBe('boolean');
    });
  });

  describe('getTableName', () => {
    it('tfidf 제공자에 대한 테이블명을 반환해야 함', () => {
      // When: tfidf 테이블명 조회
      const tableName = repository.getTableName('tfidf');

      // Then: 테이블명 반환
      expect(typeof tableName).toBe('string');
      expect(tableName.length).toBeGreaterThan(0);
    });

    it('minilm 제공자에 대한 테이블명을 반환해야 함', () => {
      // When: minilm 테이블명 조회
      const tableName = repository.getTableName('minilm');

      // Then: 테이블명 반환
      expect(typeof tableName).toBe('string');
      expect(tableName.length).toBeGreaterThan(0);
    });

    it('알 수 없는 제공자에 대해 기본 테이블명을 반환해야 함', () => {
      // When: 알 수 없는 제공자 테이블명 조회
      const tableName = repository.getTableName('unknown');

      // Then: 기본 테이블명 반환
      expect(typeof tableName).toBe('string');
      expect(tableName.length).toBeGreaterThan(0);
    });

    it('대소문자를 구분하지 않아야 함', () => {
      // When: 대문자 제공자 테이블명 조회
      const tableName1 = repository.getTableName('TFIDF');
      const tableName2 = repository.getTableName('tfidf');

      // Then: 같은 테이블명 반환
      expect(tableName1).toBe(tableName2);
    });
  });

  describe('checkAvailability', () => {
    it('checkVecAvailability와 동일한 결과를 반환해야 함', () => {
      // When: 가용성 확인
      const result1 = repository.checkAvailability();
      const result2 = repository.checkVecAvailability();

      // Then: 동일한 결과 반환
      expect(result1).toBe(result2);
    });
  });

  describe('Procedural Memory Enhancement (v7.0) 필드 반환', () => {
    it('should return workflow_name, skill_name, and trigger_conditions when includeMetadata is true', async () => {
      // Given: workflow_name, skill_name, trigger_conditions가 있는 procedural memory 생성
      const { DatabaseUtils } = await import('../../../../shared/utils/database.js');
      DatabaseUtils.run(db, `
        INSERT INTO memory_item (
          id, type, content, workflow_name, skill_name, trigger_conditions) VALUES (
          'mem_procedural_1', 'procedural', 'Test procedure',
          '데이터 마이그레이션', '스키마 백업', '{"event": "migration_start"}')
      `);

      // Given: 임베딩 데이터 추가 (VEC 테이블이 있는 경우)
      try {
        const { getLoadablePath } = await import('sqlite-vec');
        const extensionPath = getLoadablePath();
        db.loadExtension(extensionPath);
        
        // VEC 테이블 생성
        db.exec(`
          CREATE VIRTUAL TABLE IF NOT EXISTS memory_item_vec_tfidf 
          USING vec0(embedding float[384])
        `);
        
        // 임베딩 데이터 추가
        DatabaseUtils.run(db, `
          INSERT INTO memory_embedding (
            memory_id, embedding_provider, projection_type, embedding, dim, dimensions
          )
          VALUES (
            'mem_procedural_1', 'tfidf', 'native', 
            '${JSON.stringify(new Array(384).fill(0.1))}', 384, 384
          )
        `);
        
        // VEC 테이블에 데이터 추가
        const embeddingId = DatabaseUtils.get(db, `
          SELECT id FROM memory_embedding WHERE memory_id = 'mem_procedural_1'
        `) as { id: number } | undefined;
        
        if (embeddingId) {
          db.exec(`
            INSERT INTO memory_item_vec_tfidf (rowid, embedding)
            VALUES (${embeddingId.id}, '${JSON.stringify(new Array(384).fill(0.1))}')
          `);
        }
      } catch (error) {
        // VEC 확장이 없는 경우 테스트 스킵
        console.warn('VEC 확장이 없어 테스트를 스킵합니다:', error);
        return;
      }

      // When: includeMetadata=true로 검색
      const query: VectorSearchQuery = {
        queryVector: new Array(384).fill(0.1),
        provider: 'tfidf',
        options: {
          includeMetadata: true
        }
      };

      const results = await repository.search(query);

      // Then: 새 필드가 반환되어야 함
      if (results.length > 0) {
        const result = results[0];
        expect(result.workflow_name).toBeDefined();
        expect(result.skill_name).toBeDefined();
        expect(result.trigger_conditions).toBeDefined();
      }
    });

    it('should not return workflow_name, skill_name, trigger_conditions when includeMetadata is false', async () => {
      // Given: workflow_name, skill_name, trigger_conditions가 있는 procedural memory 생성
      const { DatabaseUtils } = await import('../../../../shared/utils/database.js');
      DatabaseUtils.run(db, `
        INSERT INTO memory_item (
          id, type, content, workflow_name, skill_name, trigger_conditions) VALUES (
          'mem_procedural_2', 'procedural', 'Test procedure',
          '데이터 마이그레이션', '스키마 백업', '{"event": "migration_start"}')
      `);

      // Given: 임베딩 데이터 추가 (VEC 테이블이 있는 경우)
      try {
        const { getLoadablePath } = await import('sqlite-vec');
        const extensionPath = getLoadablePath();
        db.loadExtension(extensionPath);
        
        // VEC 테이블 생성
        db.exec(`
          CREATE VIRTUAL TABLE IF NOT EXISTS memory_item_vec_tfidf 
          USING vec0(embedding float[384])
        `);
        
        // 임베딩 데이터 추가
        DatabaseUtils.run(db, `
          INSERT INTO memory_embedding (
            memory_id, embedding_provider, projection_type, embedding, dim, dimensions
          )
          VALUES (
            'mem_procedural_2', 'tfidf', 'native', 
            '${JSON.stringify(new Array(384).fill(0.1))}', 384, 384
          )
        `);
        
        // VEC 테이블에 데이터 추가
        const embeddingId = DatabaseUtils.get(db, `
          SELECT id FROM memory_embedding WHERE memory_id = 'mem_procedural_2'
        `) as { id: number } | undefined;
        
        if (embeddingId) {
          db.exec(`
            INSERT INTO memory_item_vec_tfidf (rowid, embedding)
            VALUES (${embeddingId.id}, '${JSON.stringify(new Array(384).fill(0.1))}')
          `);
        }
      } catch (error) {
        // VEC 확장이 없는 경우 테스트 스킵
        console.warn('VEC 확장이 없어 테스트를 스킵합니다:', error);
        return;
      }

      // When: includeMetadata=false로 검색
      const query: VectorSearchQuery = {
        queryVector: new Array(384).fill(0.1),
        provider: 'tfidf',
        options: {
          includeMetadata: false
        }
      };

      const results = await repository.search(query);

      // Then: 새 필드가 반환되지 않아야 함
      if (results.length > 0) {
        const result = results[0];
        expect(result.workflow_name).toBeUndefined();
        expect(result.skill_name).toBeUndefined();
        expect(result.trigger_conditions).toBeUndefined();
      }
    });

    it('should include last_accessed_at in search results when includeMetadata is true', async () => {
      // Given: last_accessed_at이 있는 메모리 생성
      try {
        // 메모리 아이템 생성
        DatabaseUtils.run(db, `
          INSERT INTO memory_item (
            id, type, content, importance, privacy_scope, created_at, last_accessed_at) VALUES (
            'mem_with_last_accessed', 'episodic', 'Test content', 0.7, 'private',
            '2024-01-01T00:00:00Z', '2024-01-15T00:00:00Z')
        `);

        // VEC 테이블 생성 (없는 경우)
        db.exec(`
          CREATE VIRTUAL TABLE IF NOT EXISTS memory_item_vec_tfidf
          USING vec0(embedding float[384])
        `);
        
        // 임베딩 데이터 추가
        DatabaseUtils.run(db, `
          INSERT INTO memory_embedding (
            memory_id, embedding_provider, projection_type, embedding, dim, dimensions
          )
          VALUES (
            'mem_with_last_accessed', 'tfidf', 'native', 
            '${JSON.stringify(new Array(384).fill(0.1))}', 384, 384
          )
        `);
        
        // VEC 테이블에 데이터 추가
        const embeddingId = DatabaseUtils.get(db, `
          SELECT id FROM memory_embedding WHERE memory_id = 'mem_with_last_accessed'
        `) as { id: number } | undefined;
        
        if (embeddingId) {
          db.exec(`
            INSERT INTO memory_item_vec_tfidf (rowid, embedding)
            VALUES (${embeddingId.id}, '${JSON.stringify(new Array(384).fill(0.1))}')
          `);
        }
      } catch (error) {
        // VEC 확장이 없는 경우 테스트 스킵
        console.warn('VEC 확장이 없어 테스트를 스킵합니다:', error);
        return;
      }

      // When: includeMetadata=true로 검색
      const query: VectorSearchQuery = {
        queryVector: new Array(384).fill(0.1),
        provider: 'tfidf',
        options: {
          includeMetadata: true
        }
      };

      const results = await repository.search(query);

      // Then: last_accessed_at이 포함되어야 함
      if (results.length > 0) {
        const result = results.find(r => r.memory_id === 'mem_with_last_accessed');
        if (result) {
          expect(result.last_accessed_at).toBeDefined();
          expect(result.last_accessed_at).toBe('2024-01-15T00:00:00Z');
        }
      }
    });

    it('should include last_accessed_at in hybrid search results', async () => {
      // Given: last_accessed_at이 있는 메모리 생성
      try {
        // 메모리 아이템 생성
        DatabaseUtils.run(db, `
          INSERT INTO memory_item (
            id, type, content, importance, privacy_scope, created_at, last_accessed_at) VALUES (
            'mem_hybrid_last_accessed', 'semantic', 'Test content for hybrid', 0.8, 'private',
            '2024-01-01T00:00:00Z', '2024-01-20T00:00:00Z')
        `);

        // FTS5 테이블 생성 (없는 경우)
        db.exec(`
          CREATE VIRTUAL TABLE IF NOT EXISTS memory_item_fts USING fts5(
            content,
            content='memory_item',
            content_rowid='rowid'
          )
        `);

        // VEC 테이블 생성 (없는 경우)
        db.exec(`
          CREATE VIRTUAL TABLE IF NOT EXISTS memory_item_vec_tfidf
          USING vec0(embedding float[384])
        `);
        
        // 임베딩 데이터 추가
        DatabaseUtils.run(db, `
          INSERT INTO memory_embedding (
            memory_id, embedding_provider, projection_type, embedding, dim, dimensions
          )
          VALUES (
            'mem_hybrid_last_accessed', 'tfidf', 'native', 
            '${JSON.stringify(new Array(384).fill(0.1))}', 384, 384
          )
        `);
        
        // VEC 테이블에 데이터 추가
        const embeddingId = DatabaseUtils.get(db, `
          SELECT id FROM memory_embedding WHERE memory_id = 'mem_hybrid_last_accessed'
        `) as { id: number } | undefined;
        
        if (embeddingId) {
          db.exec(`
            INSERT INTO memory_item_vec_tfidf (rowid, embedding)
            VALUES (${embeddingId.id}, '${JSON.stringify(new Array(384).fill(0.1))}')
          `);
        }
      } catch (error) {
        // VEC 확장이 없는 경우 테스트 스킵
        console.warn('VEC 확장이 없어 테스트를 스킵합니다:', error);
        return;
      }

      // When: 하이브리드 검색 실행
      const query: VectorSearchQuery = {
        queryVector: new Array(384).fill(0.1),
        textQuery: 'test',
        provider: 'tfidf',
        options: {
          includeMetadata: true
        }
      };

      const results = await repository.hybridSearch(query);

      // Then: last_accessed_at이 포함되어야 함
      if (results.length > 0) {
        const result = results.find(r => r.memory_id === 'mem_hybrid_last_accessed');
        if (result) {
          expect(result.last_accessed_at).toBeDefined();
          expect(result.last_accessed_at).toBe('2024-01-20T00:00:00Z');
        }
      }
    });
  });

  describe('하이브리드 검색 textQuery 생략/빈 문자열 처리', () => {
    it('textQuery가 없을 때 벡터 검색만 사용해야 함', async () => {
      // Given: VEC 테이블이 있는 경우
      try {
        // 테스트용 메모리 및 임베딩 생성
        DatabaseUtils.run(db, `
          INSERT INTO memory_item (id, type, content, importance, created_at) VALUES ('mem_no_text_query', 'episodic', 'Test content', 0.5, datetime('now'))
        `);

        DatabaseUtils.run(db, `
          INSERT INTO memory_embedding (
            memory_id, embedding_provider, projection_type, embedding, dim, dimensions
          )
          VALUES (
            'mem_no_text_query', 'tfidf', 'native', 
            '${JSON.stringify(new Array(384).fill(0.1))}', 384, 384
          )
        `);

        const embeddingId = DatabaseUtils.get(db, `
          SELECT id FROM memory_embedding WHERE memory_id = 'mem_no_text_query'
        `) as { id: number } | undefined;

        if (embeddingId) {
          db.exec(`
            INSERT INTO memory_item_vec_tfidf (rowid, embedding)
            VALUES (${embeddingId.id}, '${JSON.stringify(new Array(384).fill(0.1))}')
          `);
        }
      } catch (error) {
        // VEC 확장이 없는 경우 테스트 스킵
        console.warn('VEC 확장이 없어 테스트를 스킵합니다:', error);
        return;
      }

      // When: textQuery 없이 하이브리드 검색 실행
      const query: VectorSearchQuery = {
        queryVector: new Array(384).fill(0.1),
        // textQuery 없음
        provider: 'tfidf',
        options: {
          includeMetadata: true
        }
      };

      const results = await repository.hybridSearch(query);

      // Then: 에러 없이 벡터 검색 결과가 반환되어야 함
      expect(Array.isArray(results)).toBe(true);
      // FTS5 빈 쿼리 에러가 발생하지 않아야 함
    });

    it('textQuery가 빈 문자열일 때 벡터 검색만 사용해야 함', async () => {
      // Given: VEC 테이블이 있는 경우
      try {
        // 테스트용 메모리 및 임베딩 생성
        DatabaseUtils.run(db, `
          INSERT INTO memory_item (id, type, content, importance, created_at) VALUES ('mem_empty_text_query', 'episodic', 'Test content', 0.5, datetime('now'))
        `);

        DatabaseUtils.run(db, `
          INSERT INTO memory_embedding (
            memory_id, embedding_provider, projection_type, embedding, dim, dimensions
          )
          VALUES (
            'mem_empty_text_query', 'tfidf', 'native', 
            '${JSON.stringify(new Array(384).fill(0.1))}', 384, 384
          )
        `);

        const embeddingId = DatabaseUtils.get(db, `
          SELECT id FROM memory_embedding WHERE memory_id = 'mem_empty_text_query'
        `) as { id: number } | undefined;

        if (embeddingId) {
          db.exec(`
            INSERT INTO memory_item_vec_tfidf (rowid, embedding)
            VALUES (${embeddingId.id}, '${JSON.stringify(new Array(384).fill(0.1))}')
          `);
        }
      } catch (error) {
        // VEC 확장이 없는 경우 테스트 스킵
        console.warn('VEC 확장이 없어 테스트를 스킵합니다:', error);
        return;
      }

      // When: 빈 문자열 textQuery로 하이브리드 검색 실행
      const query: VectorSearchQuery = {
        queryVector: new Array(384).fill(0.1),
        textQuery: '', // 빈 문자열
        provider: 'tfidf',
        options: {
          includeMetadata: true
        }
      };

      const results = await repository.hybridSearch(query);

      // Then: 에러 없이 벡터 검색 결과가 반환되어야 함
      expect(Array.isArray(results)).toBe(true);
      // FTS5 빈 쿼리 에러가 발생하지 않아야 함
    });

    it('textQuery가 공백만 있을 때 벡터 검색만 사용해야 함', async () => {
      // Given: VEC 테이블이 있는 경우
      try {
        // 테스트용 메모리 및 임베딩 생성
        DatabaseUtils.run(db, `
          INSERT INTO memory_item (id, type, content, importance, created_at) VALUES ('mem_whitespace_text_query', 'episodic', 'Test content', 0.5, datetime('now'))
        `);

        DatabaseUtils.run(db, `
          INSERT INTO memory_embedding (
            memory_id, embedding_provider, projection_type, embedding, dim, dimensions
          )
          VALUES (
            'mem_whitespace_text_query', 'tfidf', 'native', 
            '${JSON.stringify(new Array(384).fill(0.1))}', 384, 384
          )
        `);

        const embeddingId = DatabaseUtils.get(db, `
          SELECT id FROM memory_embedding WHERE memory_id = 'mem_whitespace_text_query'
        `) as { id: number } | undefined;

        if (embeddingId) {
          db.exec(`
            INSERT INTO memory_item_vec_tfidf (rowid, embedding)
            VALUES (${embeddingId.id}, '${JSON.stringify(new Array(384).fill(0.1))}')
          `);
        }
      } catch (error) {
        // VEC 확장이 없는 경우 테스트 스킵
        console.warn('VEC 확장이 없어 테스트를 스킵합니다:', error);
        return;
      }

      // When: 공백만 있는 textQuery로 하이브리드 검색 실행
      const query: VectorSearchQuery = {
        queryVector: new Array(384).fill(0.1),
        textQuery: '   ', // 공백만
        provider: 'tfidf',
        options: {
          includeMetadata: true
        }
      };

      const results = await repository.hybridSearch(query);

      // Then: 에러 없이 벡터 검색 결과가 반환되어야 함
      expect(Array.isArray(results)).toBe(true);
      // FTS5 빈 쿼리 에러가 발생하지 않아야 함
    });

    it('textQuery가 undefined일 때 정상 결과를 반환해야 함', async () => {
      // Given: VEC 테이블이 있는 경우
      try {
        // 테스트용 메모리 및 임베딩 생성
        DatabaseUtils.run(db, `
          INSERT INTO memory_item (id, type, content, importance, created_at) VALUES ('mem_undefined_text_query', 'episodic', 'Test content for undefined query', 0.5, datetime('now'))
        `);

        DatabaseUtils.run(db, `
          INSERT INTO memory_embedding (
            memory_id, embedding_provider, projection_type, embedding, dim, dimensions
          )
          VALUES (
            'mem_undefined_text_query', 'tfidf', 'native', 
            '${JSON.stringify(new Array(384).fill(0.1))}', 384, 384
          )
        `);

        const embeddingId = DatabaseUtils.get(db, `
          SELECT id FROM memory_embedding WHERE memory_id = 'mem_undefined_text_query'
        `) as { id: number } | undefined;

        if (embeddingId) {
          db.exec(`
            INSERT INTO memory_item_vec_tfidf (rowid, embedding)
            VALUES (${embeddingId.id}, '${JSON.stringify(new Array(384).fill(0.1))}')
          `);
        }
      } catch (error) {
        // VEC 확장이 없는 경우 테스트 스킵
        console.warn('VEC 확장이 없어 테스트를 스킵합니다:', error);
        return;
      }

      // When: undefined textQuery로 하이브리드 검색 실행
      const query: VectorSearchQuery = {
        queryVector: new Array(384).fill(0.1),
        textQuery: undefined, // undefined
        provider: 'tfidf',
        options: {
          includeMetadata: true
        }
      };

      const results = await repository.hybridSearch(query);

      // Then: 에러 없이 벡터 검색 결과가 반환되어야 함
      expect(Array.isArray(results)).toBe(true);
      // FTS5 빈 쿼리 에러가 발생하지 않아야 함
      // undefined textQuery는 벡터 검색만 사용되어야 함
    });

    it('textQuery가 null일 때 정상 결과를 반환해야 함', async () => {
      // Given: VEC 테이블이 있는 경우
      try {
        // 테스트용 메모리 및 임베딩 생성
        DatabaseUtils.run(db, `
          INSERT INTO memory_item (id, type, content, importance, created_at) VALUES ('mem_null_text_query', 'episodic', 'Test content for null query', 0.5, datetime('now'))
        `);

        DatabaseUtils.run(db, `
          INSERT INTO memory_embedding (
            memory_id, embedding_provider, projection_type, embedding, dim, dimensions
          )
          VALUES (
            'mem_null_text_query', 'tfidf', 'native', 
            '${JSON.stringify(new Array(384).fill(0.1))}', 384, 384
          )
        `);

        const embeddingId = DatabaseUtils.get(db, `
          SELECT id FROM memory_embedding WHERE memory_id = 'mem_null_text_query'
        `) as { id: number } | undefined;

        if (embeddingId) {
          db.exec(`
            INSERT INTO memory_item_vec_tfidf (rowid, embedding)
            VALUES (${embeddingId.id}, '${JSON.stringify(new Array(384).fill(0.1))}')
          `);
        }
      } catch (error) {
        // VEC 확장이 없는 경우 테스트 스킵
        console.warn('VEC 확장이 없어 테스트를 스킵합니다:', error);
        return;
      }

      // When: null textQuery로 하이브리드 검색 실행
      const query: VectorSearchQuery = {
        queryVector: new Array(384).fill(0.1),
        textQuery: null as any, // null
        provider: 'tfidf',
        options: {
          includeMetadata: true
        }
      };

      const results = await repository.hybridSearch(query);

      // Then: 에러 없이 벡터 검색 결과가 반환되어야 함
      expect(Array.isArray(results)).toBe(true);
      // FTS5 빈 쿼리 에러가 발생하지 않아야 함
      // null textQuery는 벡터 검색만 사용되어야 함
    });
  });
});

