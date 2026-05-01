// packages/memento-assistant/src/transport/stdio-transport.ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { Transport, RecallResult, RememberParams, RememberResult } from './transport.js';

export interface StdioTransportOptions {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}

export class StdioTransport implements Transport {
  private client: Client | null = null;
  private inner: StdioClientTransport | null = null;
  private connected = false;

  constructor(private readonly opts: StdioTransportOptions) {}

  async connect(): Promise<void> {
    if (this.connected) return;
    this.inner = new StdioClientTransport({
      command: this.opts.command,
      args: this.opts.args ?? [],
      env: { ...process.env, ...(this.opts.env ?? {}) } as Record<string, string>,
      cwd: this.opts.cwd,
    });
    this.client = new Client({ name: 'memento-assistant', version: '0.1.0' }, { capabilities: {} });
    await this.client.connect(this.inner);
    this.connected = true;
  }

  async recall(query: string, filters?: any, limit?: number): Promise<RecallResult> {
    if (!this.client) await this.connect();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = await this.client!.callTool({
      name: 'recall',
      arguments: { query, ...(filters ?? {}), limit },
    }) as any; // SDK return type is a Zod-inferred object; cast to avoid structural mismatch
    return parseToolJson<RecallResult>(r) ?? { items: [] };
  }

  async remember(params: RememberParams): Promise<RememberResult> {
    if (!this.client) await this.connect();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = await this.client!.callTool({
      name: 'remember',
      arguments: params as any, // RememberParams lacks index signature required by SDK
    }) as any; // SDK return type is a Zod-inferred object; cast to avoid structural mismatch
    const out = parseToolJson<RememberResult>(r);
    if (!out) throw new Error('memento remember: empty response');
    return out;
  }

  async close(): Promise<void> {
    if (!this.connected) return;
    try { await this.client?.close(); } catch { /* ignore */ }
    this.connected = false;
    this.client = null;
    this.inner = null;
  }
}

function parseToolJson<T>(resp: { content?: Array<{ type: string; json?: unknown; text?: string }> }): T | null {
  for (const part of resp.content ?? []) {
    if (part.type === 'json' && part.json !== undefined) return part.json as T;
    if (part.type === 'text' && part.text) {
      try { return JSON.parse(part.text) as T; } catch { /* continue */ }
    }
  }
  return null;
}
