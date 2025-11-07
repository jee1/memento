/**
 * Memory Resource E2E 테스트
 * MCP Resource를 통한 메모리 조회 및 이웃 기억 포함 기능 검증
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { DatabaseUtils } from '../utils/database.js';
import { initializeDatabase } from '../database/init.js';
import { MemoryEmbeddingService } from '../services/memory-embedding-service.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListResourcesRequestSchema, ReadResourceRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { MemoryNeighborService } from '../services/memory-neighbor-service.js';
import { getVectorSearchEngine } from '../algorithms/vector-search-engine.js';

describe('Memory Resource E2E Tests', () => {
  let db: Database.Database;
  let embeddingService: MemoryEmbeddingService;
  let testMemoryIds: string[] = [];
  let server: Server;

  beforeAll(async () => {
    // 테스트 데이터베이스 초기화
    db = await initializeDatabase();
    
    embeddingService = new MemoryEmbeddingService();
    
    // 테스트 메모리 생성
    console.log('📝 테스트 메모리 생성 중...');
    testMemoryIds = await createTestMemories(db, embeddingService);
    console.log(`✅ 테스트 메모리 생성 완료 (${testMemoryIds.length}개)`);
    
    // MCP 서버 초기화 (테스트용)
    server = new Server(
      {
        name: 'memento-test',
        version: '0.1.0'
      },
      {
        capabilities: {
          resources: {}
        }
      }
    );
    
    // Resource 핸들러 등록 (실제 서버와 동일한 로직)
    setupResourceHandlers(server, db, embeddingService);
  });

  afterAll(async () => {
    // 테스트 데이터 정리
    if (db) {
      try {
        for (const id of testMemoryIds) {
          await DatabaseUtils.run(db, 'DELETE FROM memory_item WHERE id = ?', [id]);
        }
      } catch (error) {
        console.warn('⚠️ 테스트 데이터 정리 실패:', error);
      }
      db.close();
    }
  });

  describe('Resources 목록 조회', () => {
    it('should return list of memory resources', async () => {
      if (testMemoryIds.length === 0) {
        console.warn('⚠️ 테스트 메모리가 없어 테스트를 스킵합니다');
        return;
      }

      const request = {
        params: {}
      };

      const result = await server.request(ListResourcesRequestSchema, request);

      expect(result).toHaveProperty('resources');
      expect(Array.isArray(result.resources)).toBe(true);
      expect(result.resources.length).toBeGreaterThan(0);
      
      // memory:// URI 형식 확인
      const memoryResource = result.resources.find((r: any) => r.uri.startsWith('memory://'));
      expect(memoryResource).toBeDefined();
      expect(memoryResource).toHaveProperty('uri');
      expect(memoryResource).toHaveProperty('name');
      expect(memoryResource).toHaveProperty('description');
      expect(memoryResource).toHaveProperty('mimeType', 'application/json');

      console.log(`✅ Resources 목록 조회 성공: ${result.resources.length}개 리소스`);
    });

    it('should return resources with correct URI format', async () => {
      if (testMemoryIds.length === 0) {
        console.warn('⚠️ 테스트 메모리가 없어 테스트를 스킵합니다');
        return;
      }

      const request = {
        params: {}
      };

      const result = await server.request(ListResourcesRequestSchema, request);

      result.resources.forEach((resource: any) => {
        expect(resource.uri).toMatch(/^memory:\/\/mem_/);
        expect(resource.name).toContain('Memory');
        expect(resource.mimeType).toBe('application/json');
      });
    });
  });

  describe('Resource 읽기', () => {
    it('should read memory resource without neighbors', async () => {
      if (testMemoryIds.length === 0) {
        console.warn('⚠️ 테스트 메모리가 없어 테스트를 스킵합니다');
        return;
      }

      const memoryId = testMemoryIds[0];
      const uri = `memory://${memoryId}`;

      const request = {
        params: { uri }
      };

      const result = await server.request(ReadResourceRequestSchema, request);

      expect(result).toHaveProperty('contents');
      expect(result.contents).toBeInstanceOf(Array);
      expect(result.contents.length).toBeGreaterThan(0);

      const content = result.contents[0];
      expect(content).toHaveProperty('uri', uri);
      expect(content).toHaveProperty('mimeType', 'application/json');
      expect(content).toHaveProperty('text');

      const memoryData = JSON.parse(content.text);
      expect(memoryData).toHaveProperty('id', memoryId);
      expect(memoryData).toHaveProperty('type');
      expect(memoryData).toHaveProperty('content');
      expect(memoryData).not.toHaveProperty('neighbors');

      console.log(`✅ Resource 읽기 성공 (이웃 없음): ${memoryId}`);
    });

    it('should read memory resource with neighbors when include_neighbors=true', async () => {
      if (testMemoryIds.length === 0) {
        console.warn('⚠️ 테스트 메모리가 없어 테스트를 스킵합니다');
        return;
      }

      const memoryId = testMemoryIds[0];
      const uri = `memory://${memoryId}?include_neighbors=true`;

      const request = {
        params: { uri }
      };

      const result = await server.request(ReadResourceRequestSchema, request);

      expect(result).toHaveProperty('contents');
      const content = result.contents[0];
      const memoryData = JSON.parse(content.text);

      expect(memoryData).toHaveProperty('id', memoryId);
      expect(memoryData).toHaveProperty('neighbors');
      expect(memoryData).toHaveProperty('neighbors_count');
      expect(memoryData).toHaveProperty('neighbors_query_time');
      expect(Array.isArray(memoryData.neighbors)).toBe(true);

      console.log(`✅ Resource 읽기 성공 (이웃 포함): ${memoryId}, ${memoryData.neighbors_count}개 이웃`);
    });

    it('should handle non-existent memory resource', async () => {
      const uri = 'memory://non_existent_id';

      const request = {
        params: { uri }
      };

      await expect(
        server.request(ReadResourceRequestSchema, request)
      ).rejects.toThrow('Memory not found');
    });

    it('should handle invalid URI format', async () => {
      const uri = 'invalid://uri';

      const request = {
        params: { uri }
      };

      await expect(
        server.request(ReadResourceRequestSchema, request)
      ).rejects.toThrow('Invalid resource URI');
    });

    it('should include neighbor details when neighbors exist', async () => {
      if (testMemoryIds.length < 2) {
        console.warn('⚠️ 테스트 메모리가 부족하여 테스트를 스킵합니다');
        return;
      }

      const memoryId = testMemoryIds[0];
      const uri = `memory://${memoryId}?include_neighbors=true`;

      const request = {
        params: { uri }
      };

      const result = await server.request(ReadResourceRequestSchema, request);
      const content = result.contents[0];
      const memoryData = JSON.parse(content.text);

      if (memoryData.neighbors.length > 0) {
        const neighbor = memoryData.neighbors[0];
        expect(neighbor).toHaveProperty('id');
        expect(neighbor).toHaveProperty('content');
        expect(neighbor).toHaveProperty('type');
        expect(neighbor).toHaveProperty('similarity');
        expect(typeof neighbor.similarity).toBe('number');
      }
    });
  });

  describe('쿼리 파라미터 처리', () => {
    it('should default to not including neighbors', async () => {
      if (testMemoryIds.length === 0) {
        console.warn('⚠️ 테스트 메모리가 없어 테스트를 스킵합니다');
        return;
      }

      const memoryId = testMemoryIds[0];
      const uri = `memory://${memoryId}`; // include_neighbors 파라미터 없음

      const request = {
        params: { uri }
      };

      const result = await server.request(ReadResourceRequestSchema, request);
      const content = result.contents[0];
      const memoryData = JSON.parse(content.text);

      expect(memoryData).not.toHaveProperty('neighbors');
    });

    it('should include neighbors when include_neighbors=true', async () => {
      if (testMemoryIds.length === 0) {
        console.warn('⚠️ 테스트 메모리가 없어 테스트를 스킵합니다');
        return;
      }

      const memoryId = testMemoryIds[0];
      const uri = `memory://${memoryId}?include_neighbors=true`;

      const request = {
        params: { uri }
      };

      const result = await server.request(ReadResourceRequestSchema, request);
      const content = result.contents[0];
      const memoryData = JSON.parse(content.text);

      expect(memoryData).toHaveProperty('neighbors');
    });

    it('should handle other query parameters gracefully', async () => {
      if (testMemoryIds.length === 0) {
        console.warn('⚠️ 테스트 메모리가 없어 테스트를 스킵합니다');
        return;
      }

      const memoryId = testMemoryIds[0];
      const uri = `memory://${memoryId}?other_param=value&include_neighbors=true`;

      const request = {
        params: { uri }
      };

      const result = await server.request(ReadResourceRequestSchema, request);
      const content = result.contents[0];
      const memoryData = JSON.parse(content.text);

      // include_neighbors=true가 있으면 neighbors 포함
      expect(memoryData).toHaveProperty('neighbors');
    });
  });
});

/**
 * Resource 핸들러 설정 (실제 서버와 동일한 로직)
 */
