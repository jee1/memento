import type { SearchProvider } from './search-provider.js';
import type { SearchResult } from '../../core/types.js';

export class BraveSearchProvider implements SearchProvider {
  constructor(private readonly apiKey: string) {}

  async search(query: string, timeoutMs = 10000): Promise<SearchResult[]> {
    if (!this.apiKey) return [];

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(
        `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5`,
        {
          headers: {
            'Accept': 'application/json',
            'X-Subscription-Token': this.apiKey,
          },
          signal: controller.signal,
        }
      );

      if (!response.ok) return [];

      const data = await response.json() as {
        web?: { results?: Array<{ title: string; url: string; description: string }> };
      };

      return (data.web?.results ?? []).map((r) => ({
        title: r.title,
        url: r.url,
        snippet: r.description,
      }));
    } catch {
      return [];
    } finally {
      clearTimeout(timer);
    }
  }
}
