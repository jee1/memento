import type { SupersedeVerdict } from './supersede-judge.js';

export const SUPERSEDE_CANDIDATE_LIFECYCLE_STATUSES = [
  'not_applied',
  'applied',
  'restored',
  'dismissed',
] as const;

export type SupersedeCandidateLifecycleStatus = (typeof SUPERSEDE_CANDIDATE_LIFECYCLE_STATUSES)[number];

export const SUPERSEDE_LIST_DEFAULT_VERDICTS: SupersedeVerdict[] = ['confirmed', 'pending'];

export interface QuerySupersedeCandidatesInput {
  verdict?: SupersedeVerdict;
  project_id?: string | null;
  lifecycle_status?: SupersedeCandidateLifecycleStatus;
  page?: number;
  page_size?: 25 | 50;
}

export interface SupersedeCandidateFiltersApplied {
  verdict?: SupersedeVerdict | SupersedeVerdict[];
  project_id?: string | null;
  lifecycle_status?: SupersedeCandidateLifecycleStatus;
}

export interface SupersedeCandidateListItem {
  id: string;
  verdict: SupersedeVerdict;
  lifecycle_status: SupersedeCandidateLifecycleStatus;
  project_id: string | null;
  memory_type: string;
  old_memory_id: string;
  new_memory_id: string;
  old_content_preview: string;
  new_content_preview: string;
  rationale: string;
  provider: string;
  model: string;
  judged_at: string;
  dismissed_at: string | null;
  supersede_apply_enabled: boolean;
}

export interface SupersedeCandidatePagination {
  page: number;
  page_size: number;
  total_count: number;
  total_pages: number;
  has_prev: boolean;
  has_next: boolean;
}

export interface SupersedeCandidatesQueryResult {
  candidates: SupersedeCandidateListItem[];
  pagination: SupersedeCandidatePagination;
  filters_applied: SupersedeCandidateFiltersApplied;
}
