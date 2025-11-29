import type { EmbeddingProvider } from './embedding.types.js';

export type ProviderAvailabilityState = 'available' | 'degraded' | 'unavailable';

export interface ProviderHealthStatus {
  provider: EmbeddingProvider;
  state: ProviderAvailabilityState;
  latencyMs?: number;
  lastCheckedAt: Date;
  message?: string;
}

export interface ProviderFallbackDecision {
  selectedProvider: EmbeddingProvider;
  reason: string;
  attemptedProviders: Array<{
    provider: EmbeddingProvider;
    state: ProviderAvailabilityState;
    error?: string;
  }>;
}

export interface ProviderHealthCheckOptions {
  timeoutMs?: number;
  sampleText?: string;
  onProgress?: (status: ProviderHealthStatus) => void;
}
