
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
