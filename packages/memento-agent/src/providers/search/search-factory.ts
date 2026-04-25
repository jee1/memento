import type { SearchProvider } from './search-provider.js';
import { NoopSearchProvider } from './noop-search-provider.js';

export function createSearchProvider(): SearchProvider {
  const name = process.env.MEMENTO_AGENT_SEARCH ?? 'noop';
  switch (name) {
    case 'noop':
      return new NoopSearchProvider();
    case 'memento':
      throw new Error('Memento search provider not yet implemented (Phase 2)');
    default:
      throw new Error(`Unknown search provider: ${name}`);
  }
}
