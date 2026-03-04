import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { EmbeddingProvider } from '../../../shared/types/embedding.types.js';
import { ModelAvailabilityService } from '../model-availability-service.js';
import type { ProviderHealthStatus } from '../../../shared/types/embedding-provider-monitoring.types.js';

type MockService = {
  generateEmbedding: ReturnType<typeof vi.fn>;
  isAvailable: ReturnType<typeof vi.fn>;
};

function createMockService(): MockService {
  return {
    generateEmbedding: vi.fn(),
    isAvailable: vi.fn().mockReturnValue(true)
  };
}

describe('ModelAvailabilityService', () => {
  let services: Map<EmbeddingProvider, MockService>;
  let service: ModelAvailabilityService;

  beforeEach(() => {
    services = new Map();
    const resolver = (provider: EmbeddingProvider) => services.get(provider) ?? null;
    const priority = () => Array.from(services.keys());
    service = new ModelAvailabilityService(resolver, priority);
  });

  it('returns available status when provider responds', async () => {
    const mock = createMockService();
    mock.generateEmbedding.mockResolvedValue({ embedding: [0, 1], provider: 'minilm', model: 'mock' });
    services.set('minilm', mock as any);

    const status = await service.checkProviderHealth('minilm');
    expect(status.state).toBe('available');
    expect(status.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('marks provider unavailable when health check fails', async () => {
    const mock = createMockService();
    mock.isAvailable.mockReturnValue(true);
    mock.generateEmbedding.mockRejectedValue(new Error('network error'));
    services.set('openai', mock as any);

    const status = await service.checkProviderHealth('openai');
    expect(status.state).toBe('unavailable');
    expect(status.message).toContain('network error');
  });

  it('selects fallback provider when preferred is unavailable', async () => {
    const primary = createMockService();
    primary.generateEmbedding.mockRejectedValue(new Error('primary down'));
    services.set('openai', primary as any);

    const secondary = createMockService();
    secondary.generateEmbedding.mockResolvedValue({ embedding: [0], provider: 'minilm', model: 'mock' });
    services.set('minilm', secondary as any);

    const decision = await service.selectBestProvider('openai');
    expect(decision.selectedProvider).toBe('minilm');
    expect(decision.attemptedProviders).toHaveLength(2);
    expect(decision.attemptedProviders[0].state).toBe('unavailable');
    expect(decision.attemptedProviders[1].state).toBe('available');
  });

  it('broadcasts health status updates to subscribers', async () => {
    const mock = createMockService();
    mock.generateEmbedding.mockResolvedValue({ embedding: [0], provider: 'openai', model: 'mock' });
    services.set('openai', mock as any);

    const listener = vi.fn();
    service.subscribe(listener);

    await service.checkProviderHealth('openai');
    expect(listener).toHaveBeenCalled();
    const lastCall: ProviderHealthStatus = listener.mock.calls.at(-1)[0];
    expect(lastCall.provider).toBe('openai');
    expect(lastCall.state).toBe('available');
  });
});
