import type { SearchProvider } from './search-provider.js';
import type { SearchResult } from '../../core/types.js';

export class NoopSearchProvider implements SearchProvider {
  async search(_query: string): Promise<SearchResult[]> {
    return [];
  }
}
