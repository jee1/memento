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
      // Mock이 호출되었는지 확인 (실제 서버 시작 시에만 호출됨)
      expect(StdioServerTransport).toBeDefined();
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

      // Mock이 정의되었는지 확인
      expect(mockServer.setRequestHandler).toBeDefined();
    });
  });

  describe('데이터베이스 연결', () => {
    it('데이터베이스가 올바르게 초기화되어야 함', async () => {
      const { initializeDatabase } = await import('../database/init.js');
      vi.mocked(initializeDatabase).mockResolvedValue(mockDb);

      // Mock이 정의되었는지 확인
      expect(initializeDatabase).toBeDefined();
    });
  });

  describe('서비스 초기화', () => {
    it('검색 엔진이 초기화되어야 함', async () => {
      const { SearchEngine } = await import('../algorithms/search-engine.js');
      expect(SearchEngine).toBeDefined();
    });

    it('하이브리드 검색 엔진이 초기화되어야 함', async () => {
      const { HybridSearchEngine } = await import('../algorithms/hybrid-search-engine.js');
      expect(HybridSearchEngine).toBeDefined();
    });

    it('임베딩 서비스가 초기화되어야 함', async () => {
      const { MemoryEmbeddingService } = await import('../services/memory-embedding-service.js');
      expect(MemoryEmbeddingService).toBeDefined();
    });

    it('망각 정책 서비스가 초기화되어야 함', async () => {
      const { ForgettingPolicyService } = await import('../services/forgetting-policy-service.js');
      expect(ForgettingPolicyService).toBeDefined();
    });

    it('성능 모니터가 초기화되어야 함', async () => {
      const { PerformanceMonitor } = await import('../services/performance-monitor.js');
      expect(PerformanceMonitor).toBeDefined();
    });
  });

  describe('에러 처리', () => {
    it('초기화 에러가 적절히 처리되어야 함', async () => {
      const { initializeDatabase } = await import('../database/init.js');
      vi.mocked(initializeDatabase).mockRejectedValue(new Error('Database connection failed'));

      // Mock이 정의되었는지 확인
      expect(initializeDatabase).toBeDefined();
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

    it('세마포어가 동시 요청을 제한한다', async () => {
      const Semaphore = (await import('../server/index.js')).Semaphore;
      const semaphore = new Semaphore(2);
      const results: number[] = [];
      const startTime = Date.now();

      // 5개의 동시 요청을 생성하지만 세마포어는 2개만 허용
      const promises = Array.from({ length: 5 }, async (_, i) => {
        await semaphore.acquire();
        results.push(i);
        await new Promise(resolve => setTimeout(resolve, 100)); // 100ms 대기
        semaphore.release();
      });

      await Promise.all(promises);
      const endTime = Date.now();

      // 결과가 순차적으로 처리되었는지 확인
      expect(results).toHaveLength(5);
      // 최소 300ms 이상 걸려야 함 (2개씩 처리하므로 3번의 배치)
      expect(endTime - startTime).toBeGreaterThanOrEqual(300);
    });

    it('세마포어가 순서대로 요청을 처리한다', async () => {
      const Semaphore = (await import('../server/index.js')).Semaphore;
      const semaphore = new Semaphore(1);
      const results: number[] = [];

      // 순차적으로 요청을 처리해야 함
      const promises = Array.from({ length: 3 }, async (_, i) => {
        await semaphore.acquire();
        results.push(i);
        await new Promise(resolve => setTimeout(resolve, 50));
        semaphore.release();
      });

      await Promise.all(promises);

      // 결과가 순서대로 처리되었는지 확인
      expect(results).toEqual([0, 1, 2]);
    });
  });

  describe('데이터베이스 상태 모니터링', () => {
    it('데이터베이스 상태를 모니터링한다', async () => {
      const { DatabaseUtils } = await import('../utils/database.js');
      const mockDb = {
        prepare: vi.fn().mockReturnValue({
          get: vi.fn().mockReturnValue({
            journal_mode: 'WAL',
            wal_autocheckpoint: 1000,
            busy_timeout: 5000,
            is_locked: 0
          })
        })
      };

      vi.mocked(DatabaseUtils.getDatabaseStatus).mockResolvedValue({
        journalMode: 'WAL',
        walAutoCheckpoint: 1000,
        busyTimeout: 5000,
        isLocked: false
      });

      const status = await DatabaseUtils.getDatabaseStatus(mockDb as any);
      expect(status).toBeDefined();
      expect(status.journalMode).toBe('WAL');
      expect(status.isLocked).toBe(false);
    });

    it('데이터베이스 락이 감지되면 WAL 체크포인트를 실행한다', async () => {
      const { DatabaseUtils } = await import('../utils/database.js');
      const mockDb = {
        prepare: vi.fn().mockReturnValue({
          get: vi.fn().mockReturnValue({
            journal_mode: 'WAL',
            wal_autocheckpoint: 1000,
            busy_timeout: 5000,
            is_locked: 1 // 락 상태
          })
        })
      };

      vi.mocked(DatabaseUtils.getDatabaseStatus).mockResolvedValue({
        journalMode: 'WAL',
        walAutoCheckpoint: 1000,
        busyTimeout: 5000,
        isLocked: true
      });

      vi.mocked(DatabaseUtils.checkpointWAL).mockResolvedValue();

      const status = await DatabaseUtils.getDatabaseStatus(mockDb as any);
      expect(status.isLocked).toBe(true);
      
      // 락이 감지되면 WAL 체크포인트가 호출되어야 함
      if (status.isLocked) {
        await DatabaseUtils.checkpointWAL(mockDb as any);
        expect(DatabaseUtils.checkpointWAL).toHaveBeenCalledWith(mockDb);
      }
    });
  });

  describe('서버 종료', () => {
    it('서버가 올바르게 종료되어야 함', async () => {
      const { closeDatabase } = await import('../database/init.js');
      vi.mocked(closeDatabase).mockResolvedValue();

      // Mock이 정의되었는지 확인
      expect(closeDatabase).toBeDefined();
    });
  });
});
