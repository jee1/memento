import type {
  MemoryReviewCandidateScoreBreakdown,
  MemoryReviewCandidateSelectionOptions,
  MemoryReviewCandidateSourceRow,
  MemoryReviewStaleAnchorKind,
} from './memory-review-candidate-selection.types.js';

export const MS_PER_DAY = 86_400_000;

const SQLITE_LOCAL_DATETIME = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2}(?:\.\d+)?)$/;

export function parseSqliteInstant(value: string | null | undefined): Date | null {
  if (value == null) return null;
  const trimmed = String(value).trim();
  if (trimmed === '') return null;

  const sqliteMatch = trimmed.match(SQLITE_LOCAL_DATETIME);
  if (sqliteMatch) {
    const isoUtc = `${sqliteMatch[1]}T${sqliteMatch[2]}Z`;
    const parsedUtc = new Date(isoUtc);
    if (!Number.isNaN(parsedUtc.getTime())) return parsedUtc;
  }

  const direct = new Date(trimmed);
  if (!Number.isNaN(direct.getTime())) return direct;

  return null;
}

export function resolveStaleAnchor(row: MemoryReviewCandidateSourceRow): {
  instant: Date;
  kind: MemoryReviewStaleAnchorKind;
} | null {
  const fromRecall = parseSqliteInstant(row.last_recalled_at);
  if (fromRecall) {
    return { instant: fromRecall, kind: 'last_recalled_at' };
  }

  const created = parseSqliteInstant(row.created_at);
  if (!created) return null;

  return { instant: created, kind: 'created_at_fallback' };
}

export function computeStaleDays(anchor: Date, now: Date): number {
  const diffMs = now.getTime() - anchor.getTime();
  return Math.floor(diffMs / MS_PER_DAY);
}

export function computeStaleRatio(staleDays: number, thresholdStaleDays: number): number {
  const denom = Math.max(thresholdStaleDays, 1);
  return Math.min(staleDays / denom, 3);
}

export function computePriority(importance: number, staleRatio: number): number {
  return importance * 1000 + staleRatio * 100;
}

function isTruthyFlag(value: number | boolean | undefined): boolean {
  return value === true || value === 1;
}

function isNonEmptyDeletedAt(value: string | null | undefined): boolean {
  if (value == null) return false;
  return String(value).trim() !== '';
}

export function isMemoryRowActive(row: MemoryReviewCandidateSourceRow): boolean {
  if (isTruthyFlag(row.pinned)) return false;
  if (isTruthyFlag(row.is_deleted)) return false;
  if (isNonEmptyDeletedAt(row.deleted_at)) return false;
  return true;
}

export function passesEligibility(
  row: MemoryReviewCandidateSourceRow,
  options: MemoryReviewCandidateSelectionOptions,
): boolean {
  if (!isMemoryRowActive(row)) return false;
  if (row.importance < options.importanceThreshold) return false;

  const resolved = resolveStaleAnchor(row);
  if (!resolved) return false;

  const staleDays = computeStaleDays(resolved.instant, options.now);
  return staleDays >= options.staleDays;
}

export function buildScoreBreakdown(
  row: MemoryReviewCandidateSourceRow,
  options: MemoryReviewCandidateSelectionOptions,
): MemoryReviewCandidateScoreBreakdown {
  const resolved = resolveStaleAnchor(row);
  const stale_days = resolved ? computeStaleDays(resolved.instant, options.now) : 0;
  const anchor_kind: MemoryReviewStaleAnchorKind = resolved?.kind ?? 'created_at_fallback';

  return {
    importance: row.importance,
    stale_days,
    anchor_kind,
    threshold_importance: options.importanceThreshold,
    threshold_stale_days: options.staleDays,
  };
}

export function buildReason(breakdown: MemoryReviewCandidateScoreBreakdown): string {
  return (
    `eligible: importance=${breakdown.importance.toFixed(3)}>=${breakdown.threshold_importance}, ` +
    `stale=${breakdown.stale_days}d>=${breakdown.threshold_stale_days}d, anchor=${breakdown.anchor_kind}`
  );
}
