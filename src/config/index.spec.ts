import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { mementoConfig, searchRankingWeights, defaultTags, validateConfig } from './index.js';

// Mock dotenv
vi.mock('dotenv', () => ({
  config: vi.fn()
}));

describe('Config', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('mementoConfig', () => {
    it('기본 설정값을 가져야 함', () => {
      // 환경 변수 초기화
      process.env = {};

      // 모듈을 다시 로드하여 기본값 테스트
      vi.resetModules();
      const { mementoConfig: config } = require('./index.js');

      expect(config.dbPath).toBe('./data/memory.db');
      expect(config.serverName).toBe('memento-memory');
      expect(config.serverVersion).toBe('0.1.0');
      expect(config.port).toBe(3000);
      expect(config.embeddingProvider).toBe('openai');
      expect(config.embeddingDimensions).toBe(1536);
      expect(config.searchDefaultLimit).toBe(10);
      expect(config.searchMaxLimit).toBe(50);
      expect(config.logLevel).toBe('info');
      expect(config.nodeEnv).toBe('development');
    });

    it('환경 변수에서 설정값을 읽어야 함', () => {
      process.env = {
        DB_PATH: '/custom/db/path',
        MCP_SERVER_NAME: 'custom-server',
        MCP_SERVER_VERSION: '1.0.0',
        MCP_SERVER_PORT: '8080',
        EMBEDDING_PROVIDER: 'gemini',
        OPENAI_API_KEY: 'test-openai-key',
        GEMINI_API_KEY: 'test-gemini-key',
        EMBEDDING_DIMENSIONS: '768',
        SEARCH_DEFAULT_LIMIT: '20',
        SEARCH_MAX_LIMIT: '100',
        LOG_LEVEL: 'debug',
        NODE_ENV: 'production'
      };

      vi.resetModules();
      const { mementoConfig: config } = require('./index.js');

      expect(config.dbPath).toBe('/custom/db/path');
      expect(config.serverName).toBe('custom-server');
      expect(config.serverVersion).toBe('1.0.0');
      expect(config.port).toBe(8080);
      expect(config.embeddingProvider).toBe('gemini');
      expect(config.openaiApiKey).toBe('test-openai-key');
      expect(config.geminiApiKey).toBe('test-gemini-key');
      expect(config.embeddingDimensions).toBe(768);
      expect(config.searchDefaultLimit).toBe(20);
      expect(config.searchMaxLimit).toBe(100);
      expect(config.logLevel).toBe('debug');
      expect(config.nodeEnv).toBe('production');
    });

    it('망각 TTL 설정을 올바르게 가져야 함', () => {
      process.env = {
        FORGET_WORKING_TTL: '24',
        FORGET_EPISODIC_TTL: '720', // 30일
        FORGET_SEMANTIC_TTL: '-1',
        FORGET_PROCEDURAL_TTL: '-1'
      };

      vi.resetModules();
      const { mementoConfig: config } = require('./index.js');

      expect(config.forgetTTL.working).toBe(24);
      expect(config.forgetTTL.episodic).toBe(720);
      expect(config.forgetTTL.semantic).toBe(-1);
      expect(config.forgetTTL.procedural).toBe(-1);
    });

    it('기본 망각 TTL 설정을 가져야 함', () => {
      process.env = {};

      vi.resetModules();
      const { mementoConfig: config } = require('./index.js');

      expect(config.forgetTTL.working).toBe(48);
      expect(config.forgetTTL.episodic).toBe(2160); // 90일
      expect(config.forgetTTL.semantic).toBe(-1);
      expect(config.forgetTTL.procedural).toBe(-1);
    });
  });

  describe('searchRankingWeights', () => {
    it('올바른 검색 랭킹 가중치를 가져야 함', () => {
      expect(searchRankingWeights.relevance).toBe(0.50);
      expect(searchRankingWeights.recency).toBe(0.20);
      expect(searchRankingWeights.importance).toBe(0.20);
      expect(searchRankingWeights.usage).toBe(0.10);
      expect(searchRankingWeights.duplication_penalty).toBe(0.15);
    });

    it('가중치의 합이 1에 가까워야 함', () => {
      const sum = Object.values(searchRankingWeights).reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(1, 2);
    });
  });

  describe('defaultTags', () => {
    it('기본 태그 분류를 가져야 함', () => {
      expect(defaultTags.tech).toContain('javascript');
      expect(defaultTags.tech).toContain('typescript');
      expect(defaultTags.tech).toContain('react');
      expect(defaultTags.pref).toContain('coffee');
      expect(defaultTags.pref).toContain('tea');
      expect(defaultTags.task).toContain('bug-fix');
      expect(defaultTags.task).toContain('feature');
      expect(defaultTags.project).toContain('memento');
    });

    it('각 카테고리가 배열이어야 함', () => {
      expect(Array.isArray(defaultTags.tech)).toBe(true);
      expect(Array.isArray(defaultTags.pref)).toBe(true);
      expect(Array.isArray(defaultTags.task)).toBe(true);
      expect(Array.isArray(defaultTags.project)).toBe(true);
    });
  });

  describe('validateConfig', () => {
    it('유효한 설정에 대해 에러를 던지지 않아야 함', () => {
      process.env = {
        EMBEDDING_PROVIDER: 'openai',
        OPENAI_API_KEY: 'test-key',
        EMBEDDING_DIMENSIONS: '1536',
        SEARCH_DEFAULT_LIMIT: '10',
        SEARCH_MAX_LIMIT: '50'
      };

      vi.resetModules();
      const { validateConfig: validate } = require('./index.js');

      expect(() => validate()).not.toThrow();
    });

    it('OpenAI 제공자에 API 키가 없으면 에러를 던져야 함', () => {
      process.env = {
        EMBEDDING_PROVIDER: 'openai',
        OPENAI_API_KEY: '',
        EMBEDDING_DIMENSIONS: '1536',
        SEARCH_DEFAULT_LIMIT: '10',
        SEARCH_MAX_LIMIT: '50'
      };

      vi.resetModules();
      const { validateConfig: validate } = require('./index.js');

      expect(() => validate()).toThrow('OPENAI_API_KEY is required when using OpenAI embedding provider');
    });

    it('Gemini 제공자에 API 키가 없으면 에러를 던져야 함', () => {
      process.env = {
        EMBEDDING_PROVIDER: 'gemini',
        GEMINI_API_KEY: '',
        EMBEDDING_DIMENSIONS: '768',
        SEARCH_DEFAULT_LIMIT: '10',
        SEARCH_MAX_LIMIT: '50'
      };

      vi.resetModules();
      const { validateConfig: validate } = require('./index.js');

      expect(() => validate()).toThrow('GEMINI_API_KEY is required when using Gemini embedding provider');
    });

    it('프로덕션 환경에서 OpenAI API 키가 없으면 에러를 던져야 함', () => {
      process.env = {
        EMBEDDING_PROVIDER: 'openai',
        OPENAI_API_KEY: '',
        NODE_ENV: 'production',
        EMBEDDING_DIMENSIONS: '1536',
        SEARCH_DEFAULT_LIMIT: '10',
        SEARCH_MAX_LIMIT: '50'
      };

      vi.resetModules();
      const { validateConfig: validate } = require('./index.js');

      expect(() => validate()).toThrow('OPENAI_API_KEY is required in production environment');
    });

    it('임베딩 차원이 0 이하면 에러를 던져야 함', () => {
      process.env = {
        EMBEDDING_PROVIDER: 'openai',
        OPENAI_API_KEY: 'test-key',
        EMBEDDING_DIMENSIONS: '0',
        SEARCH_DEFAULT_LIMIT: '10',
        SEARCH_MAX_LIMIT: '50'
      };

      vi.resetModules();
      const { validateConfig: validate } = require('./index.js');

      expect(() => validate()).toThrow('EMBEDDING_DIMENSIONS must be a positive number');
    });

    it('검색 제한이 0 이하면 에러를 던져야 함', () => {
      process.env = {
        EMBEDDING_PROVIDER: 'openai',
        OPENAI_API_KEY: 'test-key',
        EMBEDDING_DIMENSIONS: '1536',
        SEARCH_DEFAULT_LIMIT: '0',
        SEARCH_MAX_LIMIT: '50'
      };

      vi.resetModules();
      const { validateConfig: validate } = require('./index.js');

      expect(() => validate()).toThrow('Search limits must be positive numbers');
    });

    it('기본 검색 제한이 최대 검색 제한보다 크면 에러를 던져야 함', () => {
      process.env = {
        EMBEDDING_PROVIDER: 'openai',
        OPENAI_API_KEY: 'test-key',
        EMBEDDING_DIMENSIONS: '1536',
        SEARCH_DEFAULT_LIMIT: '100',
        SEARCH_MAX_LIMIT: '50'
      };

      vi.resetModules();
      const { validateConfig: validate } = require('./index.js');

      expect(() => validate()).toThrow('SEARCH_DEFAULT_LIMIT cannot be greater than SEARCH_MAX_LIMIT');
    });

    it('경량 임베딩 제공자는 API 키 없이도 통과해야 함', () => {
      process.env = {
        EMBEDDING_PROVIDER: 'lightweight',
        EMBEDDING_DIMENSIONS: '512',
        SEARCH_DEFAULT_LIMIT: '10',
        SEARCH_MAX_LIMIT: '50'
      };

      vi.resetModules();
      const { validateConfig: validate } = require('./index.js');

      expect(() => validate()).not.toThrow();
    });
  });

  describe('환경 변수 파싱', () => {
    it('포트 번호를 올바르게 파싱해야 함', () => {
      process.env.MCP_SERVER_PORT = '8080';

      vi.resetModules();
      const { mementoConfig: config } = require('./index.js');

      expect(config.port).toBe(8080);
      expect(typeof config.port).toBe('number');
    });

    it('잘못된 포트 번호에 대해 NaN을 처리해야 함', () => {
      process.env.MCP_SERVER_PORT = 'invalid';

      vi.resetModules();
      const { mementoConfig: config } = require('./index.js');

      expect(Number.isNaN(config.port)).toBe(true);
    });

    it('숫자 설정값들을 올바르게 파싱해야 함', () => {
      process.env = {
        EMBEDDING_DIMENSIONS: '768',
        SEARCH_DEFAULT_LIMIT: '20',
        SEARCH_MAX_LIMIT: '100',
        FORGET_WORKING_TTL: '24'
      };

      vi.resetModules();
      const { mementoConfig: config } = require('./index.js');

      expect(config.embeddingDimensions).toBe(768);
      expect(config.searchDefaultLimit).toBe(20);
      expect(config.searchMaxLimit).toBe(100);
      expect(config.forgetTTL.working).toBe(24);
    });

    it('빈 문자열에 대해 기본값을 사용해야 함', () => {
      process.env = {
        DB_PATH: '',
        MCP_SERVER_NAME: '',
        LOG_LEVEL: ''
      };

      vi.resetModules();
      const { mementoConfig: config } = require('./index.js');

      expect(config.dbPath).toBe('./data/memory.db');
      expect(config.serverName).toBe('memento-memory');
      expect(config.logLevel).toBe('info');
    });
  });

  describe('설정 객체 구조', () => {
    it('mementoConfig가 올바른 구조를 가져야 함', () => {
      expect(mementoConfig).toHaveProperty('dbPath');
      expect(mementoConfig).toHaveProperty('serverName');
      expect(mementoConfig).toHaveProperty('serverVersion');
      expect(mementoConfig).toHaveProperty('port');
      expect(mementoConfig).toHaveProperty('embeddingProvider');
      expect(mementoConfig).toHaveProperty('openaiApiKey');
      expect(mementoConfig).toHaveProperty('geminiApiKey');
      expect(mementoConfig).toHaveProperty('embeddingDimensions');
      expect(mementoConfig).toHaveProperty('searchDefaultLimit');
      expect(mementoConfig).toHaveProperty('searchMaxLimit');
      expect(mementoConfig).toHaveProperty('forgetTTL');
      expect(mementoConfig).toHaveProperty('logLevel');
      expect(mementoConfig).toHaveProperty('nodeEnv');
    });

    it('forgetTTL이 올바른 구조를 가져야 함', () => {
      expect(mementoConfig.forgetTTL).toHaveProperty('working');
      expect(mementoConfig.forgetTTL).toHaveProperty('episodic');
      expect(mementoConfig.forgetTTL).toHaveProperty('semantic');
      expect(mementoConfig.forgetTTL).toHaveProperty('procedural');
    });
  });
});
