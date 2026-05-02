import type { MemoryReviewCandidateSelectionThresholds } from './memory-review-candidate-selection.types.js';

const DEFAULT_IMPORTANCE_THRESHOLD = 0.7;
const DEFAULT_STALE_DAYS = 14;
const DEFAULT_MAX_CANDIDATES = 50;

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

export function parseMemoryReviewSelectionEnv(): MemoryReviewCandidateSelectionThresholds {
  return {
    importanceThreshold: parseImportanceThreshold(process.env.MEMORY_REVIEW_IMPORTANCE_THRESHOLD),
    staleDays: parsePositiveInt(process.env.MEMORY_REVIEW_STALE_DAYS, DEFAULT_STALE_DAYS),
    maxCandidates: parsePositiveInt(process.env.MEMORY_REVIEW_MAX_CANDIDATES, DEFAULT_MAX_CANDIDATES),
  };
}
