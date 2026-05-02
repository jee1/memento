import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseMemoryReviewSelectionEnv } from './memory-review-candidate-selection-env.js';

describe('parseMemoryReviewSelectionEnv', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('uses defaults when MEMORY_REVIEW_* vars are unset', () => {
    expect(parseMemoryReviewSelectionEnv()).toEqual({
      importanceThreshold: 0.7,
      staleDays: 14,
      maxCandidates: 50,
    });
  });

  it('applies valid env overrides', () => {
    vi.stubEnv('MEMORY_REVIEW_IMPORTANCE_THRESHOLD', '0.25');
    vi.stubEnv('MEMORY_REVIEW_STALE_DAYS', '30');
    vi.stubEnv('MEMORY_REVIEW_MAX_CANDIDATES', '100');
    expect(parseMemoryReviewSelectionEnv()).toEqual({
      importanceThreshold: 0.25,
      staleDays: 30,
      maxCandidates: 100,
    });
  });

  it('falls back importance when value is outside [0, 1]', () => {
    vi.stubEnv('MEMORY_REVIEW_IMPORTANCE_THRESHOLD', '2');
    expect(parseMemoryReviewSelectionEnv().importanceThreshold).toBe(0.7);
  });

  it('falls back staleDays when value is below 1', () => {
    vi.stubEnv('MEMORY_REVIEW_STALE_DAYS', '0');
    expect(parseMemoryReviewSelectionEnv().staleDays).toBe(14);
  });

  it('falls back maxCandidates when value is negative', () => {
    vi.stubEnv('MEMORY_REVIEW_MAX_CANDIDATES', '-3');
    expect(parseMemoryReviewSelectionEnv().maxCandidates).toBe(50);
  });
});
