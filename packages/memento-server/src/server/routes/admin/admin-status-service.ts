/**
 * Admin Ops status aggregation (Issue #1048).
 */

import type Database from 'better-sqlite3';
import {
  computeMemoryReviewQueueHealthLive,
  EmbeddingReindexService,
  getBatchScheduler,
  JobRunRepository,
  mementoConfig,
} from '@memento/core';

const WINDOW_DAYS = 30;
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const MIN_MS = 60_000;

/** ms → 한국어 사람 시간. 「3일 14시간」 / 「12분」 / 「45초」. P2에서 공유 모듈로 뺀다. */
export function formatDurationHumanKo(ms: number): string {
  if (ms < 0 || !Number.isFinite(ms)) {
    return '0초';
  }
  const totalSeconds = Math.floor(ms / 1000);
  if (ms >= DAY_MS) {
    const days = Math.floor(ms / DAY_MS);
    const hours = Math.floor((ms % DAY_MS) / HOUR_MS);
    if (hours === 0) {
      return `${days}일`;
    }
    return `${days}일 ${hours}시간`;
  }
  if (ms >= HOUR_MS) {
    const hours = Math.floor(ms / HOUR_MS);
    const minutes = Math.floor((ms % HOUR_MS) / MIN_MS);
    if (minutes === 0) {
      return `${hours}시간`;
    }
    return `${hours}시간 ${minutes}분`;
  }
  if (ms >= MIN_MS) {
    const minutes = Math.floor(ms / MIN_MS);
    return `${minutes}분`;
  }
  return `${totalSeconds}초`;
}

export type SectionStatus = 'ok' | 'degraded' | 'unavailable';

export interface AdminStatusResponse {
  timestamp: string;
  windowDays: number;
  dataSince: string | null;
  since: string;
  process: {
    status: SectionStatus;
    uptimeMs: number;
    uptimeHuman: string;
    version: string;
    database: 'connected' | 'disconnected';
  };
  scheduler: {
    status: SectionStatus;
    running: boolean;
    uptimeMs: number;
    uptimeHuman: string;
    runningJobs: number;
    queueSize: number;
  };
  batchImpact: {
    status: SectionStatus;
    since: string;
    failedRunCount: number;
    durationMsSum: number;
    durationHuman: string;
    successRunCount: number;
    lastFailedAt: string | null;
  };
  review: {
    status: SectionStatus;
    pendingTotal: number;
    netFlow1h: number;
  };
  embedding: {
    status: SectionStatus;
    provider: string;
    problemCount: number;
  };
}

function formatImpactDuration(durationMsSum: number): string {
  const human = formatDurationHumanKo(durationMsSum);
  return durationMsSum >= MIN_MS ? `약 ${human}` : human;
}

function emptyBatchImpact(since: string, status: SectionStatus): AdminStatusResponse['batchImpact'] {
  return {
    status,
    since,
    failedRunCount: 0,
    durationMsSum: 0,
    durationHuman: formatDurationHumanKo(0),
    successRunCount: 0,
    lastFailedAt: null,
  };
}

export function buildAdminStatus(db: Database.Database | null): AdminStatusResponse {
  const timestamp = new Date().toISOString();
  const windowDays = WINDOW_DAYS;
  const since = new Date(Date.now() - windowDays * DAY_MS).toISOString();
  let dataSince: string | null = null;

  const uptimeMs = Math.round(process.uptime() * 1000);
  const processSection: AdminStatusResponse['process'] = {
    status: 'ok',
    uptimeMs,
    uptimeHuman: formatDurationHumanKo(uptimeMs),
    version: mementoConfig.serverVersion,
    database: db ? 'connected' : 'disconnected',
  };

  let scheduler: AdminStatusResponse['scheduler'] = {
    status: 'degraded',
    running: false,
    uptimeMs: 0,
    uptimeHuman: formatDurationHumanKo(0),
    runningJobs: 0,
    queueSize: 0,
  };
  try {
    const detailed = getBatchScheduler().getDetailedStats();
    const schedulerUptimeMs = detailed.health.uptime;
    scheduler = {
      status: 'ok',
      running: detailed.status.isRunning,
      uptimeMs: schedulerUptimeMs,
      uptimeHuman: formatDurationHumanKo(schedulerUptimeMs),
      runningJobs: detailed.health.runningJobs,
      queueSize: detailed.health.queueSize,
    };
  } catch {
    scheduler = {
      status: 'degraded',
      running: false,
      uptimeMs: 0,
      uptimeHuman: formatDurationHumanKo(0),
      runningJobs: 0,
      queueSize: 0,
    };
  }

  let batchImpact: AdminStatusResponse['batchImpact'];
  if (!db) {
    batchImpact = emptyBatchImpact(since, 'unavailable');
  } else {
    try {
      const aggregate = new JobRunRepository().aggregateFailedDurationSince(db, since);
      dataSince = aggregate.dataSince;
      batchImpact = {
        status: 'ok',
        since,
        failedRunCount: aggregate.failedRunCount,
        durationMsSum: aggregate.durationMsSum,
        durationHuman: formatImpactDuration(aggregate.durationMsSum),
        successRunCount: aggregate.successRunCount,
        lastFailedAt: aggregate.lastFailedAt,
      };
    } catch {
      batchImpact = emptyBatchImpact(since, 'degraded');
    }
  }

  let review: AdminStatusResponse['review'];
  if (!db) {
    review = { status: 'unavailable', pendingTotal: 0, netFlow1h: 0 };
  } else {
    try {
      const health = computeMemoryReviewQueueHealthLive(db);
      review = {
        status: 'ok',
        pendingTotal: health.pendingTotal,
        netFlow1h: health.window1h.netFlow,
      };
    } catch {
      review = { status: 'degraded', pendingTotal: 0, netFlow1h: 0 };
    }
  }

  let embedding: AdminStatusResponse['embedding'];
  if (!db) {
    embedding = { status: 'unavailable', provider: 'minilm', problemCount: 0 };
  } else {
    try {
      const diagnostics = new EmbeddingReindexService(db).diagnose({ provider: 'minilm' });
      const problemCount =
        diagnostics.missingEmbeddingCount +
        diagnostics.unreadableEmbeddingCount +
        diagnostics.dimensionMismatchCount +
        diagnostics.providerDriftCount +
        diagnostics.modelDriftCount;
      embedding = {
        status: 'ok',
        provider: 'minilm',
        problemCount,
      };
    } catch {
      embedding = { status: 'degraded', provider: 'minilm', problemCount: 0 };
    }
  }

  return {
    timestamp,
    windowDays,
    dataSince,
    since,
    process: processSection,
    scheduler,
    batchImpact,
    review,
    embedding,
  };
}
