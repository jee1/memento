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

export interface ListMemoryReviewCandidatesQuery {
  status?: MemoryReviewCandidateStatus;
}
