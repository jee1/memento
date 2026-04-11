/**
 * Fire-and-forget telemetry + admin query facade (FR-011)
 */

import { AsyncLocalStorage } from 'async_hooks';
import { randomUUID } from 'crypto';
import { setImmediate } from 'timers';
import type { BatchScheduler } from '../../../infrastructure/scheduler/batch-scheduler.js';
import {
  TelemetryRepository,
  type ConsolidationQualityResult,
  type MemoryQualityResult,
  type SchedulerJobSnapshot,
  type SearchQualityResult,
  type SystemMetricsResult
} from '../repositories/telemetry-repository.js';
import type {
  EventType,
  TelemetryEventInput,
  TelemetryEventQueryFilters,
  TelemetryEventRow,
  TelemetryPeriod
} from '../types/telemetry.types.js';
import { logger } from '../../../shared/utils/logger.js';

export interface TelemetryContext {
  requestId: string;
  ownerId: string | null;
}

export class TelemetryService {
  private readonly als = new AsyncLocalStorage<TelemetryContext>();

  /** 행 단위 손상 JSON이 전체 목록 API를 깨지 않게 한다 (FR-010) */
  static safeParseExtraData(raw: string | null): Record<string, unknown> | null {
    if (raw == null || raw === '') return null;
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      logger.warn('telemetry extra_data JSON parse failed; returning null for this row');
      return null;
    }
  }

  constructor(
    private readonly repository: TelemetryRepository,
    private readonly getScheduler?: () => BatchScheduler | null
  ) {}

  getContext(): TelemetryContext | undefined {
    return this.als.getStore();
  }

  async runWithContext<T>(ownerId: string | null, fn: () => Promise<T>): Promise<T> {
    const requestId = randomUUID();
    return this.als.run({ requestId, ownerId }, fn);
  }

  record(partial: Omit<TelemetryEventInput, 'requestId' | 'ownerId'> & { requestId?: string; ownerId?: string | null }): void {
    const store = this.als.getStore();
    const requestId = partial.requestId ?? store?.requestId ?? randomUUID();
    const ownerId = partial.ownerId !== undefined ? partial.ownerId : (store?.ownerId ?? null);
    const event: TelemetryEventInput = {
      eventType: partial.eventType,
      requestId,
      ownerId,
      latencyMs: partial.latencyMs,
      outcome: partial.outcome,
      errorCode: partial.errorCode,
      extraData: partial.extraData
    };
    setImmediate(() => {
      try {
        this.repository.insertEventSync(event);
      } catch (err) {
        logger.warn('telemetry write failed', {
          error: err instanceof Error ? err.message : String(err)
        });
      }
    });
  }

  getSearchQuality(period: TelemetryPeriod, ownerId?: string | null): SearchQualityResult {
    return this.repository.querySearchQuality(period, ownerId);
  }

  getMemoryQuality(ownerId?: string | null): MemoryQualityResult {
    return this.repository.queryMemoryQuality(ownerId);
  }

  getConsolidationQuality(ownerId?: string | null): ConsolidationQualityResult {
    return this.repository.queryConsolidationQuality(ownerId);
  }

  getSystemMetrics(period: TelemetryPeriod, ownerId?: string | null): SystemMetricsResult {
    const sched = this.getScheduler?.() ?? null;
    const sleepMeta = this.buildJobSnapshot(sched, 'sleep_consolidation_batch');
    const telMeta = this.buildJobSnapshot(sched, 'telemetry_cleanup_batch');
    return this.repository.querySystemMetrics(period, ownerId, {
      sleep: sleepMeta,
      telemetryCleanup: telMeta
    });
  }

  private static jobNameToTelemetryEventType(jobName: string): EventType | null {
    if (jobName === 'sleep_consolidation_batch') return 'consolidation.performed';
    if (jobName === 'telemetry_cleanup_batch') return 'telemetry.cleanup.performed';
    return null;
  }

  private buildJobSnapshot(sched: BatchScheduler | null, jobName: string): SchedulerJobSnapshot {
    const et = TelemetryService.jobNameToTelemetryEventType(jobName);
    const roll24 =
      et != null ? this.repository.getBackgroundJobRolling24hStats(et) : null;

    if (!sched) {
      return {
        lastExecution: null,
        lastSuccess: null,
        lastDurationMs: null,
        successRuns24h: roll24?.successRuns24h ?? null,
        failureRuns24h: roll24?.failureRuns24h ?? null,
        avgDurationMs24h: roll24?.avgDurationMs24h ?? null
      };
    }
    const st = sched.getStatus();
    const lastAt = st.lastExecution?.get(jobName) ?? null;
    const meta = sched.getLastJobRunMeta(jobName);
    return {
      lastExecution: lastAt,
      lastSuccess: meta?.success ?? null,
      lastDurationMs: meta?.durationMs ?? null,
      successRuns24h: roll24?.successRuns24h ?? null,
      failureRuns24h: roll24?.failureRuns24h ?? null,
      avgDurationMs24h: roll24?.avgDurationMs24h ?? null
    };
  }

  getEvents(filters: TelemetryEventQueryFilters): {
    events: Array<Omit<TelemetryEventRow, 'extra_data'> & { extra_data: Record<string, unknown> | null }>;
    total: number;
    limit: number;
    offset: number;
    timestamp: string;
  } {
    const { events, total } = this.repository.queryEvents(filters);
    const mapped = events.map(e => ({
      ...e,
      extra_data: TelemetryService.safeParseExtraData(e.extra_data)
    }));
    return {
      events: mapped,
      total,
      limit: filters.limit,
      offset: filters.offset,
      timestamp: new Date().toISOString()
    };
  }

  hasPriorWriteWithContentHash(ownerId: string | null, contentHash: string, sinceIso: string): boolean {
    return this.repository.hasPriorWriteCompletedWithContentHash(ownerId, contentHash, sinceIso);
  }
}