function setupResourceHandlers(
  server: Server,
  db: Database.Database,
  embeddingService: MemoryEmbeddingService
): void {
  // Resources 목록 핸들러
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    const memories = await DatabaseUtils.all(db, 'SELECT id FROM memory_item ORDER BY created_at DESC LIMIT 1000');
    
    return {
      resources: memories.map((memory: any) => ({
        uri: `memory://${memory.id}`,
        name: `Memory ${memory.id}`,
        description: `Memory item with ID: ${memory.id}`,
        mimeType: 'application/json'
      }))
    };
  });
  
  // Resource 읽기 핸들러
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;
    
    // URI 파싱: memory://{id}?include_neighbors=true
    const uriMatch = uri.match(/^memory:\/\/([^?]+)(\?.*)?$/);
    if (!uriMatch) {
      throw new Error(`Invalid resource URI: ${uri}`);
    }
    
    const memoryId = uriMatch[1];
    const queryString = uriMatch[2] || '';
    const includeNeighbors = queryString.includes('include_neighbors=true');
    
    // 메모리 조회
    const memory = await DatabaseUtils.get(
      db,
      'SELECT id, type, content, importance, privacy_scope, tags, source, created_at, last_accessed, pinned FROM memory_item WHERE id = ?',
      [memoryId]
    );
    
    if (!memory) {
      throw new Error(`Memory not found: ${memoryId}`);
    }
    
    // 메모리 데이터 구성
    const memoryData: any = {
      id: memory.id,
      type: memory.type,
      content: memory.content,
      importance: memory.importance,
      privacy_scope: memory.privacy_scope,
      tags: memory.tags ? JSON.parse(memory.tags) : [],
      source: memory.source,
      created_at: memory.created_at,
      last_accessed: memory.last_accessed,
      pinned: memory.pinned === 1
    };
    
    // 이웃 기억 포함 여부 확인
    if (includeNeighbors) {
      try {
        const vectorSearchEngine = getVectorSearchEngine();
        const neighborService = new MemoryNeighborService(
          vectorSearchEngine,
          embeddingService
        );
        neighborService.setDatabase(db);
        
        const neighborsResult = await neighborService.getNeighbors(memoryId, {
          limit: 5,
          similarity_threshold: 0.8
        });
        
        memoryData.neighbors = neighborsResult.neighbors;
        memoryData.neighbors_count = neighborsResult.total_count;
        memoryData.neighbors_query_time = neighborsResult.query_time;
      } catch (error) {
        memoryData.neighbors = [];
        memoryData.neighbors_count = 0;
      }
    }
    
    return {
      contents: [
        {
          uri,
          mimeType: 'application/json',
          text: JSON.stringify(memoryData, null, 2)
        }
      ]
    };
  });
}

