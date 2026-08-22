import type {
  MemoryReviewCandidateSelectionThresholds,
  MemoryReviewQueueControlConfig,
} from './memory-review-candidate-selection.types.js';

const DEFAULT_IMPORTANCE_THRESHOLD = 0.7;
const DEFAULT_STALE_DAYS = 14;
const DEFAULT_MAX_CANDIDATES = 50;
const DEFAULT_MAX_BACKLOG = 500;
const DEFAULT_CANDIDATE_TTL_DAYS = 30;

function parseImportanceThreshold(raw: string | undefined): number {
  if (raw === undefined || raw === '') {
    return DEFAULT_IMPORTANCE_THRESHOLD;
  }
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n) || n < 0 || n > 1) {
    return DEFAULT_IMPORTANCE_THRESHOLD;
  }
  return n;
}

function parsePositiveInt(raw: string | undefined, defaultValue: number): number {
  if (raw === undefined || raw === '') {
    return defaultValue;
  }
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) {
    return defaultValue;
  }
  return n;
}

function parseNonNegativeInt(raw: string | undefined, defaultValue: number): number {
  if (raw === undefined || raw === '') {
    return defaultValue;
  }
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) {
    return defaultValue;
  }
  return n;
}

export function parseMemoryReviewSelectionEnv(): MemoryReviewCandidateSelectionThresholds {
  return {
    importanceThreshold: parseImportanceThreshold(process.env.MEMORY_REVIEW_IMPORTANCE_THRESHOLD),
    staleDays: parsePositiveInt(process.env.MEMORY_REVIEW_STALE_DAYS, DEFAULT_STALE_DAYS),
    maxCandidates: parsePositiveInt(process.env.MEMORY_REVIEW_MAX_CANDIDATES, DEFAULT_MAX_CANDIDATES),
  };
}

export function parseMemoryReviewQueueControlEnv(): MemoryReviewQueueControlConfig {
  return {
    maxBacklog: parseNonNegativeInt(process.env.MEMORY_REVIEW_MAX_BACKLOG, DEFAULT_MAX_BACKLOG),
    candidateTtlDays: parseNonNegativeInt(
      process.env.MEMORY_REVIEW_CANDIDATE_TTL_DAYS,
      DEFAULT_CANDIDATE_TTL_DAYS,
    ),
  };
}
