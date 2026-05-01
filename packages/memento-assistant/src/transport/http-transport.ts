// packages/memento-assistant/src/transport/http-transport.ts
import { MementoClient } from '@memento/client';
import type { Transport, RecallResult, RememberParams, RememberResult } from './transport.js';

export interface HttpTransportOptions {
  baseUrl: string;
  token?: string;
}

export class HttpTransport implements Transport {
  private client: MementoClient;
  private connected = false;

  constructor(opts: HttpTransportOptions) {
    // Adapt HttpTransportOptions → actual MementoClientOptions (serverUrl / apiKey)
    this.client = new MementoClient({ serverUrl: opts.baseUrl, apiKey: opts.token });
  }

  async connect(): Promise<void> {
    if (this.connected) return;
    await this.client.connect();
    this.connected = true;
  }

  async recall(query: string, filters?: any, limit?: number): Promise<RecallResult> {
    if (!this.connected) await this.connect();
    // filters shape from Transport ({ tags?, ownerId?, type? }) is a subset of
    // MementoClient SearchFilters; pass through with `as any` to avoid type friction
    const r = await this.client.recall(query, filters as any, limit);
    return { items: r.items };
  }

  async remember(params: RememberParams): Promise<RememberResult> {
    if (!this.connected) await this.connect();
    const r = await this.client.remember({
      content: params.content,
      type: params.type,
      tags: params.tags,
      importance: params.importance,
      // update_existing is not in CreateMemoryParams — cast to any
      ...(params.updateExisting ? { update_existing: { id: params.updateExisting.id } } : {}),
    } as any);
    // MementoClient RememberResult uses memory_id; Transport RememberResult uses id
    return { id: (r as any).memory_id ?? (r as any).id };
  }

  async close(): Promise<void> {
    if (!this.connected) return;
    try { await this.client.disconnect(); } catch { /* ignore */ }
    this.connected = false;
  }
}
