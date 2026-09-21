export type MemoryReviewCandidateStatus = 'pending' | 'reviewed' | 'dismissed' | 'expired';

/** DB row shape for `memory_review_candidate` */
export interface MemoryReviewCandidateRow {
  id: string;
  memory_id: string;
  status: MemoryReviewCandidateStatus;
  priority: number;
  reason: string;
  due_at: string;
  created_at: string;
  updated_at: string;
  reviewed_at: string | null;
  dismissed_at: string | null;
  metadata_json: string | null;
}

/** One pending upsert row (aligned with #241 selection output fields used by batch) */
export interface UpsertPendingMemoryReviewCandidateInput {
  memory_id: string;
  priority: number;
  reason: string;
  due_at: string;
  metadata_json?: string | null;
}

export interface UpsertPendingMemoryReviewCandidatesResult {
  inserted: number;
  updated: number;
}

export type BulkMemoryReviewCandidateSelector =
  | { ids: string[] }
  | { older_than_days: number }
  | { all_pending: true };

export type BulkMemoryReviewCandidateAction = 'dismiss' | 'expire';

export interface BulkMemoryReviewCandidatesResult {
  matched: number;
  updated: number;
}

export type MemoryReviewCandidateUnusedAnchor = 'last_recalled_at' | 'created_at_fallback';

export interface MemoryReviewCandidateListItem extends MemoryReviewCandidateRow {
  memory_type: string;
  importance: number;
  unused_days: number;
  unused_anchor: MemoryReviewCandidateUnusedAnchor;
}

export interface MemoryReviewCandidatePagination {
  page: number;
  page_size: 25 | 50;
  total_count: number;
  total_pages: number;
  has_prev: boolean;
  has_next: boolean;
}

export interface MemoryReviewCandidateFiltersApplied {
  status?: MemoryReviewCandidateStatus;
  importance_min?: number;
  importance_max?: number;
  unused_days_min?: number;
  unused_days_max?: number;
  memory_type?: string;
  reason_contains?: string;
}

export interface QueryMemoryReviewCandidatesInput extends MemoryReviewCandidateFiltersApplied {
  status?: MemoryReviewCandidateStatus;
  page?: number;
  page_size?: 25 | 50;
}

export interface MemoryReviewCandidatesQueryResult {
  candidates: MemoryReviewCandidateListItem[];
  pagination?: MemoryReviewCandidatePagination;
  filters_applied: MemoryReviewCandidateFiltersApplied;
}

export interface ListMemoryReviewCandidatesQuery {
  status?: MemoryReviewCandidateStatus;
}
