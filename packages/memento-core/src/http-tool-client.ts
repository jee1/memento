import type {
  CoreRememberParams,
  CoreRememberResult,
  CoreRecallParams,
  CoreRecallResult,
} from './types.js';

export interface CoreToolHttpClientOptions {
  serverUrl: string;
  fetchImpl?: typeof fetch;
}

export function createCoreToolHttpClient(options: CoreToolHttpClientOptions) {
  const baseUrl = options.serverUrl.replace(/\/$/, '');
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    async remember(params: CoreRememberParams): Promise<CoreRememberResult> {
      const response = await fetchImpl(`${baseUrl}/tools/remember`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
      if (!response.ok) throw new Error(`remember failed: ${response.status}`);
      const data = (await response.json()) as { result: CoreRememberResult };
      return data.result;
    },

    async recall(params: CoreRecallParams): Promise<CoreRecallResult> {
      const response = await fetchImpl(`${baseUrl}/tools/recall`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
      if (!response.ok) throw new Error(`recall failed: ${response.status}`);
      const data = (await response.json()) as {
        result: { items?: { items?: unknown[] } | unknown[] };
      };
      const rawItems = Array.isArray(data.result.items)
        ? data.result.items
        : data.result.items?.items ?? [];
      return {
        items: rawItems.map((item) => {
          const row = item as Record<string, unknown>;
          return {
            id: (row.id ?? row.memory_id) as string,
            content: row.content as string,
            tags: row.tags as string[] | undefined,
            process_id: row.process_id as string | undefined,
            session_id: row.session_id as string | undefined,
            origin_source: row.origin_source as CoreRecallResult['items'][0]['origin_source'],
          };
        }),
      };
    },
  };
}
