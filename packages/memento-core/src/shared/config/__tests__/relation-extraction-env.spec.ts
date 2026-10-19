import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('LLM_PROVIDER_RELATION_EXTRACTION config load', () => {
  it('stores jev on the seat and leaves llmProviderOverrides unset', async () => {
    vi.resetModules();
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    vi.stubEnv('LLM_PROVIDER_RELATION_EXTRACTION', 'jev');
    const { mementoConfig } = await import('../index.js');

    expect(mementoConfig.relationExtractionOverride).toEqual({ kind: 'jev' });
    expect(mementoConfig.llmProviderOverrides.relation_extraction).toBeUndefined();
    expect(stderr).not.toHaveBeenCalled();
    stderr.mockRestore();
  });

  it('copies a chat override into llmProviderOverrides', async () => {
    vi.resetModules();
    vi.stubEnv('LLM_PROVIDER_RELATION_EXTRACTION', 'ollama');
    const { mementoConfig } = await import('../index.js');

    expect(mementoConfig.relationExtractionOverride).toEqual({ kind: 'chat', provider: 'ollama' });
    expect(mementoConfig.llmProviderOverrides.relation_extraction).toBe('ollama');
  });

  it('warns once and does not copy an invalid token', async () => {
    vi.resetModules();
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    vi.stubEnv('LLM_PROVIDER_RELATION_EXTRACTION', 'anthropic');
    const { mementoConfig } = await import('../index.js');

    expect(mementoConfig.relationExtractionOverride).toEqual({ kind: 'invalid', raw: 'anthropic' });
    expect(mementoConfig.llmProviderOverrides.relation_extraction).toBeUndefined();
    expect(stderr).toHaveBeenCalledTimes(1);
    stderr.mockRestore();
  });

  it('still rejects jev on the procedural key', async () => {
    vi.resetModules();
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    vi.stubEnv('LLM_PROVIDER_PROCEDURAL', 'jev');
    vi.stubEnv('LLM_PROVIDER_RELATION_EXTRACTION', '');
    const { mementoConfig } = await import('../index.js');

    expect(mementoConfig.llmProviderOverrides.procedural).toBeUndefined();
    expect(mementoConfig.relationExtractionOverride).toEqual({ kind: 'unset' });
    expect(String(stderr.mock.calls[0]?.[0])).toContain('LLM_PROVIDER_PROCEDURAL');
    expect(String(stderr.mock.calls[0]?.[0])).toContain('jev');
    stderr.mockRestore();
  });
});
