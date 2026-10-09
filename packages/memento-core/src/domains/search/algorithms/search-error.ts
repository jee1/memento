export enum SearchErrorType {
  EMBEDDING_GENERATION_FAILED = 'EMBEDDING_GENERATION_FAILED',
  VECTOR_SEARCH_FAILED = 'VECTOR_SEARCH_FAILED',
  TEXT_SEARCH_FAILED = 'TEXT_SEARCH_FAILED',
  RESULT_COMBINATION_FAILED = 'RESULT_COMBINATION_FAILED',
}

export class SearchError extends Error {
  constructor(
    public type: SearchErrorType,
    message: string,
    public originalError?: Error,
    public context?: unknown
  ) {
    super(message);
    this.name = 'SearchError';
  }
}
