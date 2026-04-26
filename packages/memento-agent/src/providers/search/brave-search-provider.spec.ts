import { describe, it, expect, vi, afterEach } from 'vitest';
import { BraveSearchProvider } from './brave-search-provider.js';

afterEach(() => { vi.unstubAllGlobals(); });

describe('BraveSearchProvider', () => {
  it('returns empty array when API key is missing', async () => {
    const provider = new BraveSearchProvider('');
    const results = await provider.search('test query');
    expect(results).toEqual([]);
  });

  it('maps API response to SearchResult[]', async () => {
    const provider = new BraveSearchProvider('fake-key');
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        web: {
          results: [
            { title: 'Title 1', url: 'https://a.com', description: 'Desc 1' },
          ],
        },
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const results = await provider.search('test query');
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      title: 'Title 1',
      url: 'https://a.com',
      snippet: 'Desc 1',
    });
  });
});
