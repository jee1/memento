import { describe, it, expect } from 'vitest';
import type {
  MemoryType,
  PrivacyScope,
  MemoryItem,
  MemorySearchFilters,
  MemorySearchResult,
  SearchRankingWeights,
  EmbeddingProvider,
  MementoConfig,
  MementoError,
  ConnectionError,
  AuthenticationError,
  ValidationError,
  NotFoundError
} from './index.js';

describe('Types', () => {
  describe('MemoryType', () => {
    it('올바른 메모리 타입 값들을 가져야 함', () => {
      const types: MemoryType[] = ['working', 'episodic', 'semantic', 'procedural'];
      
      expect(types).toContain('working');
      expect(types).toContain('episodic');
      expect(types).toContain('semantic');
      expect(types).toContain('procedural');
    });
  });

  describe('PrivacyScope', () => {
    it('올바른 프라이버시 스코프 값들을 가져야 함', () => {
      const scopes: PrivacyScope[] = ['private', 'team', 'public'];
      
      expect(scopes).toContain('private');
      expect(scopes).toContain('team');
      expect(scopes).toContain('public');
    });
  });

  describe('MemoryItem', () => {
    it('올바른 MemoryItem 객체를 생성할 수 있어야 함', () => {
      const memory: MemoryItem = {
        id: 'memory-123',
        type: 'episodic',
        content: 'Test memory content',
        importance: 0.8,
        privacy_scope: 'private',
        created_at: new Date('2024-01-01T00:00:00.000Z'),
        last_accessed: new Date('2024-01-01T00:00:00.000Z'),
        pinned: false,
        tags: ['test', 'example'],
        source: 'user',
        embedding: [0.1, 0.2, 0.3]
      };

      expect(memory.id).toBe('memory-123');
      expect(memory.type).toBe('episodic');
      expect(memory.content).toBe('Test memory content');
      expect(memory.importance).toBe(0.8);
      expect(memory.privacy_scope).toBe('private');
      expect(memory.pinned).toBe(false);
      expect(Array.isArray(memory.tags)).toBe(true);
      expect(memory.source).toBe('user');
      expect(Array.isArray(memory.embedding)).toBe(true);
    });

    it('선택적 필드 없이 MemoryItem을 생성할 수 있어야 함', () => {
      const memory: MemoryItem = {
        id: 'memory-123',
        type: 'semantic',
        content: 'Test memory content',
        importance: 0.5,
        privacy_scope: 'public',
        created_at: new Date('2024-01-01T00:00:00.000Z'),
        pinned: true
      };

      expect(memory.id).toBe('memory-123');
      expect(memory.type).toBe('semantic');
      expect(memory.last_accessed).toBeUndefined();
      expect(memory.tags).toBeUndefined();
      expect(memory.source).toBeUndefined();
      expect(memory.embedding).toBeUndefined();
    });
  });

  describe('MemorySearchFilters', () => {
    it('올바른 MemorySearchFilters 객체를 생성할 수 있어야 함', () => {
      const filters: MemorySearchFilters = {
        id: ['memory-1', 'memory-2'],
        type: ['episodic', 'semantic'],
        tags: ['react', 'javascript'],
        privacy_scope: ['private', 'team'],
        time_from: '2024-01-01T00:00:00.000Z',
        time_to: '2024-12-31T23:59:59.999Z',
        pinned: true
      };

      expect(Array.isArray(filters.id)).toBe(true);
      expect(Array.isArray(filters.type)).toBe(true);
      expect(Array.isArray(filters.tags)).toBe(true);
      expect(Array.isArray(filters.privacy_scope)).toBe(true);
      expect(filters.time_from).toBe('2024-01-01T00:00:00.000Z');
      expect(filters.time_to).toBe('2024-12-31T23:59:59.999Z');
      expect(filters.pinned).toBe(true);
    });

    it('선택적 필드 없이 MemorySearchFilters를 생성할 수 있어야 함', () => {
      const filters: MemorySearchFilters = {};

      expect(filters.id).toBeUndefined();
      expect(filters.type).toBeUndefined();
      expect(filters.tags).toBeUndefined();
      expect(filters.privacy_scope).toBeUndefined();
      expect(filters.time_from).toBeUndefined();
      expect(filters.time_to).toBeUndefined();
      expect(filters.pinned).toBeUndefined();
    });
  });

  describe('MemorySearchResult', () => {
    it('올바른 MemorySearchResult 객체를 생성할 수 있어야 함', () => {
      const result: MemorySearchResult = {
        id: 'memory-123',
        content: 'Test memory content',
        type: 'episodic',
        importance: 0.8,
        created_at: new Date('2024-01-01T00:00:00.000Z'),
        last_accessed: new Date('2024-01-01T00:00:00.000Z'),
        pinned: false,
        tags: ['test', 'example'],
        score: 0.95,
        recall_reason: '하이브리드 검색'
      };

      expect(result.id).toBe('memory-123');
      expect(result.content).toBe('Test memory content');
      expect(result.type).toBe('episodic');
      expect(result.importance).toBe(0.8);
      expect(result.score).toBe(0.95);
      expect(result.recall_reason).toBe('하이브리드 검색');
    });

    it('선택적 필드 없이 MemorySearchResult를 생성할 수 있어야 함', () => {
      const result: MemorySearchResult = {
        id: 'memory-123',
        content: 'Test memory content',
        type: 'semantic',
        importance: 0.5,
        created_at: new Date('2024-01-01T00:00:00.000Z'),
        pinned: true,
        score: 0.8,
        recall_reason: '텍스트 검색'
      };

      expect(result.last_accessed).toBeUndefined();
      expect(result.tags).toBeUndefined();
    });
  });

  describe('SearchRankingWeights', () => {
    it('올바른 SearchRankingWeights 객체를 생성할 수 있어야 함', () => {
      const weights: SearchRankingWeights = {
        relevance: 0.50,
        recency: 0.20,
        importance: 0.20,
        usage: 0.10,
        duplication_penalty: 0.15
      };

      expect(weights.relevance).toBe(0.50);
      expect(weights.recency).toBe(0.20);
      expect(weights.importance).toBe(0.20);
      expect(weights.usage).toBe(0.10);
      expect(weights.duplication_penalty).toBe(0.15);
    });

    it('가중치의 합이 1에 가까워야 함', () => {
      const weights: SearchRankingWeights = {
        relevance: 0.50,
        recency: 0.20,
        importance: 0.20,
        usage: 0.10,
        duplication_penalty: 0.15
      };

      const sum = Object.values(weights).reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(1, 2);
    });
  });

  describe('EmbeddingProvider', () => {
    it('올바른 임베딩 제공자 값들을 가져야 함', () => {
      const providers: EmbeddingProvider[] = ['openai', 'gemini', 'lightweight'];
      
      expect(providers).toContain('openai');
      expect(providers).toContain('gemini');
      expect(providers).toContain('lightweight');
    });
  });

  describe('MementoConfig', () => {
    it('올바른 MementoConfig 객체를 생성할 수 있어야 함', () => {
      const config: MementoConfig = {
        dbPath: './data/memory.db',
        serverName: 'memento-memory',
        serverVersion: '1.0.0',
        port: 3000,
        embeddingProvider: 'openai',
        openaiApiKey: 'test-key',
        openaiModel: 'text-embedding-3-small',
        geminiApiKey: 'test-gemini-key',
        geminiModel: 'text-embedding-004',
        embeddingDimensions: 1536,
        searchDefaultLimit: 10,
        searchMaxLimit: 50,
        forgetTTL: {
          working: 48,
          episodic: 2160,
          semantic: -1,
          procedural: -1
        },
        logLevel: 'info',
        logFile: './logs/memento.log',
        nodeEnv: 'development'
      };

      expect(config.dbPath).toBe('./data/memory.db');
      expect(config.serverName).toBe('memento-memory');
      expect(config.serverVersion).toBe('1.0.0');
      expect(config.port).toBe(3000);
      expect(config.embeddingProvider).toBe('openai');
      expect(config.openaiApiKey).toBe('test-key');
      expect(config.embeddingDimensions).toBe(1536);
      expect(config.searchDefaultLimit).toBe(10);
      expect(config.searchMaxLimit).toBe(50);
      expect(config.forgetTTL.working).toBe(48);
      expect(config.logLevel).toBe('info');
      expect(config.nodeEnv).toBe('development');
    });

    it('선택적 필드 없이 MementoConfig를 생성할 수 있어야 함', () => {
      const config: MementoConfig = {
        dbPath: './data/memory.db',
        serverName: 'memento-memory',
        serverVersion: '1.0.0',
        port: 3000,
        embeddingProvider: 'lightweight',
        embeddingDimensions: 512,
        searchDefaultLimit: 10,
        searchMaxLimit: 50,
        forgetTTL: {
          working: 48,
          episodic: 2160,
          semantic: -1,
          procedural: -1
        },
        logLevel: 'info',
        nodeEnv: 'development'
      };

      expect(config.openaiApiKey).toBeUndefined();
      expect(config.geminiApiKey).toBeUndefined();
      expect(config.logFile).toBeUndefined();
    });
  });

  describe('Error Classes', () => {
    it('MementoError가 올바르게 작동해야 함', () => {
      const error = new MementoError('Test error', 'TEST_ERROR');
      
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(MementoError);
      expect(error.message).toBe('Test error');
      expect(error.code).toBe('TEST_ERROR');
      expect(error.name).toBe('MementoError');
    });

    it('ConnectionError가 올바르게 작동해야 함', () => {
      const error = new ConnectionError('Connection failed');
      
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(MementoError);
      expect(error.message).toBe('Connection failed');
      expect(error.code).toBe('CONNECTION_ERROR');
      expect(error.name).toBe('ConnectionError');
    });

    it('AuthenticationError가 올바르게 작동해야 함', () => {
      const error = new AuthenticationError('Invalid API key');
      
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(MementoError);
      expect(error.message).toBe('Invalid API key');
      expect(error.code).toBe('AUTHENTICATION_ERROR');
      expect(error.name).toBe('AuthenticationError');
    });

    it('ValidationError가 올바르게 작동해야 함', () => {
      const error = new ValidationError('Invalid input data');
      
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(MementoError);
      expect(error.message).toBe('Invalid input data');
      expect(error.code).toBe('VALIDATION_ERROR');
      expect(error.name).toBe('ValidationError');
    });

    it('NotFoundError가 올바르게 작동해야 함', () => {
      const error = new NotFoundError('Memory not found');
      
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(MementoError);
      expect(error.message).toBe('Memory not found');
      expect(error.code).toBe('NOT_FOUND_ERROR');
      expect(error.name).toBe('NotFoundError');
    });

    it('에러 클래스들이 올바른 상속 관계를 가져야 함', () => {
      const connectionError = new ConnectionError('test');
      const authError = new AuthenticationError('test');
      const validationError = new ValidationError('test');
      const notFoundError = new NotFoundError('test');

      expect(connectionError).toBeInstanceOf(MementoError);
      expect(authError).toBeInstanceOf(MementoError);
      expect(validationError).toBeInstanceOf(MementoError);
      expect(notFoundError).toBeInstanceOf(MementoError);
    });
  });

  describe('타입 호환성', () => {
    it('MemoryType이 올바른 타입이어야 함', () => {
      const working: MemoryType = 'working';
      const episodic: MemoryType = 'episodic';
      const semantic: MemoryType = 'semantic';
      const procedural: MemoryType = 'procedural';

      expect(typeof working).toBe('string');
      expect(typeof episodic).toBe('string');
      expect(typeof semantic).toBe('string');
      expect(typeof procedural).toBe('string');
    });

    it('PrivacyScope이 올바른 타입이어야 함', () => {
      const private: PrivacyScope = 'private';
      const team: PrivacyScope = 'team';
      const public: PrivacyScope = 'public';

      expect(typeof private).toBe('string');
      expect(typeof team).toBe('string');
      expect(typeof public).toBe('string');
    });

    it('EmbeddingProvider이 올바른 타입이어야 함', () => {
      const openai: EmbeddingProvider = 'openai';
      const gemini: EmbeddingProvider = 'gemini';
      const lightweight: EmbeddingProvider = 'lightweight';

      expect(typeof openai).toBe('string');
      expect(typeof gemini).toBe('string');
      expect(typeof lightweight).toBe('string');
    });
  });

  describe('인터페이스 구조', () => {
    it('MemoryItem이 올바른 구조를 가져야 함', () => {
      const memory: MemoryItem = {
        id: 'test',
        type: 'episodic',
        content: 'test',
        importance: 0.5,
        privacy_scope: 'private',
        created_at: new Date(),
        pinned: false
      };

      expect(memory).toHaveProperty('id');
      expect(memory).toHaveProperty('type');
      expect(memory).toHaveProperty('content');
      expect(memory).toHaveProperty('importance');
      expect(memory).toHaveProperty('privacy_scope');
      expect(memory).toHaveProperty('created_at');
      expect(memory).toHaveProperty('pinned');
    });

    it('MementoConfig가 올바른 구조를 가져야 함', () => {
      const config: MementoConfig = {
        dbPath: './test.db',
        serverName: 'test',
        serverVersion: '1.0.0',
        port: 3000,
        embeddingProvider: 'lightweight',
        embeddingDimensions: 512,
        searchDefaultLimit: 10,
        searchMaxLimit: 50,
        forgetTTL: {
          working: 48,
          episodic: 2160,
          semantic: -1,
          procedural: -1
        },
        logLevel: 'info',
        nodeEnv: 'test'
      };

      expect(config).toHaveProperty('dbPath');
      expect(config).toHaveProperty('serverName');
      expect(config).toHaveProperty('serverVersion');
      expect(config).toHaveProperty('port');
      expect(config).toHaveProperty('embeddingProvider');
      expect(config).toHaveProperty('embeddingDimensions');
      expect(config).toHaveProperty('searchDefaultLimit');
      expect(config).toHaveProperty('searchMaxLimit');
      expect(config).toHaveProperty('forgetTTL');
      expect(config).toHaveProperty('logLevel');
      expect(config).toHaveProperty('nodeEnv');
    });
  });
});
