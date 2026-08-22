import { EventEmitter } from 'node:events';
import type { AlertEvent } from '../../../shared/types/alerts.types.js';

const ALERT_EMITTER_EVENT = 'alert';

export interface AlertDelivery {
  id: string;
  createdAt: Date;
  acknowledged: boolean;
}

export class AlertNotificationService {
  private readonly emitter = new EventEmitter();
  private readonly deliveries: Map<string, AlertDelivery> = new Map();

  emitAlert(
    event: Omit<AlertEvent, 'createdAt' | 'acknowledged'> & { createdAt?: Date; acknowledged?: boolean }
  ): AlertEvent {
    const withDefaults: AlertEvent = {
      ...event,
      createdAt: event.createdAt ?? new Date(),
      acknowledged: event.acknowledged ?? false
    };
    this.deliveries.set(withDefaults.id, {
      id: withDefaults.id,
      createdAt: withDefaults.createdAt,
      acknowledged: withDefaults.acknowledged
    });
    this.emitter.emit(ALERT_EMITTER_EVENT, withDefaults);
    return withDefaults;
  }

  getAlerts(): AlertDelivery[] {
    return Array.from(this.deliveries.values()).sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
    );
  }

  getActiveAlerts(): AlertDelivery[] {
    return this.getAlerts().filter(delivery => !delivery.acknowledged);
  }

  acknowledgeAlert(alertId: string): boolean {
    const delivery = this.deliveries.get(alertId);
    if (!delivery) {
      return false;
    }
    if (!delivery.acknowledged) {
      delivery.acknowledged = true;
    }
    return true;
  }

  removeAlert(alertId: string): boolean {
    return this.deliveries.delete(alertId);
  }

  subscribe(listener: (event: AlertEvent) => void): () => void {
    this.emitter.on(ALERT_EMITTER_EVENT, listener);
    return () => {
      this.emitter.off(ALERT_EMITTER_EVENT, listener);
    };
  }

  clear(): void {
    this.deliveries.clear();
  }
}

export const alertNotificationService = new AlertNotificationService();