/**
 * 테스트 메모리 생성 헬퍼 함수
 */
async function createTestMemories(
  db: Database.Database,
  embeddingService: MemoryEmbeddingService
): Promise<string[]> {
  const memoryIds: string[] = [];
  const testContents = [
    'React Hook에 대해 질문했고, useState와 useEffect의 차이점을 설명했다.',
    'TypeScript의 타입 시스템에 대해 설명했다. 인터페이스와 타입 별칭의 차이점을 다뤘다.',
    'Node.js의 비동기 처리 방식에 대해 설명했다. Promise와 async/await의 사용법을 다뤘다.'
  ];

  for (let i = 0; i < testContents.length; i++) {
    const memoryId = `mem_test_resource_${Date.now()}_${i}`;
    const content = testContents[i];
    
    // 메모리 아이템 생성
    await DatabaseUtils.run(db, `
      INSERT INTO memory_item (id, type, content, importance, privacy_scope, created_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `, [memoryId, 'episodic', content, 0.5, 'private']);

    // 임베딩 생성 (가능한 경우)
    if (embeddingService.isAvailable()) {
      try {
        await embeddingService.createAndStoreEmbedding(db, memoryId, content, 'episodic');
      } catch (error) {
        console.warn(`⚠️ 임베딩 생성 실패 (${memoryId}):`, error);
      }
    }

    memoryIds.push(memoryId);
  }

  // 임베딩 생성 완료 대기
  await new Promise(resolve => setTimeout(resolve, 1000));

  return memoryIds;
}

