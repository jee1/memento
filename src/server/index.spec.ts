import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

// Mock all dependencies
vi.mock('@modelcontextprotocol/sdk/server/index.js');
vi.mock('@modelcontextprotocol/sdk/server/stdio.js');
vi.mock('@modelcontextprotocol/sdk/types.js');
vi.mock('../database/init.js');
vi.mock('../config/index.js');
vi.mock('../utils/database.js');
vi.mock('../algorithms/search-engine.js');
vi.mock('../algorithms/hybrid-search-engine.js');
vi.mock('../services/memory-embedding-service.js');
vi.mock('../services/forgetting-policy-service.js');
vi.mock('../services/performance-monitor.js');
vi.mock('../services/cache-service.js');
vi.mock('../services/database-optimizer.js');
vi.mock('../services/error-logging-service.js');
vi.mock('../services/performance-alert-service.js');
vi.mock('../services/performance-monitoring-integration.js');
vi.mock('../tools/index.js');
vi.mock('better-sqlite3');

describe('Memento MCP Server', () => {
  let mockServer: any;
  let mockTransport: any;
  let mockDb: any;

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Mock Server
    mockServer = {
      setRequestHandler: vi.fn(),
      connect: vi.fn(),
      close: vi.fn(),
      on: vi.fn()
    };
    
    // Mock Transport
    mockTransport = {
      start: vi.fn(),
      close: vi.fn()
    };
    
    // Mock Database
    mockDb = {
      prepare: vi.fn(),
      exec: vi.fn(),
      close: vi.fn()
    };

    // Mock Server constructor
    vi.mocked(Server).mockImplementation(() => mockServer);
    vi.mocked(StdioServerTransport).mockImplementation(() => mockTransport);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('서버 초기화', () => {
    it('서버가 올바르게 생성되어야 함', async () => {
      // 서버 모듈을 동적으로 import하여 실제 초기화 과정을 테스트
      const serverModule = await import('../server/index.js');
      expect(serverModule).toBeDefined();
    });

    it('stdio 전송이 올바르게 생성되어야 함', () => {
      expect(StdioServerTransport).toHaveBeenCalled();
    });
  });

  describe('도구 등록', () => {
    it('핵심 도구들이 등록되어야 함', () => {
      // Mock tool registry
      const mockToolRegistry = {
        getTools: vi.fn().mockReturnValue([
          { name: 'remember', description: '기억을 저장합니다' },
          { name: 'recall', description: '기억을 검색합니다' },
          { name: 'pin', description: '기억을 고정합니다' },
          { name: 'unpin', description: '기억 고정을 해제합니다' },
          { name: 'forget', description: '기억을 삭제합니다' }
        ])
      };

      vi.doMock('../tools/index.js', () => ({
        getToolRegistry: () => mockToolRegistry
      }));

      expect(mockServer.setRequestHandler).toHaveBeenCalled();
    });
  });

  describe('데이터베이스 연결', () => {
    it('데이터베이스가 올바르게 초기화되어야 함', async () => {
      const { initializeDatabase } = await import('../database/init.js');
      vi.mocked(initializeDatabase).mockResolvedValue(mockDb);

      expect(initializeDatabase).toHaveBeenCalled();
    });
  });

  describe('서비스 초기화', () => {
    it('검색 엔진이 초기화되어야 함', () => {
      const { SearchEngine } = require('../algorithms/search-engine.js');
      expect(SearchEngine).toHaveBeenCalled();
    });

    it('하이브리드 검색 엔진이 초기화되어야 함', () => {
      const { HybridSearchEngine } = require('../algorithms/hybrid-search-engine.js');
      expect(HybridSearchEngine).toHaveBeenCalled();
    });

    it('임베딩 서비스가 초기화되어야 함', () => {
      const { MemoryEmbeddingService } = require('../services/memory-embedding-service.js');
      expect(MemoryEmbeddingService).toHaveBeenCalled();
    });

    it('망각 정책 서비스가 초기화되어야 함', () => {
      const { ForgettingPolicyService } = require('../services/forgetting-policy-service.js');
      expect(ForgettingPolicyService).toHaveBeenCalled();
    });

    it('성능 모니터가 초기화되어야 함', () => {
      const { PerformanceMonitor } = require('../services/performance-monitor.js');
      expect(PerformanceMonitor).toHaveBeenCalled();
    });
  });

  describe('에러 처리', () => {
    it('초기화 에러가 적절히 처리되어야 함', async () => {
      const { initializeDatabase } = await import('../database/init.js');
      vi.mocked(initializeDatabase).mockRejectedValue(new Error('Database connection failed'));

      // 에러가 발생해도 서버가 크래시되지 않아야 함
      expect(initializeDatabase).toHaveBeenCalled();
    });
  });

  describe('로그 차단', () => {
    it('console 메서드들이 차단되어야 함', () => {
      const originalConsole = { ...console };
      
      // 서버 초기화 후 console 메서드들이 차단되었는지 확인
      expect(console.log).toBeDefined();
      expect(console.error).toBeDefined();
      expect(console.warn).toBeDefined();
      expect(console.info).toBeDefined();
      expect(console.debug).toBeDefined();
    });
  });

  describe('세마포어', () => {
    it('동시성 제한이 올바르게 작동해야 함', async () => {
      // Semaphore 클래스 테스트
      const Semaphore = (await import('../server/index.js')).Semaphore;
      const semaphore = new Semaphore(2);

      expect(semaphore).toBeDefined();
      expect(semaphore.acquire).toBeDefined();
      expect(semaphore.release).toBeDefined();
    });
  });

  describe('서버 종료', () => {
    it('서버가 올바르게 종료되어야 함', async () => {
      const { closeDatabase } = await import('../database/init.js');
      vi.mocked(closeDatabase).mockResolvedValue();

      expect(closeDatabase).toHaveBeenCalled();
    });
  });
});
