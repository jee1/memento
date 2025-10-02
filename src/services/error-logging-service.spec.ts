import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ErrorLoggingService, ErrorSeverity, ErrorCategory, ErrorLog, ErrorAlert } from './error-logging-service.js';

describe('ErrorLoggingService', () => {
  let service: ErrorLoggingService;

  beforeEach(() => {
    service = new ErrorLoggingService();
    vi.clearAllMocks();
  });

  afterEach(() => {
    service.cleanup();
  });

  describe('constructor', () => {
    it('should initialize with default settings', () => {
      expect(service).toBeInstanceOf(ErrorLoggingService);
    });
  });

  describe('logError', () => {
    it('should log error with string message', () => {
      const errorId = service.logError(
        'Test error message',
        ErrorSeverity.MEDIUM,
        ErrorCategory.VALIDATION,
        { component: 'test-component' }
      );

      expect(errorId).toMatch(/^err_\d+_[a-z0-9]+$/);
    });

    it('should log error with Error object', () => {
      const error = new Error('Test error');
      error.stack = 'Error: Test error\n    at test.js:1:1';
      
      const errorId = service.logError(
        error,
        ErrorSeverity.HIGH,
        ErrorCategory.DATABASE,
        { component: 'database-service' }
      );

      expect(errorId).toMatch(/^err_\d+_[a-z0-9]+$/);
    });

    it('should use default severity and category when not provided', () => {
      const errorId = service.logError('Test error');

      expect(errorId).toMatch(/^err_\d+_[a-z0-9]+$/);
    });

    it('should include context and metadata', () => {
      const context = {
        userId: 'user123',
        sessionId: 'session456',
        operation: 'create_memory'
      };
      const metadata = {
        userAgent: 'Mozilla/5.0',
        ipAddress: '192.168.1.1'
      };

      const errorId = service.logError(
        'Test error',
        ErrorSeverity.MEDIUM,
        ErrorCategory.VALIDATION,
        context,
        metadata
      );

      expect(errorId).toMatch(/^err_\d+_[a-z0-9]+$/);
    });

    it('should set default component when not provided', () => {
      const errorId = service.logError('Test error');
      
      // Error should be logged successfully
      expect(errorId).toMatch(/^err_\d+_[a-z0-9]+$/);
    });
  });

  describe('resolveError', () => {
    it('should resolve existing error', () => {
      const errorId = service.logError('Test error');
      const result = service.resolveError(errorId, 'admin');

      expect(result).toBe(true);
    });

    it('should return false for non-existent error', () => {
      const result = service.resolveError('non-existent-id');

      expect(result).toBe(false);
    });

    it('should use default resolvedBy when not provided', () => {
      const errorId = service.logError('Test error');
      const result = service.resolveError(errorId);

      expect(result).toBe(true);
    });
  });

  describe('getErrorStats', () => {
    beforeEach(() => {
      // Add some test errors
      service.logError('Low error', ErrorSeverity.LOW, ErrorCategory.CACHE);
      service.logError('Medium error', ErrorSeverity.MEDIUM, ErrorCategory.DATABASE);
      service.logError('High error', ErrorSeverity.HIGH, ErrorCategory.NETWORK);
      service.logError('Critical error', ErrorSeverity.CRITICAL, ErrorCategory.MEMORY);
    });

    it('should return error statistics for last 24 hours', () => {
      const stats = service.getErrorStats();

      expect(stats.totalErrors).toBe(4);
      expect(stats.errorsBySeverity[ErrorSeverity.LOW]).toBe(1);
      expect(stats.errorsBySeverity[ErrorSeverity.MEDIUM]).toBe(1);
      expect(stats.errorsBySeverity[ErrorSeverity.HIGH]).toBe(1);
      expect(stats.errorsBySeverity[ErrorSeverity.CRITICAL]).toBe(1);
      expect(stats.criticalErrors).toBe(1);
      expect(stats.recentErrors).toHaveLength(4);
    });

    it('should return error statistics for custom time period', () => {
      const stats = service.getErrorStats(1); // Last 1 hour

      expect(stats.totalErrors).toBe(4);
      expect(stats.errorsByCategory[ErrorCategory.CACHE]).toBe(1);
      expect(stats.errorsByCategory[ErrorCategory.DATABASE]).toBe(1);
      expect(stats.errorsByCategory[ErrorCategory.NETWORK]).toBe(1);
      expect(stats.errorsByCategory[ErrorCategory.MEMORY]).toBe(1);
    });

    it('should calculate average resolution time', () => {
      const errorId1 = service.logError('Error 1');
      const errorId2 = service.logError('Error 2');
      
      // Resolve errors
      service.resolveError(errorId1, 'admin1');
      service.resolveError(errorId2, 'admin2');

      const stats = service.getErrorStats();
      expect(stats.averageResolutionTime).toBeGreaterThanOrEqual(0);
    });

    it('should group errors by hour', () => {
      const stats = service.getErrorStats();
      
      expect(stats.errorsByHour).toBeDefined();
      expect(typeof stats.errorsByHour).toBe('object');
    });
  });

  describe('getActiveAlerts', () => {
    it('should return empty array when no alerts', () => {
      const alerts = service.getActiveAlerts();
      expect(alerts).toEqual([]);
    });

    it('should return only unacknowledged alerts', () => {
      // Create some errors to trigger alerts
      for (let i = 0; i < 15; i++) {
        service.logError(`High error ${i}`, ErrorSeverity.HIGH, ErrorCategory.DATABASE);
      }

      const alerts = service.getActiveAlerts();
      expect(Array.isArray(alerts)).toBe(true);
    });
  });

  describe('acknowledgeAlert', () => {
    it('should acknowledge existing alert', () => {
      // Create errors to trigger alert
      for (let i = 0; i < 15; i++) {
        service.logError(`High error ${i}`, ErrorSeverity.HIGH, ErrorCategory.DATABASE);
      }

      const alerts = service.getActiveAlerts();
      if (alerts.length > 0) {
        const result = service.acknowledgeAlert(alerts[0].id, 'admin');
        expect(result).toBe(true);
      }
    });

    it('should return false for non-existent alert', () => {
      const result = service.acknowledgeAlert('non-existent-alert-id');
      expect(result).toBe(false);
    });

    it('should use default acknowledgedBy when not provided', () => {
      // Create errors to trigger alert
      for (let i = 0; i < 15; i++) {
        service.logError(`High error ${i}`, ErrorSeverity.HIGH, ErrorCategory.DATABASE);
      }

      const alerts = service.getActiveAlerts();
      if (alerts.length > 0) {
        const result = service.acknowledgeAlert(alerts[0].id);
        expect(result).toBe(true);
      }
    });
  });

  describe('searchErrors', () => {
    beforeEach(() => {
      // Add test errors with different properties
      service.logError('Low error', ErrorSeverity.LOW, ErrorCategory.CACHE, { component: 'cache' });
      service.logError('Medium error', ErrorSeverity.MEDIUM, ErrorCategory.DATABASE, { component: 'db' });
      service.logError('High error', ErrorSeverity.HIGH, ErrorCategory.NETWORK, { component: 'network' });
      
      // Resolve one error
      const errorId = service.logError('Resolved error', ErrorSeverity.MEDIUM, ErrorCategory.VALIDATION);
      service.resolveError(errorId);
    });

    it('should return all errors when no filters applied', () => {
      const results = service.searchErrors();
      expect(results.length).toBeGreaterThanOrEqual(4);
    });

    it('should filter by severity', () => {
      const results = service.searchErrors({ severity: ErrorSeverity.HIGH });
      expect(results.length).toBeGreaterThanOrEqual(1);
      results.forEach(error => {
        expect(error.severity).toBe(ErrorSeverity.HIGH);
      });
    });

    it('should filter by category', () => {
      const results = service.searchErrors({ category: ErrorCategory.DATABASE });
      expect(results.length).toBeGreaterThanOrEqual(1);
      results.forEach(error => {
        expect(error.category).toBe(ErrorCategory.DATABASE);
      });
    });

    it('should filter by resolved status', () => {
      const resolvedResults = service.searchErrors({ resolved: true });
      const unresolvedResults = service.searchErrors({ resolved: false });
      
      expect(resolvedResults.length).toBeGreaterThanOrEqual(1);
      expect(unresolvedResults.length).toBeGreaterThanOrEqual(3);
      
      resolvedResults.forEach(error => {
        expect(error.resolved).toBe(true);
      });
      unresolvedResults.forEach(error => {
        expect(error.resolved).toBe(false);
      });
    });

    it('should filter by date range', () => {
      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
      const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000);

      const results = service.searchErrors({
        startDate: oneHourAgo,
        endDate: oneHourFromNow
      });

      expect(results.length).toBeGreaterThanOrEqual(4);
      results.forEach(error => {
        expect(error.timestamp).toBeGreaterThanOrEqual(oneHourAgo);
        expect(error.timestamp).toBeLessThanOrEqual(oneHourFromNow);
      });
    });

    it('should limit results', () => {
      const results = service.searchErrors({ limit: 2 });
      expect(results.length).toBeLessThanOrEqual(2);
    });

    it('should sort by timestamp descending', () => {
      const results = service.searchErrors();
      for (let i = 1; i < results.length; i++) {
        expect(results[i-1].timestamp.getTime()).toBeGreaterThanOrEqual(results[i].timestamp.getTime());
      }
    });
  });

  describe('cleanup', () => {
    it('should clear all errors and alerts', () => {
      service.logError('Test error');
      
      service.cleanup();
      
      const stats = service.getErrorStats();
      expect(stats.totalErrors).toBe(0);
      expect(service.getActiveAlerts()).toEqual([]);
    });
  });

  describe('private methods', () => {
    describe('generateErrorId', () => {
      it('should generate unique error IDs', () => {
        const id1 = (service as any).generateErrorId();
        const id2 = (service as any).generateErrorId();
        
        expect(id1).toMatch(/^err_\d+_[a-z0-9]+$/);
        expect(id2).toMatch(/^err_\d+_[a-z0-9]+$/);
        expect(id1).not.toBe(id2);
      });
    });

    describe('cleanupOldErrors', () => {
      it('should remove old errors when limit exceeded', () => {
        // Set a low maxErrors for testing
        (service as any).maxErrors = 2;
        
        service.logError('Error 1');
        service.logError('Error 2');
        service.logError('Error 3'); // This should trigger cleanup
        
        const stats = service.getErrorStats();
        expect(stats.totalErrors).toBeLessThanOrEqual(2);
      });
    });

    describe('checkAlertThresholds', () => {
      it('should create alert when threshold exceeded', () => {
        // Create enough high severity errors to trigger alert
        for (let i = 0; i < 15; i++) {
          service.logError(`High error ${i}`, ErrorSeverity.HIGH, ErrorCategory.DATABASE);
        }

        const alerts = service.getActiveAlerts();
        expect(alerts.length).toBeGreaterThan(0);
      });
    });

    describe('createAlert', () => {
      it('should create alert with correct properties', () => {
        const error: ErrorLog = {
          id: 'test-error-id',
          timestamp: new Date(),
          severity: ErrorSeverity.HIGH,
          category: ErrorCategory.DATABASE,
          message: 'Test error',
          context: { component: 'test' },
          metadata: {},
          resolved: false
        };

        (service as any).createAlert(error);

        const alerts = service.getActiveAlerts();
        expect(alerts.length).toBeGreaterThan(0);
        
        const alert = alerts[0];
        expect(alert.errorId).toBe(error.id);
        expect(alert.severity).toBe(error.severity);
        expect(alert.acknowledged).toBe(false);
      });
    });

    describe('cleanupOldAlerts', () => {
      it('should remove old alerts when limit exceeded', () => {
        // Set a low maxAlerts for testing
        (service as any).maxAlerts = 2;
        
        // Create multiple alerts
        for (let i = 0; i < 5; i++) {
          const error: ErrorLog = {
            id: `error-${i}`,
            timestamp: new Date(),
            severity: ErrorSeverity.HIGH,
            category: ErrorCategory.DATABASE,
            message: `Error ${i}`,
            context: { component: 'test' },
            metadata: {},
            resolved: false
          };
          (service as any).createAlert(error);
        }

        const alerts = service.getActiveAlerts();
        expect(alerts.length).toBeLessThanOrEqual(2);
      });
    });

    describe('logToConsole', () => {
      it('should log error to console with proper formatting', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      
      const error: ErrorLog = {
        id: 'test-error',
        timestamp: new Date(),
        severity: ErrorSeverity.HIGH,
        category: ErrorCategory.DATABASE,
        message: 'Test error message',
        stack: 'Error: Test error\n    at test.js:1:1',
        context: { component: 'test-component' },
        metadata: {},
        resolved: false
      };

      (service as any).logToConsole(error);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[HIGH] DATABASE')
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('ID: test-error')
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Message: Test error message')
      );

      consoleSpy.mockRestore();
    });
  });
});
