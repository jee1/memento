import type { EmbeddingProvider } from './embedding.types.js';

export type AlertSeverity = 'info' | 'warning' | 'critical';
export type AlertSource = 'performance' | 'model-availability' | 'system';

export interface AlertEvent {
  id: string;
  source: AlertSource;
  severity: AlertSeverity;
  message: string;
  createdAt: Date;
  metadata?: Record<string, unknown>;
  acknowledged: boolean;
}

export interface PerformanceAlertEvent extends AlertEvent {
  source: 'performance';
  metrics: {
    type: string;
    value: number;
    threshold: number;
  };
}

export interface ProviderAlertEvent extends AlertEvent {
  source: 'model-availability';
  provider: EmbeddingProvider;
  state: 'available' | 'unavailable';
}
