import { describe, it, expect } from 'vitest';
import {
  MementoError,
  ConnectionError,
  AuthenticationError,
  ValidationError,
  NotFoundError,
  type MemoryItem,
  type CreateMemoryParams,
  type UpdateMemoryParams,
  type SearchFilters,
  type SearchResult,
  type HybridSearchParams,
  type HybridSearchResult,
  type RememberResult,
  type PinResult,
  type ForgetResult,
  type LinkResult,
  type ExportResult,
  type FeedbackResult,
  type ContextInjectionParams,
  type ContextInjectionResult,
  type HealthCheck,
  type MementoClientOptions,
  type MemoryType,
  type PrivacyScope
} from './types.js';

describe('Types', () => {
  describe('MementoError', () => {
    it('기본 에러 클래스가 올바르게 작동해야 함', () => {
      const error = new MementoError('Test error', 'TEST_ERROR');
      
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(MementoError);
      expect(error.message).toBe('Test error');
      expect(error.code).toBe('TEST_ERROR');
      expect(error.name).toBe('MementoError');
    });

    it('스택 트레이스를 포함해야 함', () => {
      const error = new MementoError('Test error', 'TEST_ERROR');
      
      expect(error.stack).toBeDefined();
      expect(typeof error.stack).toBe('string');
    });
  });

  describe('ConnectionError', () => {
    it('연결 에러가 올바르게 작동해야 함', () => {
      const error = new ConnectionError('Connection failed');
      
      expect(error).toBeInstanceOf(MementoError);
      expect(error.message).toBe('Connection failed');
      expect(error.code).toBe('CONNECTION_ERROR');
      expect(error.name).toBe('ConnectionError');
    });
  });

  describe('AuthenticationError', () => {
    it('인증 에러가 올바르게 작동해야 함', () => {
      const error = new AuthenticationError('Invalid API key');
      
      expect(error).toBeInstanceOf(MementoError);
      expect(error.message).toBe('Invalid API key');
      expect(error.code).toBe('AUTHENTICATION_ERROR');
      expect(error.name).toBe('AuthenticationError');
    });
  });

  describe('ValidationError', () => {
    it('검증 에러가 올바르게 작동해야 함', () => {
      const error = new ValidationError('Invalid input data');
      
      expect(error).toBeInstanceOf(MementoError);
      expect(error.message).toBe('Invalid input data');
      expect(error.code).toBe('VALIDATION_ERROR');
      expect(error.name).toBe('ValidationError');
    });
  });

  describe('NotFoundError', () => {
    it('찾을 수 없음 에러가 올바르게 작동해야 함', () => {
      const error = new NotFoundError('Memory not found');
      
      expect(error).toBeInstanceOf(MementoError);
      expect(error.message).toBe('Memory not found');
      expect(error.code).toBe('NOT_FOUND_ERROR');
      expect(error.name).toBe('NotFoundError');
    });
  });

  describe('MemoryItem', () => {
    it('올바른 MemoryItem 객체를 생성할 수 있어야 함', () => {
      const memory: MemoryItem = {
        id: 'memory-123',
        content: 'Test memory content',
        type: 'episodic',
        importance: 0.8,
        created_at: '2024-01-01T00:00:00.000Z',
        last_accessed: '2024-01-01T00:00:00.000Z',
        pinned: false,
        tags: ['test', 'example'],
        source: 'user',
        privacy_scope: 'private'
      };

      expect(memory.id).toBe('memory-123');
      expect(memory.content).toBe('Test memory content');
      expect(memory.type).toBe('episodic');
      expect(memory.importance).toBe(0.8);
      expect(memory.pinned).toBe(false);
      expect(Array.isArray(memory.tags)).toBe(true);
      expect(memory.privacy_scope).toBe('private');
    });
  });

  describe('CreateMemoryParams', () => {
    it('올바른 CreateMemoryParams 객체를 생성할 수 있어야 함', () => {
      const params: CreateMemoryParams = {
        content: 'New memory content',
        type: 'semantic',
        importance: 0.9,
        tags: ['important', 'knowledge'],
        source: 'api',
        privacy_scope: 'team'
      };

      expect(params.content).toBe('New memory content');
      expect(params.type).toBe('semantic');
      expect(params.importance).toBe(0.9);
      expect(Array.isArray(params.tags)).toBe(true);
      expect(params.privacy_scope).toBe('team');
    });
  });

  describe('UpdateMemoryParams', () => {
    it('올바른 UpdateMemoryParams 객체를 생성할 수 있어야 함', () => {
      const params: UpdateMemoryParams = {
        content: 'Updated content',
        importance: 0.7,
        tags: ['updated']
      };

      expect(params.content).toBe('Updated content');
      expect(params.importance).toBe(0.7);
      expect(Array.isArray(params.tags)).toBe(true);
    });
  });

  describe('SearchFilters', () => {
    it('올바른 SearchFilters 객체를 생성할 수 있어야 함', () => {
      const filters: SearchFilters = {
        type: ['episodic', 'semantic'],
        tags: ['react', 'javascript'],
        pinned: true,
        time_from: '2024-01-01T00:00:00.000Z',
        time_to: '2024-12-31T23:59:59.999Z',
        importance_min: 0.5,
        importance_max: 1.0,
        limit: 20
      };

      expect(Array.isArray(filters.type)).toBe(true);
      expect(Array.isArray(filters.tags)).toBe(true);
      expect(filters.pinned).toBe(true);
      expect(filters.limit).toBe(20);
    });
  });

  describe('SearchResult', () => {
    it('올바른 SearchResult 객체를 생성할 수 있어야 함', () => {
      const result: SearchResult = {
        items: [
          {
            id: 'memory-1',
            content: 'Test memory 1',
            type: 'episodic',
            importance: 0.8,
            created_at: '2024-01-01T00:00:00.000Z',
            last_accessed: '2024-01-01T00:00:00.000Z',
            pinned: false,
            tags: ['test'],
            source: 'user',
            privacy_scope: 'private',
            score: 0.95
          }
        ],
        total_count: 1,
        query_time: 50
      };

      expect(Array.isArray(result.items)).toBe(true);
      expect(result.total_count).toBe(1);
      expect(result.query_time).toBe(50);
    });
  });

  describe('HybridSearchParams', () => {
    it('올바른 HybridSearchParams 객체를 생성할 수 있어야 함', () => {
      const params: HybridSearchParams = {
        query: 'React Hook',
        limit: 10,
        vectorWeight: 0.7,
        textWeight: 0.3,
        filters: {
          type: ['episodic']
        }
      };

      expect(params.query).toBe('React Hook');
      expect(params.limit).toBe(10);
      expect(params.vectorWeight).toBe(0.7);
      expect(params.textWeight).toBe(0.3);
    });
  });

  describe('HybridSearchResult', () => {
    it('올바른 HybridSearchResult 객체를 생성할 수 있어야 함', () => {
      const result: HybridSearchResult = {
        items: [
          {
            id: 'memory-1',
            content: 'Test memory',
            type: 'episodic',
            importance: 0.8,
            created_at: '2024-01-01T00:00:00.000Z',
            last_accessed: '2024-01-01T00:00:00.000Z',
            pinned: false,
            tags: ['test'],
            source: 'user',
            privacy_scope: 'private',
            score: 0.95,
            recall_reason: '하이브리드 검색'
          }
        ],
        total_count: 1,
        query_time: 50,
        search_type: 'hybrid'
      };

      expect(Array.isArray(result.items)).toBe(true);
      expect(result.search_type).toBe('hybrid');
      expect(result.items[0].recall_reason).toBe('하이브리드 검색');
    });
  });

  describe('RememberResult', () => {
    it('올바른 RememberResult 객체를 생성할 수 있어야 함', () => {
      const result: RememberResult = {
        memory_id: 'memory-123',
        message: 'Memory created successfully'
      };

      expect(result.memory_id).toBe('memory-123');
      expect(result.message).toBe('Memory created successfully');
    });
  });

  describe('PinResult', () => {
    it('올바른 PinResult 객체를 생성할 수 있어야 함', () => {
      const result: PinResult = {
        id: 'memory-123',
        pinned: true,
        message: 'Memory pinned successfully'
      };

      expect(result.id).toBe('memory-123');
      expect(result.pinned).toBe(true);
      expect(result.message).toBe('Memory pinned successfully');
    });
  });

  describe('ForgetResult', () => {
    it('올바른 ForgetResult 객체를 생성할 수 있어야 함', () => {
      const result: ForgetResult = {
        id: 'memory-123',
        deleted: true,
        message: 'Memory deleted successfully',
        hard: false
      };

      expect(result.id).toBe('memory-123');
      expect(result.deleted).toBe(true);
      expect(result.hard).toBe(false);
    });
  });

  describe('LinkResult', () => {
    it('올바른 LinkResult 객체를 생성할 수 있어야 함', () => {
      const result: LinkResult = {
        link_id: 'link-123',
        source_id: 'memory-1',
        target_id: 'memory-2',
        relation_type: 'derived_from',
        message: 'Link created successfully'
      };

      expect(result.link_id).toBe('link-123');
      expect(result.source_id).toBe('memory-1');
      expect(result.target_id).toBe('memory-2');
      expect(result.relation_type).toBe('derived_from');
    });
  });

  describe('ExportResult', () => {
    it('올바른 ExportResult 객체를 생성할 수 있어야 함', () => {
      const result: ExportResult = {
        export_id: 'export-123',
        format: 'json',
        url: 'https://example.com/export.json',
        expires_at: '2024-01-02T00:00:00.000Z',
        message: 'Export created successfully'
      };

      expect(result.export_id).toBe('export-123');
      expect(result.format).toBe('json');
      expect(result.url).toBe('https://example.com/export.json');
    });
  });

  describe('FeedbackResult', () => {
    it('올바른 FeedbackResult 객체를 생성할 수 있어야 함', () => {
      const result: FeedbackResult = {
        feedback_id: 'feedback-123',
        memory_id: 'memory-123',
        event_type: 'helpful',
        score: 0.8,
        message: 'Feedback recorded successfully'
      };

      expect(result.feedback_id).toBe('feedback-123');
      expect(result.memory_id).toBe('memory-123');
      expect(result.event_type).toBe('helpful');
      expect(result.score).toBe(0.8);
    });
  });

  describe('ContextInjectionParams', () => {
    it('올바른 ContextInjectionParams 객체를 생성할 수 있어야 함', () => {
      const params: ContextInjectionParams = {
        query: 'React Hook 질문',
        tokenBudget: 1000,
        maxResults: 5,
        contextType: 'conversation'
      };

      expect(params.query).toBe('React Hook 질문');
      expect(params.tokenBudget).toBe(1000);
      expect(params.maxResults).toBe(5);
      expect(params.contextType).toBe('conversation');
    });
  });

  describe('ContextInjectionResult', () => {
    it('올바른 ContextInjectionResult 객체를 생성할 수 있어야 함', () => {
      const result: ContextInjectionResult = {
        context: '관련 기억들...',
        memories_used: 3,
        token_count: 850,
        context_type: 'conversation'
      };

      expect(result.context).toBe('관련 기억들...');
      expect(result.memories_used).toBe(3);
      expect(result.token_count).toBe(850);
      expect(result.context_type).toBe('conversation');
    });
  });

  describe('HealthCheck', () => {
    it('올바른 HealthCheck 객체를 생성할 수 있어야 함', () => {
      const health: HealthCheck = {
        status: 'ok',
        version: '1.0.0',
        uptime: 3600,
        memory_usage: 0.5,
        database_status: 'connected',
        last_backup: '2024-01-01T00:00:00.000Z'
      };

      expect(health.status).toBe('ok');
      expect(health.version).toBe('1.0.0');
      expect(health.uptime).toBe(3600);
      expect(health.memory_usage).toBe(0.5);
    });
  });

  describe('MementoClientOptions', () => {
    it('올바른 MementoClientOptions 객체를 생성할 수 있어야 함', () => {
      const options: MementoClientOptions = {
        serverUrl: 'http://localhost:8080',
        apiKey: 'test-api-key',
        timeout: 5000,
        retries: 3,
        debug: true
      };

      expect(options.serverUrl).toBe('http://localhost:8080');
      expect(options.apiKey).toBe('test-api-key');
      expect(options.timeout).toBe(5000);
      expect(options.retries).toBe(3);
      expect(options.debug).toBe(true);
    });
  });

  describe('MemoryType', () => {
    it('올바른 MemoryType 값들을 가져야 함', () => {
      const types: MemoryType[] = ['working', 'episodic', 'semantic', 'procedural'];
      
      expect(types).toContain('working');
      expect(types).toContain('episodic');
      expect(types).toContain('semantic');
      expect(types).toContain('procedural');
    });
  });

  describe('PrivacyScope', () => {
    it('올바른 PrivacyScope 값들을 가져야 함', () => {
      const scopes: PrivacyScope[] = ['private', 'team', 'public'];
      
      expect(scopes).toContain('private');
      expect(scopes).toContain('team');
      expect(scopes).toContain('public');
    });
  });
});
