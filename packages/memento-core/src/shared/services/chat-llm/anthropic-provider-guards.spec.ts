import { afterEach, describe, expect, it } from 'vitest';
import { mementoConfig, resolveSupersedeMaxPairs } from '../../config/index.js';
import { determinePreferredProvider } from '../llm-client-initializer/provider-resolution.js';
import { SummarizationService } from '../../../domains/consolidation/services/summarization-service.js';
import { SETTING_REGISTRY, normalizeSettingValue } from '../../../domains/settings/settings-registry.js';

/** #1840: anthropic 은 기존 채팅 경로(초기화기, 요약)가 다른 제공자로 받아 가지 않는다. */
describe('anthropic 경계 (#1840)', () => {
  const savedPairs = process.env.SUPERSEDE_CANDIDATE_SCAN_MAX_PAIRS;
  afterEach(() => {
    if (savedPairs === undefined) delete process.env.SUPERSEDE_CANDIDATE_SCAN_MAX_PAIRS;
    else process.env.SUPERSEDE_CANDIDATE_SCAN_MAX_PAIRS = savedPairs;
  });

  it('초기화기는 anthropic 일 때 OpenAI, Gemini 클라이언트가 있어도 고르지 않는다', () => {
    const clients = {
      preferredProvider: null,
      openaiClient: {} as never,
      geminiClient: {} as never,
      initializedProviders: ['openai', 'gemini'],
      warnings: [],
    };
    expect(determinePreferredProvider(clients, 'anthropic')).toBeNull();
    expect(determinePreferredProvider(clients, 'auto')).toBe('openai');
  });

  it('요약은 anthropic 을 미설정으로 본다(실패로 세지 않는다)', () => {
    process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? 'test-gemini';
    const summarizer = new SummarizationService({ ...mementoConfig, llmProvider: 'anthropic', llmProviderOverrides: {} });
    expect(summarizer.hasLlmConfigured()).toBe(false);
  });

  it('쌍 상한은 1~200 정수 글자만 받는다', () => {
    const read = (value: string) => {
      process.env.SUPERSEDE_CANDIDATE_SCAN_MAX_PAIRS = value;
      return resolveSupersedeMaxPairs();
    };
    expect(['1.9', '20abc', '0', '201', ' 7 ', '200'].map(read)).toEqual([20, 20, 20, 20, 7, 200]);

    const definition = SETTING_REGISTRY.get('SUPERSEDE_CANDIDATE_SCAN_MAX_PAIRS')!;
    expect(normalizeSettingValue(definition, '1.9')).toHaveProperty('message');
    expect(normalizeSettingValue(definition, '20')).toEqual({ value: '20' });
  });
});
