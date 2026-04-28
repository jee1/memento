import type { SearchResult } from '../../core/types.js';

export interface SearchProvider {
  search(query: string, timeoutMs?: number): Promise<SearchResult[]>;
}
