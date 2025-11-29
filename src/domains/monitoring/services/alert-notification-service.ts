import { EventEmitter } from 'node:events';
import type { AlertEvent, AlertSeverity, AlertSource } from '../../../shared/types/alerts.types.js';

const ALERT_EMITTER_EVENT = 'alert';

export class AlertNotificationService {
  private readonly emitter = new EventEmitter();
  private readonly alerts: Map<string, AlertEvent> = new Map();

  emitAlert(
    event: Omit<AlertEvent, 'createdAt' | 'acknowledged'> & { createdAt?: Date; acknowledged?: boolean }
  ): AlertEvent {
    const withDefaults: AlertEvent = {
      ...event,
      createdAt: event.createdAt ?? new Date(),
      acknowledged: event.acknowledged ?? false
    };
    this.alerts.set(withDefaults.id, withDefaults);
    this.emitter.emit(ALERT_EMITTER_EVENT, withDefaults);
    return withDefaults;
  }

  getAlerts(): AlertEvent[] {
    return Array.from(this.alerts.values()).sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
    );
  }

  getActiveAlerts(): AlertEvent[] {
    return this.getAlerts().filter(alert => !alert.acknowledged);
  }

  acknowledgeAlert(alertId: string): boolean {
    const alert = this.alerts.get(alertId);
    if (!alert) {
      return false;
    }
    if (!alert.acknowledged) {
      alert.acknowledged = true;
      this.alerts.set(alertId, alert);
    }
    return true;
  }

  subscribe(listener: (event: AlertEvent) => void): () => void {
    this.emitter.on(ALERT_EMITTER_EVENT, listener);
    return () => {
      this.emitter.off(ALERT_EMITTER_EVENT, listener);
    };
  }

  clear(): void {
    this.alerts.clear();
  }
}

export const alertNotificationService = new AlertNotificationService();
