import { logger } from '../../../shared/utils/logger.js';
import type { HybridSearchQuery, ISearchLogger } from './hybrid-search-types.js';

export class SearchLogger implements ISearchLogger {
  logSearchStart(_searchId: string, _query: HybridSearchQuery): void {
    // Intentionally quiet by default; detailed steps are logged through logSearchStep().
  }

  logSearchStep(searchId: string, step: string, data: unknown): void {
    logger.debug(`하이브리드 검색 단계: ${step}`, {
      searchId,
      step,
      data,
    });
  }

  logSearchComplete(
    _searchId: string,
    _result: { items: unknown[]; total_count: number },
    _queryTime: number
  ): void {
    // Intentionally quiet by default; callers can inject a logger for verbose completion logs.
  }

  logSearchError(_searchId: string, _error: unknown, _query: HybridSearchQuery): void {
    // Intentionally quiet by default; the caller receives the original error.
  }

  logExperiment(_searchId: string, _experimentId: string, _variant: Record<string, unknown>): void {
    // Intentionally quiet by default; callers can inject a logger for experiment telemetry.
  }
}
