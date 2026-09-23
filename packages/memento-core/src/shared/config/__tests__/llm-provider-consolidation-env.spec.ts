import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * #1126: `LLM_PROVIDER_CONSOLIDATION` 이 실제로 mementoConfig 까지 도달하는지 건다.
 *
 * 다른 테스트는 config 객체를 손으로 만들어 resolver 에 넘기므로, config/index.ts 의
 * 로딩 블록을 지워도 통과한다. 여기서만 env → config 경로가 검증된다.
 */

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('LLM_PROVIDER_CONSOLIDATION 이 mementoConfig 에 도달한다 (#1126)', () => {
  it('설정하면 llmProviderOverrides.consolidation 으로 들어온다', async () => {
    vi.resetModules();
    vi.stubEnv('LLM_PROVIDER_CONSOLIDATION', 'ollama');
    const { mementoConfig } = await import('../index.js');
    expect(mementoConfig.llmProviderOverrides.consolidation).toBe('ollama');
  });

  it('설정하지 않으면 undefined 다', async () => {
    vi.resetModules();
    vi.stubEnv('LLM_PROVIDER_CONSOLIDATION', '');
    const { mementoConfig } = await import('../index.js');
    expect(mementoConfig.llmProviderOverrides.consolidation).toBeUndefined();
  });
});
