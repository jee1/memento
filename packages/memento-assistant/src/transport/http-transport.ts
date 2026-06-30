// packages/memento-assistant/src/transport/http-transport.ts
import { MementoClient } from '@memento/client';
import type { CreateMemoryParams, RememberResult as ClientRememberResult, SearchFilters } from '@memento/client';
import type { Transport, RecallParams, RecallResult, RememberParams, RememberResult } from './transport.js';

export interface HttpTransportOptions {
  baseUrl: string;
  token?: string;
}

type AssistantCreateMemoryParams = CreateMemoryParams & {
  update_existing?: { id: string };
};

type ClientRememberResultWithLegacyId = ClientRememberResult & {
  id?: string;
};

export class HttpTransport implements Transport {
  private client: MementoClient;
  private connected = false;
  private connecting: Promise<void> | null = null;

  constructor(opts: HttpTransportOptions) {
    // Adapt HttpTransportOptions → actual MementoClientOptions (serverUrl / apiKey)
    this.client = new MementoClient({ serverUrl: opts.baseUrl, apiKey: opts.token });
  }

  async connect(): Promise<void> {
    if (this.connected) return;
    if (this.connecting) return this.connecting;
    this.connecting = (async () => {
      await this.client.connect();
      this.connected = true;
    })().finally(() => { this.connecting = null; });
    return this.connecting;
  }

  async recall(query: string, filters?: RecallParams['filters'], limit?: number): Promise<RecallResult> {
    if (!this.connected) await this.connect();
    const r = await this.client.recall(query, toClientSearchFilters(filters), limit);
    return { items: r.items };
  }

  async remember(params: RememberParams): Promise<RememberResult> {
    if (!this.connected) await this.connect();
    const createParams: AssistantCreateMemoryParams = {
      content: params.content,
      type: params.type,
      tags: params.tags,
      importance: params.importance,
      ...(params.updateExisting ? { update_existing: { id: params.updateExisting.id } } : {}),
    };
    const r: ClientRememberResultWithLegacyId = await this.client.remember(createParams);
    // MementoClient RememberResult uses memory_id; Transport RememberResult uses id
    return { id: r.memory_id ?? r.id ?? '' };
  }

  async close(): Promise<void> {
    if (!this.connected) return;
    try { await this.client.disconnect(); } catch { /* ignore */ }
    this.connected = false;
  }
}

function toClientSearchFilters(filters: RecallParams['filters']): SearchFilters | undefined {
  if (!filters) return undefined;
  const out: SearchFilters = {
    tags: filters.tags,
  };
  if (filters.type) {
    out.type = filters.type.filter(isClientMemoryType);
  }
  return out;
}

function isClientMemoryType(type: string): type is NonNullable<SearchFilters['type']>[number] {
  return type === 'working' || type === 'episodic' || type === 'semantic' || type === 'procedural';
}
