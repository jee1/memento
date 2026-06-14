import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  parseMemoryReviewQueueControlEnv,
  parseMemoryReviewSelectionEnv,
} from './memory-review-candidate-selection-env.js';

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

describe('parseMemoryReviewQueueControlEnv', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('uses safe defaults when queue control vars are unset', () => {
    expect(parseMemoryReviewQueueControlEnv()).toEqual({
      maxBacklog: 500,
      candidateTtlDays: 30,
    });
  });

  it('accepts zero to disable each automatic queue control', () => {
    vi.stubEnv('MEMORY_REVIEW_MAX_BACKLOG', '0');
    vi.stubEnv('MEMORY_REVIEW_CANDIDATE_TTL_DAYS', '0');
    expect(parseMemoryReviewQueueControlEnv()).toEqual({
      maxBacklog: 0,
      candidateTtlDays: 0,
    });
  });

  it('falls back invalid queue control values independently', () => {
    vi.stubEnv('MEMORY_REVIEW_MAX_BACKLOG', '-1');
    vi.stubEnv('MEMORY_REVIEW_CANDIDATE_TTL_DAYS', 'abc');
    expect(parseMemoryReviewQueueControlEnv()).toEqual({
      maxBacklog: 500,
      candidateTtlDays: 30,
    });
  });
});
