import { describe, expect, it } from 'vitest';
import {
  MS_PER_DAY,
  buildReason,
  buildScoreBreakdown,
  computePriority,
  computeStaleDays,
  computeStaleRatio,
  isMemoryRowActive,
  parseSqliteInstant,
  passesEligibility,
  resolveStaleAnchor,
} from './memory-review-candidate-selection-scoring.js';
import type { MemoryReviewCandidateSourceRow } from './memory-review-candidate-selection.types.js';

function baseRow(overrides: Partial<MemoryReviewCandidateSourceRow> = {}): MemoryReviewCandidateSourceRow {
  return {
    memory_id: 'm1',
    importance: 0.5,
    pinned: false,
    is_deleted: false,
    deleted_at: null,
    created_at: '2020-01-01T00:00:00.000Z',
    last_recalled_at: null,
    ...overrides,
  };
}

describe('memory-review-candidate-selection-scoring', () => {
  describe('computeStaleDays', () => {
    it('floors whole days and distinguishes 13 vs 14 day boundary', () => {
      const now = new Date('2025-05-15T12:00:00.000Z');
      const anchor13 = new Date(now.getTime() - 13 * MS_PER_DAY);
      const anchor14 = new Date(now.getTime() - 14 * MS_PER_DAY);
      const anchorJustUnder14 = new Date(now.getTime() - (14 * MS_PER_DAY - 1));

      expect(computeStaleDays(anchor13, now)).toBe(13);
      expect(computeStaleDays(anchor14, now)).toBe(14);
      expect(computeStaleDays(anchorJustUnder14, now)).toBe(13);
    });
  });

  describe('resolveStaleAnchor', () => {
    it('prefers last_recalled_at when parseable', () => {
      const row = baseRow({
        last_recalled_at: '2025-04-01T00:00:00.000Z',
        created_at: '2020-01-01T00:00:00.000Z',
      });
      const r = resolveStaleAnchor(row);
      expect(r?.kind).toBe('last_recalled_at');
      expect(r?.instant.toISOString()).toBe('2025-04-01T00:00:00.000Z');
    });

    it('falls back to created_at when last recall missing or invalid', () => {
      const row = baseRow({
        last_recalled_at: null,
        created_at: '2024-06-01 00:00:00',
      });
      const r = resolveStaleAnchor(row);
      expect(r?.kind).toBe('created_at_fallback');
      expect(r?.instant.toISOString()).toBe('2024-06-01T00:00:00.000Z');
    });

    it('returns null when created_at is invalid', () => {
      const row = baseRow({
        last_recalled_at: '',
        created_at: 'not-a-date',
      });
      expect(resolveStaleAnchor(row)).toBeNull();
    });
  });

  describe('computeStaleRatio', () => {
    it('caps at 3 and uses max(threshold,1) as denominator', () => {
      expect(computeStaleRatio(10, 5)).toBe(2);
      expect(computeStaleRatio(30, 10)).toBe(3);
      expect(computeStaleRatio(5, 0)).toBe(3);
    });
  });

  describe('computePriority', () => {
    it('combines importance and stale ratio per formula', () => {
      expect(computePriority(0.5, 1)).toBeCloseTo(600, 10);
      expect(computePriority(0.8, 2)).toBeCloseTo(1000, 10);
    });
  });

  describe('passesEligibility', () => {
    const thresholds = { importanceThreshold: 0.4, staleDays: 14, maxCandidates: 50 };

    it('is false at 13 stale days and true at 14 for threshold 14', () => {
      const now = new Date('2025-05-15T00:00:00.000Z');
      const recall13 = new Date(now.getTime() - 13 * MS_PER_DAY).toISOString();
      const recall14 = new Date(now.getTime() - 14 * MS_PER_DAY).toISOString();

      const row13 = baseRow({
        importance: 0.5,
        last_recalled_at: recall13,
      });
      const row14 = baseRow({
        importance: 0.5,
        last_recalled_at: recall14,
      });

      expect(passesEligibility(row13, { ...thresholds, now })).toBe(false);
      expect(passesEligibility(row14, { ...thresholds, now })).toBe(true);
    });
  });

  describe('isMemoryRowActive', () => {
    it('excludes pinned, deleted flags, and non-empty deleted_at', () => {
      expect(isMemoryRowActive(baseRow({ pinned: true }))).toBe(false);
      expect(isMemoryRowActive(baseRow({ pinned: 1 }))).toBe(false);
      expect(isMemoryRowActive(baseRow({ is_deleted: true }))).toBe(false);
      expect(isMemoryRowActive(baseRow({ is_deleted: 1 }))).toBe(false);
      expect(isMemoryRowActive(baseRow({ deleted_at: '2025-01-01' }))).toBe(false);
      expect(isMemoryRowActive(baseRow())).toBe(true);
    });
  });

  describe('buildScoreBreakdown and buildReason', () => {
    it('includes thresholds and anchor kind in breakdown and reason', () => {
      const now = new Date('2025-05-15T00:00:00.000Z');
      const row = baseRow({
        importance: 0.55,
        last_recalled_at: new Date(now.getTime() - 20 * MS_PER_DAY).toISOString(),
      });
      const options = { importanceThreshold: 0.4, staleDays: 14, maxCandidates: 50, now };
      const b = buildScoreBreakdown(row, options);
      expect(b.importance).toBe(0.55);
      expect(b.stale_days).toBe(20);
      expect(b.anchor_kind).toBe('last_recalled_at');
      expect(b.threshold_importance).toBe(0.4);
      expect(b.threshold_stale_days).toBe(14);
      expect(buildReason(b)).toBe(
        'eligible: importance=0.550>=0.4, stale=20d>=14d, anchor=last_recalled_at',
      );
    });
  });

  describe('parseSqliteInstant', () => {
    it('parses ISO and SQLite local datetime', () => {
      expect(parseSqliteInstant('2024-01-02T03:04:05.000Z')?.toISOString()).toBe(
        '2024-01-02T03:04:05.000Z',
      );
      expect(parseSqliteInstant('2024-01-02 03:04:05')?.toISOString()).toBe(
        '2024-01-02T03:04:05.000Z',
      );
    });
  });
});
