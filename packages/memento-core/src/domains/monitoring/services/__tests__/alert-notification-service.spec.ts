import { describe, it, expect, vi } from 'vitest';
import { AlertNotificationService } from '../alert-notification-service.js';

describe('AlertNotificationService', () => {
  it('stores alerts and notifies subscribers', () => {
    const service = new AlertNotificationService();
    const listener = vi.fn();
    service.subscribe(listener);

    service.emitAlert({
      id: 'test-alert',
      source: 'system',
      severity: 'warning',
      message: 'Test alert'
    });

    expect(service.getAlerts()).toEqual([
      expect.objectContaining({ id: 'test-alert', acknowledged: false })
    ]);
    expect(service.getAlerts()[0]).not.toHaveProperty('message');
    expect(service.getAlerts()[0]).not.toHaveProperty('severity');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'test-alert',
        source: 'system',
        severity: 'warning',
        message: 'Test alert'
      })
    );
  });

  it('acknowledges alerts', () => {
    const service = new AlertNotificationService();
    service.emitAlert({
      id: 'alert-1',
      source: 'performance',
      severity: 'critical',
      message: 'CPU high'
    });

    expect(service.getActiveAlerts()).toHaveLength(1);
    expect(service.acknowledgeAlert('alert-1')).toBe(true);
    expect(service.getActiveAlerts()).toHaveLength(0);
  });
});
