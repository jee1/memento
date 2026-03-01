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
        result: { items?: { items?: CoreRecallResult['items'] } | CoreRecallResult['items'] };
      };
      const rawItems = Array.isArray(data.result.items)
        ? data.result.items
        : data.result.items?.items ?? [];
      return { items: rawItems };
    },
  };
}
