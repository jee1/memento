import http from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { mementoConfig } from '../shared/config/index.js';
import { validateConfiguration } from '../shared/utils/configuration-validator.js';
import {
  assertAllowedNetworkEgress,
  ExternalNetworkEgressForbiddenError,
  installNetworkGuard,
  isLocalHost,
} from '../shared/utils/network-guard.js';
import { EmbeddingProviderFactory } from '../domains/embedding/providers/embedding-provider-factory.js';
import { LLMClientInitializer } from '../shared/services/llm-client-initializer.js';

describe('offline-strict-mode unit tests', () => {
  const originalOffline = mementoConfig.offlineStrict;
  const originalEmbeddingProvider = mementoConfig.embeddingProvider;
  const originalLlmProvider = mementoConfig.llmProvider;
  const originalRejectionGate = mementoConfig.searchRejectionGate;

  beforeEach(() => {
    mementoConfig.offlineStrict = true;
    mementoConfig.embeddingProvider = 'minilm';
    mementoConfig.llmProvider = 'auto';
    mementoConfig.searchRejectionGate = 'off';
  });

  afterEach(() => {
    mementoConfig.offlineStrict = originalOffline;
    mementoConfig.embeddingProvider = originalEmbeddingProvider;
    mementoConfig.llmProvider = originalLlmProvider;
    mementoConfig.searchRejectionGate = originalRejectionGate;
  });

  describe('configuration validator', () => {
    it('passes when local providers are used with offline strict', () => {
      const result = validateConfiguration(mementoConfig, { throwOnError: false });
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('rejects remote embedding provider openai', () => {
      mementoConfig.embeddingProvider = 'openai';
      mementoConfig.openaiApiKey = 'sk-test';

      expect(() => validateConfiguration(mementoConfig, { throwOnError: true })).toThrow(
        /remote provider openai is forbidden in offline strict mode/,
      );
    });

    it('rejects remote embedding provider gemini', () => {
      mementoConfig.embeddingProvider = 'gemini';
      mementoConfig.geminiApiKey = 'test-key';

      expect(() => validateConfiguration(mementoConfig, { throwOnError: true })).toThrow(
        /remote provider gemini is forbidden in offline strict mode/,
      );
    });

    it('rejects remote LLM provider openai', () => {
      mementoConfig.llmProvider = 'openai';

      expect(() => validateConfiguration(mementoConfig, { throwOnError: true })).toThrow(
        /remote provider openai is forbidden in offline strict mode/,
      );
    });

    it('rejects remote LLM provider anthropic', () => {
      (mementoConfig as any).llmProvider = 'anthropic';

      expect(() => validateConfiguration(mementoConfig, { throwOnError: true })).toThrow(
        /remote provider anthropic is forbidden in offline strict mode/,
      );
    });

    it('rejects remote search rejection gate typesafe', () => {
      mementoConfig.searchRejectionGate = 'typesafe';

      expect(() => validateConfiguration(mementoConfig, { throwOnError: true })).toThrow(
        /searchRejectionGate typesafe is forbidden in offline strict mode/,
      );
    });
  });

  describe('EmbeddingProviderFactory offline boundaries', () => {
    it('throws when requesting openai or gemini in offline mode', () => {
      const factory = EmbeddingProviderFactory.getInstance();
      expect(() => factory.selectProvider('openai')).toThrow(
        /remote provider openai is forbidden in offline strict mode/,
      );
      expect(() => factory.selectProvider('gemini')).toThrow(
        /remote provider gemini is forbidden in offline strict mode/,
      );
      expect(() => factory.getProvider('openai')).toThrow(
        /remote provider openai is forbidden in offline strict mode/,
      );
    });

    it('allows minilm and tfidf providers in offline mode', () => {
      const factory = EmbeddingProviderFactory.getInstance();
      const minilm = factory.getProvider('minilm');
      expect(minilm).not.toBeNull();
      const tfidf = factory.getProvider('tfidf');
      expect(tfidf).not.toBeNull();
    });
  });

  describe('LLMClientInitializer offline boundaries', () => {
    it('rejects initialization when LLM_PROVIDER is remote under offline strict', async () => {
      const originalEnv = process.env['LLM_PROVIDER'];
      try {
        process.env['LLM_PROVIDER'] = 'openai';
        const initializer = new LLMClientInitializer();
        await expect(initializer.initialize()).rejects.toThrow(
          /remote provider openai is forbidden in offline strict mode/,
        );
      } finally {
        if (originalEnv !== undefined) {
          process.env['LLM_PROVIDER'] = originalEnv;
        } else {
          delete process.env['LLM_PROVIDER'];
        }
      }
    });
  });

  describe('network guard', () => {
    it('correctly classifies loopback versus remote hosts', () => {
      expect(isLocalHost('localhost')).toBe(true);
      expect(isLocalHost('127.0.0.1')).toBe(true);
      expect(isLocalHost('127.0.1.1')).toBe(true);
      expect(isLocalHost('::1')).toBe(true);
      expect(isLocalHost('0.0.0.0')).toBe(true);
      expect(isLocalHost('/var/run/ollama.sock')).toBe(true);

      expect(isLocalHost('api.openai.com')).toBe(false);
      expect(isLocalHost('generativelanguage.googleapis.com')).toBe(false);
      expect(isLocalHost('192.168.1.1')).toBe(false);
    });

    it('assertAllowedNetworkEgress throws for remote destinations', () => {
      expect(() => assertAllowedNetworkEgress('localhost')).not.toThrow();
      expect(() => assertAllowedNetworkEgress('api.openai.com')).toThrow(
        ExternalNetworkEgressForbiddenError,
      );
    });

    it('installNetworkGuard intercepts external http.request', () => {
      const uninstall = installNetworkGuard();
      try {
        expect(() => {
          http.request('http://api.openai.com/v1/models');
        }).toThrow(ExternalNetworkEgressForbiddenError);
      } finally {
        uninstall();
      }
    });
  });
});
