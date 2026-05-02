export type MemoryReviewStaleAnchorKind = 'last_recalled_at' | 'created_at_fallback';

export interface MemoryReviewCandidateSourceRow {
  memory_id: string;
  importance: number;
  pinned: number | boolean;
  is_deleted: number | boolean;
  deleted_at: string | null;
  created_at: string;
  last_recalled_at: string | null;
}

export interface MemoryReviewCandidateScoreBreakdown {
  importance: number;
  stale_days: number;
  anchor_kind: MemoryReviewStaleAnchorKind;
  threshold_importance: number;
  threshold_stale_days: number;
}

export interface MemoryReviewCandidateSelectionThresholds {
  importanceThreshold: number;
  staleDays: number;
  maxCandidates: number;
}

export interface MemoryReviewCandidateSelectionOptions extends MemoryReviewCandidateSelectionThresholds {
  now: Date;
}

export interface MemoryReviewCandidateSelectionItem {
  memory_id: string;
  priority: number;
  score_breakdown: MemoryReviewCandidateScoreBreakdown;
  reason: string;
}
