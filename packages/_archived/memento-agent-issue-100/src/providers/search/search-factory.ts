import type { SearchProvider } from './search-provider.js';
import { NoopSearchProvider } from './noop-search-provider.js';
import { BraveSearchProvider } from './brave-search-provider.js';

export function createSearchProvider(): SearchProvider {
  const name = process.env.MEMENTO_AGENT_SEARCH ?? 'none';
  switch (name) {
    case 'brave':
      return new BraveSearchProvider(process.env.BRAVE_API_KEY ?? '');
    case 'playwright':
      throw new Error('playwright not installed. Run: npm install playwright');
    default:
      return new NoopSearchProvider();
  }
}
