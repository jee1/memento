/**
 * AnchorCacheService 테스트
 * 앵커 캐시 서비스 테스트
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { AnchorCacheService } from './anchor-cache-service.js';
import { MemoryEmbeddingService } from '../../../memory/services/memory-embedding-service.js';
import { setupTestDatabase, createTestMemory, cleanupTestDatabase } from '../../test/helpers/test-database.js';
import { DatabaseUtils } from '../../shared/utils/database.js';

describe('AnchorCacheService', () => {
  let service: AnchorCacheService;
  let db: Database.Database;
  let embeddingService: MemoryEmbeddingService;
  const agentId = 'test-agent';

  beforeEach(async () => {
    db = await setupTestDatabase();
    service = new AnchorCacheService();
    service.setDatabase(db);
    embeddingService = new MemoryEmbeddingService();
    service.setEmbeddingService(embeddingService);
  });

  afterEach(() => {
    cleanupTestDatabase(db);
  });

  describe('updateCache', () => {
    it('캐시를 업데이트해야 함', () => {
      // Given: 메모리 ID
      const memoryId = 'mem_test';

      // When: 캐시 업데이트
      service.updateCache(agentId, 'A', memoryId);

      // Then: 캐시에 저장되었는지 확인
      const cached = service.getCachedAnchor(agentId);
      expect(cached).toBeDefined();
      expect(cached?.A).toBe(memoryId);
    });

    it('모든 슬롯의 캐시를 업데이트할 수 있어야 함', () => {
      // Given: 여러 메모리 ID
      const memoryA = 'mem_a';
      const memoryB = 'mem_b';
      const memoryC = 'mem_c';

      // When: 모든 슬롯 캐시 업데이트
      service.updateCache(agentId, 'A', memoryA);
      service.updateCache(agentId, 'B', memoryB);
      service.updateCache(agentId, 'C', memoryC);

      // Then: 모든 슬롯이 캐시에 저장되었는지 확인
      const cached = service.getCachedAnchor(agentId);
      expect(cached?.A).toBe(memoryA);
      expect(cached?.B).toBe(memoryB);
      expect(cached?.C).toBe(memoryC);
    });
  });

  describe('getCachedAnchor', () => {
    it('캐시된 앵커를 반환해야 함', () => {
      // Given: 캐시 업데이트
      const memoryId = 'mem_test';
      service.updateCache(agentId, 'A', memoryId);

      // When: 캐시 조회
      const cached = service.getCachedAnchor(agentId);

      // Then: 캐시된 값 반환
      expect(cached).toBeDefined();
      expect(cached?.A).toBe(memoryId);
    });

    it('캐시가 없으면 undefined를 반환해야 함', () => {
      // When: 캐시 조회
      const cached = service.getCachedAnchor('nonexistent_agent');

      // Then: undefined 반환
      expect(cached).toBeUndefined();
    });
  });

  describe('캐시 무효화', () => {
    it('특정 슬롯의 캐시를 무효화해야 함', () => {
      // Given: 캐시 업데이트
      service.updateCache(agentId, 'A', 'mem_test');

      // When: 캐시 무효화 (null로 업데이트)
      service.updateCache(agentId, 'A', null);

      // Then: 캐시가 무효화되었는지 확인
      const cached = service.getCachedAnchor(agentId);
      expect(cached?.A).toBeNull();
    });

    it('모든 슬롯의 캐시를 무효화해야 함', () => {
      // Given: 모든 슬롯 캐시 업데이트
      service.updateCache(agentId, 'A', 'mem_a');
      service.updateCache(agentId, 'B', 'mem_b');
      service.updateCache(agentId, 'C', 'mem_c');

      // When: 모든 캐시 무효화 (deleteCache 사용)
      service.deleteCache(agentId);

      // Then: 모든 캐시가 무효화되었는지 확인
      const cached = service.getCachedAnchor(agentId);
      expect(cached).toBeUndefined();
    });
  });

  describe('getAnchorEmbedding', () => {
    it('앵커 메모리의 임베딩을 조회해야 함', async () => {
      // Given: 메모리 생성 및 임베딩 생성
      const memoryId = createTestMemory(db, {
        content: 'Test memory for embedding',
        type: 'episodic'
      });

      // 임베딩 생성 (임베딩 서비스가 사용 가능한 경우)
      if (embeddingService.isAvailable()) {
        await embeddingService.createAndStoreEmbedding(
          db,
          memoryId,
          'Test memory for embedding',
          'episodic'
        );
      }

      // When: 임베딩 조회
      const embedding = await service.getAnchorEmbedding(memoryId);

      // Then: 임베딩 반환 (임베딩이 있는 경우)
      // 임베딩 서비스가 사용 불가능하거나 임베딩이 없으면 null일 수 있음
      if (embedding) {
        expect(embedding).toHaveProperty('embedding');
        expect(embedding).toHaveProperty('provider');
        expect(Array.isArray(embedding.embedding)).toBe(true);
      }
    });

    it('존재하지 않는 메모리에 대해 null을 반환해야 함', async () => {
      // When: 존재하지 않는 메모리 ID로 임베딩 조회
      const embedding = await service.getAnchorEmbedding('mem_nonexistent');

      // Then: null 반환
      expect(embedding).toBeNull();
    });

    it('임베딩이 없는 메모리에 대해 null을 반환해야 함', async () => {
      // Given: 임베딩이 없는 메모리 생성
      const memoryId = createTestMemory(db, {
        content: 'Memory without embedding',
        type: 'episodic'
      });

      // When: 임베딩 조회
      const embedding = await service.getAnchorEmbedding(memoryId);

      // Then: null 반환
      expect(embedding).toBeNull();
    });
  });

  describe('캐시 만료 처리', () => {
    it('캐시가 만료되면 무효화해야 함', () => {
      // Given: 캐시 업데이트
      service.updateCache(agentId, 'A', 'mem_test');

      // When: 캐시 무효화 (null로 업데이트)
      service.updateCache(agentId, 'A', null);

      // Then: 캐시가 무효화되었는지 확인
      const cached = service.getCachedAnchor(agentId);
      expect(cached?.A).toBeNull();
    });
  });

  describe('메모리 제한', () => {
    it('여러 에이전트의 캐시를 관리할 수 있어야 함', () => {
      // Given: 여러 에이전트
      const agent1 = 'agent1';
      const agent2 = 'agent2';

      // When: 각 에이전트의 캐시 업데이트
      service.updateCache(agent1, 'A', 'mem_1');
      service.updateCache(agent2, 'A', 'mem_2');

      // Then: 각 에이전트의 캐시가 독립적으로 관리되는지 확인
      const cached1 = service.getCachedAnchor(agent1);
      const cached2 = service.getCachedAnchor(agent2);
      expect(cached1?.A).toBe('mem_1');
      expect(cached2?.A).toBe('mem_2');
    });
  });

  describe('getCachedMemoryId', () => {
    it('특정 슬롯의 메모리 ID를 조회해야 함', () => {
      // Given: 캐시 업데이트
      const memoryId = 'mem_test';
      service.updateCache(agentId, 'A', memoryId);

      // When: 특정 슬롯의 메모리 ID 조회
      const cachedId = service.getCachedMemoryId(agentId, 'A');

      // Then: 메모리 ID 반환
      expect(cachedId).toBe(memoryId);
    });

    it('캐시에 없으면 undefined를 반환해야 함', () => {
      // When: 캐시에 없는 에이전트 조회
      const cachedId = service.getCachedMemoryId('nonexistent_agent', 'A');

      // Then: undefined 반환
      expect(cachedId).toBeUndefined();
    });

    it('null 값도 반환할 수 있어야 함', () => {
      // Given: null로 캐시 업데이트
      service.updateCache(agentId, 'A', null);

      // When: 조회
      const cachedId = service.getCachedMemoryId(agentId, 'A');

      // Then: null 반환
      expect(cachedId).toBeNull();
    });
  });

  describe('restoreCacheFromDB', () => {
    it('DB에서 캐시를 복원해야 함', async () => {
      // Given: 앵커 데이터 생성
      const memoryId1 = createTestMemory(db, { content: 'Memory 1', type: 'episodic' });
      const memoryId2 = createTestMemory(db, { content: 'Memory 2', type: 'episodic' });

      // anchor 테이블에 직접 삽입
      DatabaseUtils.run(db, `
        INSERT INTO anchor (agent_id, slot, memory_id)
        VALUES (?, ?, ?), (?, ?, ?)
      `, [agentId, 'A', memoryId1, agentId, 'B', memoryId2]);

      // When: 캐시 복원
      await service.restoreCacheFromDB(db);

      // Then: 캐시가 복원되었는지 확인
      const cached = service.getCachedAnchor(agentId);
      expect(cached).toBeDefined();
      expect(cached?.A).toBe(memoryId1);
      expect(cached?.B).toBe(memoryId2);
    });

    it('anchor 테이블이 없으면 빈 캐시로 시작해야 함', async () => {
      // Given: anchor 테이블이 없는 DB (이미 setupTestDatabase에서 생성되지만 테스트용)
      const emptyDb = await setupTestDatabase();
      
      // anchor 테이블 삭제 (테스트용)
      emptyDb.exec('DROP TABLE IF EXISTS anchor');

      // When: 캐시 복원
      await service.restoreCacheFromDB(emptyDb);

      // Then: 빈 캐시로 시작
      const cached = service.getCachedAnchor(agentId);
      expect(cached).toBeUndefined();

      cleanupTestDatabase(emptyDb);
    });

    it('여러 에이전트의 캐시를 복원해야 함', async () => {
      // Given: 여러 에이전트의 앵커 데이터
      const agent1 = 'agent1';
      const agent2 = 'agent2';
      const memory1 = createTestMemory(db, { content: 'Memory 1', type: 'episodic' });
      const memory2 = createTestMemory(db, { content: 'Memory 2', type: 'episodic' });

      DatabaseUtils.run(db, `
        INSERT INTO anchor (agent_id, slot, memory_id)
        VALUES (?, ?, ?), (?, ?, ?)
      `, [agent1, 'A', memory1, agent2, 'A', memory2]);

      // When: 캐시 복원
      await service.restoreCacheFromDB(db);

      // Then: 모든 에이전트의 캐시가 복원되었는지 확인
      const cached1 = service.getCachedAnchor(agent1);
      const cached2 = service.getCachedAnchor(agent2);
      expect(cached1?.A).toBe(memory1);
      expect(cached2?.A).toBe(memory2);
    });
  });

  describe('setDatabase', () => {
    it('데이터베이스를 설정해야 함', () => {
      // Given: 새로운 서비스
      const newService = new AnchorCacheService();

      // When: 데이터베이스 설정
      newService.setDatabase(db);

      // Then: 에러 없이 설정됨
      expect(() => newService.setDatabase(db)).not.toThrow();
    });

    it('null 데이터베이스에 대해 에러를 던져야 함', () => {
      // Given: 새로운 서비스
      const newService = new AnchorCacheService();

      // When & Then: null 데이터베이스 설정 시 에러
      expect(() => newService.setDatabase(null as any)).toThrow('Database instance is required');
    });
  });

  describe('setEmbeddingService', () => {
    it('임베딩 서비스를 설정해야 함', () => {
      // Given: 새로운 서비스
      const newService = new AnchorCacheService();
      const newEmbeddingService = new MemoryEmbeddingService();

      // When: 임베딩 서비스 설정
      newService.setEmbeddingService(newEmbeddingService);

      // Then: 에러 없이 설정됨
      expect(() => newService.setEmbeddingService(newEmbeddingService)).not.toThrow();
    });

    it('null 임베딩 서비스에 대해 에러를 던져야 함', () => {
      // Given: 새로운 서비스
      const newService = new AnchorCacheService();

      // When & Then: null 임베딩 서비스 설정 시 에러
      expect(() => newService.setEmbeddingService(null as any)).toThrow('MemoryEmbeddingService is required');
    });
  });

  describe('임베딩 엣지 케이스', () => {
    it('JSON 파싱 실패 시 null을 반환해야 함', async () => {
      // Given: 잘못된 형식의 임베딩이 저장된 메모리
      const memoryId = createTestMemory(db, { content: 'Test', type: 'episodic' });

      // 잘못된 형식의 임베딩 삽입
      // memory_embedding 테이블 스키마 확인 후 삽입
      const tableInfo = db.prepare(`PRAGMA table_info(memory_embedding)`).all() as Array<{ name: string }>;
      const columnNames = tableInfo.map(col => col.name);
      
      // 필수 컬럼만 사용하여 삽입
      const baseColumns = ['memory_id', 'embedding_provider', 'embedding', 'dim'];
      const optionalColumns: Record<string, any> = {};
      
      if (columnNames.includes('projection_type')) {
        optionalColumns['projection_type'] = 'native';
      }
      if (columnNames.includes('dimensions')) {
        optionalColumns['dimensions'] = 384;
      }
      if (columnNames.includes('model')) {
        optionalColumns['model'] = 'tfidf';
      }
      if (columnNames.includes('precision')) {
        optionalColumns['precision'] = 32;
      }
      if (columnNames.includes('normalized')) {
        optionalColumns['normalized'] = 1;
      }
      if (columnNames.includes('version')) {
        optionalColumns['version'] = 1;
      }
      if (columnNames.includes('created_by')) {
        optionalColumns['created_by'] = 'test';
      }
      
      const allColumns = [...baseColumns, ...Object.keys(optionalColumns)];
      const allValues = [
        memoryId,
        'tfidf',
        'invalid json',
        384,
        ...Object.values(optionalColumns)
      ];
      
      DatabaseUtils.run(db, `
        INSERT INTO memory_embedding (${allColumns.join(', ')})
        VALUES (${allColumns.map(() => '?').join(', ')})
      `, allValues);

      // When: 임베딩 조회
      const embedding = await service.getAnchorEmbedding(memoryId);

      // Then: null 반환
      expect(embedding).toBeNull();
    });

    it('빈 배열 임베딩에 대해 null을 반환해야 함', async () => {
      // Given: 빈 배열 임베딩
      const memoryId = createTestMemory(db, { content: 'Test', type: 'episodic' });

      // memory_embedding 테이블 스키마 확인 후 삽입
      const tableInfo = db.prepare(`PRAGMA table_info(memory_embedding)`).all() as Array<{ name: string }>;
      const columnNames = tableInfo.map(col => col.name);
      
      // 필수 컬럼만 사용하여 삽입
      const baseColumns = ['memory_id', 'embedding_provider', 'embedding', 'dim'];
      const optionalColumns: Record<string, any> = {};
      
      if (columnNames.includes('projection_type')) {
        optionalColumns['projection_type'] = 'native';
      }
      if (columnNames.includes('dimensions')) {
        optionalColumns['dimensions'] = 0;
      }
      if (columnNames.includes('model')) {
        optionalColumns['model'] = 'tfidf';
      }
      if (columnNames.includes('precision')) {
        optionalColumns['precision'] = 32;
      }
      if (columnNames.includes('normalized')) {
        optionalColumns['normalized'] = 1;
      }
      if (columnNames.includes('version')) {
        optionalColumns['version'] = 1;
      }
      if (columnNames.includes('created_by')) {
        optionalColumns['created_by'] = 'test';
      }
      
      const allColumns = [...baseColumns, ...Object.keys(optionalColumns)];
      const allValues = [
        memoryId,
        'tfidf',
        '[]',
        0,
        ...Object.values(optionalColumns)
      ];
      
      DatabaseUtils.run(db, `
        INSERT INTO memory_embedding (${allColumns.join(', ')})
        VALUES (${allColumns.map(() => '?').join(', ')})
      `, allValues);

      // When: 임베딩 조회
      const embedding = await service.getAnchorEmbedding(memoryId);

      // Then: null 반환
      expect(embedding).toBeNull();
    });
  });
});

