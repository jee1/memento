import type { EmbeddingProvider } from '../../../../shared/types/embedding.types.js';
import type {
  ProviderFallbackDecision,
  ProviderHealthCheckOptions,
  ProviderHealthStatus
} from '../../../../shared/types/embedding-provider-monitoring.types.js';
import { alertNotificationService } from '../../../monitoring/services/alert-notification-service.js';

const DEFAULT_HEALTH_SAMPLE = 'System health check';

function now(): Date {
  return new Date();
}

export type ProviderResolver = (provider: EmbeddingProvider) => {
  generateEmbedding(text: string): Promise<unknown>;
  isAvailable(): boolean;
} | null;

export type ProviderPriorityResolver = () => EmbeddingProvider[];

export class ModelAvailabilityService {
  private readonly resolveProvider: ProviderResolver;
  private readonly resolvePriority: ProviderPriorityResolver;
  private readonly lastStatus: Map<EmbeddingProvider, ProviderHealthStatus> = new Map();
  private readonly subscribers: Set<(status: ProviderHealthStatus) => void> = new Set();

  constructor(resolveProvider: ProviderResolver, resolvePriority: ProviderPriorityResolver) {
    this.resolveProvider = resolveProvider;
    this.resolvePriority = resolvePriority;
  }

  async checkProviderHealth(
    provider: EmbeddingProvider,
    options: ProviderHealthCheckOptions = {}
  ): Promise<ProviderHealthStatus> {
    const sample = options.sampleText ?? DEFAULT_HEALTH_SAMPLE;
    const startedAt = Date.now();
    const previousStatus = this.lastStatus.get(provider);

    try {
      const service = this.resolveProvider(provider);
      if (!service || !service.isAvailable()) {
        throw new Error('Provider unavailable or not registered');
      }

      const timeout = options.timeoutMs && options.timeoutMs > 0 ? options.timeoutMs : undefined;
      if (timeout) {
        await Promise.race([
          service.generateEmbedding(sample),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Health check timeout')), timeout))
        ]);
      } else {
        await service.generateEmbedding(sample);
      }
      const status: ProviderHealthStatus = {
        provider,
        state: 'available',
        latencyMs: Date.now() - startedAt,
        lastCheckedAt: now()
      };
      this.lastStatus.set(provider, status);
      options.onProgress?.(status);
      this.broadcast(status);
      if (!previousStatus || previousStatus.state !== status.state) {
        alertNotificationService.emitAlert({
          id: `provider-${provider}-${Date.now()}`,
          source: 'model-availability',
          severity: 'info',
          message: `${provider} provider is available`,
          metadata: {
            provider,
            state: status.state,
            previousState: previousStatus?.state ?? 'unknown',
            latencyMs: status.latencyMs
          }
        });
      }
      return status;
    } catch (error) {
      const status: ProviderHealthStatus = {
        provider,
        state: 'unavailable',
        lastCheckedAt: now(),
        message: error instanceof Error ? error.message : 'Unknown error'
      };
      this.lastStatus.set(provider, status);
      options.onProgress?.(status);
      this.broadcast(status);
      if (!previousStatus || previousStatus.state !== status.state) {
        alertNotificationService.emitAlert({
          id: `provider-${provider}-${Date.now()}`,
          source: 'model-availability',
          severity: 'warning',
          message: `${provider} provider became unavailable` + (status.message ? `: ${status.message}` : ''),
          metadata: {
            provider,
            state: status.state,
            previousState: previousStatus?.state ?? 'unknown'
          }
        });
      }
      return status;
    }
  }

  getLastStatus(provider: EmbeddingProvider): ProviderHealthStatus | undefined {
    return this.lastStatus.get(provider);
  }

  getAllStatuses(): ProviderHealthStatus[] {
    return Array.from(this.lastStatus.values()).sort(
      (a, b) => a.provider.localeCompare(b.provider)
    );
  }

  subscribe(listener: (status: ProviderHealthStatus) => void): () => void {
    this.subscribers.add(listener);
    this.getAllStatuses().forEach(status => listener(status));
    return () => {
      this.subscribers.delete(listener);
    };
  }

  async selectBestProvider(
    preferredProvider?: EmbeddingProvider,
    options: ProviderHealthCheckOptions = {}
  ): Promise<ProviderFallbackDecision> {
    const attempted: ProviderFallbackDecision['attemptedProviders'] = [];

    const orderedProviders =
      preferredProvider !== undefined
        ? [preferredProvider, ...this.getPriorityList().filter(p => p !== preferredProvider)]
        : this.getPriorityList();

    if (orderedProviders.length === 0) {
      return {
        selectedProvider: preferredProvider ?? 'minilm',
        reason: 'no-registered-providers',
        attemptedProviders: []
      };
    }

    for (const provider of orderedProviders) {
      const status = await this.checkProviderHealth(provider, options);
      attempted.push({
        provider,
        state: status.state,
        error: status.state === 'unavailable' ? status.message : undefined
      });
      if (status.state === 'available') {
        return {
          selectedProvider: provider,
          reason: options.onProgress ? 'health-check-success' : 'default',
          attemptedProviders: attempted
        };
      }
    }

    return {
      selectedProvider: orderedProviders[0] ?? preferredProvider ?? 'minilm',
      reason: 'fallback-failed',
      attemptedProviders: attempted
    };
  }

  private getPriorityList(): EmbeddingProvider[] {
    return this.resolvePriority();
  }

  private broadcast(status: ProviderHealthStatus): void {
    for (const subscriber of this.subscribers) {
      subscriber(status);
    }
  }
}
