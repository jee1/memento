import { describe, it, expect, vi } from 'vitest';
import type { MementoConfig } from '../shared/types/types/index.js';
import { validateConfiguration } from './configuration-validator.js';

const baseConfig: MementoConfig = {
  dbPath: './data/memory.db',
  serverName: 'memento',
  serverVersion: '1.0.0',
  port: 8080,
  embeddingProvider: 'minilm',
  openaiApiKey: undefined,
  openaiModel: 'text-embedding-3-small',
  geminiApiKey: undefined,
  geminiModel: 'text-embedding-004',
  embeddingDimensions: 384,
  searchDefaultLimit: 10,
  searchMaxLimit: 50,
  forgetTTL: {
    working: 48,
    episodic: 2160,
    semantic: -1,
    procedural: -1
  },
  logLevel: 'info',
  logFile: undefined,
  nodeEnv: 'test'
};

describe('configuration-validator', () => {
  it('returns valid result for minimal config', () => {
    const result = validateConfiguration(baseConfig, { throwOnError: false, logger: { warn: vi.fn(), error: vi.fn() } });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('detects missing API key for OpenAI provider', () => {
    const config: MementoConfig = {
      ...baseConfig,
      embeddingProvider: 'openai',
      openaiApiKey: ''
    };

    const logger = { warn: vi.fn(), error: vi.fn() };
    const result = validateConfiguration(config, { throwOnError: false, logger });

    expect(result.valid).toBe(false);
    expect(result.errors.some(err => err.code === 'PROVIDER_API_KEY_MISSING')).toBe(true);
    expect(logger.error).toHaveBeenCalled();
  });

  it('emits warning when dimensions mismatch provider default', () => {
    const config: MementoConfig = {
      ...baseConfig,
      embeddingDimensions: 512
    };
    const logger = { warn: vi.fn(), error: vi.fn() };
    const result = validateConfiguration(config, { throwOnError: false, logger });

    expect(result.valid).toBe(true);
    const warning = result.warnings.find(w => w.code === 'EMBEDDING_DIMENSIONS_MISMATCH');
    expect(warning).toBeDefined();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('emits warning when PORT and MCP_SERVER_PORT differ', () => {
    const prevPort = process.env.PORT;
    const prevMcpPort = process.env.MCP_SERVER_PORT;
    process.env.PORT = '3000';
    process.env.MCP_SERVER_PORT = '4000';

    const logger = { warn: vi.fn(), error: vi.fn() };
    try {
      const result = validateConfiguration(baseConfig, { throwOnError: false, logger });
      const warning = result.warnings.find(w => w.code === 'PORT_MISMATCH');
      expect(warning).toBeDefined();
      expect(logger.warn).toHaveBeenCalled();
    } finally {
      if (prevPort === undefined) {
        delete process.env.PORT;
      } else {
        process.env.PORT = prevPort;
      }
      if (prevMcpPort === undefined) {
        delete process.env.MCP_SERVER_PORT;
      } else {
        process.env.MCP_SERVER_PORT = prevMcpPort;
      }
    }
  });

  it('emits warning when production log level is too verbose', () => {
    const config: MementoConfig = {
      ...baseConfig,
      nodeEnv: 'production',
      logLevel: 'debug'
    };
    const logger = { warn: vi.fn(), error: vi.fn() };
    const result = validateConfiguration(config, { throwOnError: false, logger });

    const warning = result.warnings.find(w => w.code === 'LOG_LEVEL_VERBOSE_IN_PRODUCTION');
    expect(warning).toBeDefined();
    expect(logger.warn).toHaveBeenCalled();
  });
});
