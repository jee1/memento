import { ErrorCategory, type AppErrorContract } from '../../../shared/types/error-types.js';

export const MEMORY_REVIEW_CANDIDATE_NOT_FOUND = 'memory_review_candidate_not_found';
export const MEMORY_REVIEW_CANDIDATE_NOT_ACTIONABLE = 'memory_review_candidate_not_actionable';

export class MemoryReviewCandidateError extends Error implements AppErrorContract {
  readonly code: string;
  readonly category = ErrorCategory.MEMORY;
  readonly statusCode: number;

  constructor(message: string, code: string, statusCode: number) {
    super(message);
    this.name = 'MemoryReviewCandidateError';
    this.code = code;
    this.statusCode = statusCode;
  }

  static notFound(id: string): MemoryReviewCandidateError {
    return new MemoryReviewCandidateError(
      `Memory review candidate not found: ${id}`,
      MEMORY_REVIEW_CANDIDATE_NOT_FOUND,
      404,
    );
  }

  static notActionable(id: string, status: string): MemoryReviewCandidateError {
    return new MemoryReviewCandidateError(
      `Memory review candidate is not actionable (id=${id}, status=${status})`,
      MEMORY_REVIEW_CANDIDATE_NOT_ACTIONABLE,
      409,
    );
  }
}
