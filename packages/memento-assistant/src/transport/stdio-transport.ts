// packages/memento-assistant/src/transport/stdio-transport.ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { Transport, RecallParams, RecallResult, RememberParams, RememberResult } from './transport.js';

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
  private connecting: Promise<void> | null = null;

  constructor(private readonly opts: StdioTransportOptions) {}

  async connect(): Promise<void> {
    if (this.connected) return;
    if (this.connecting) return this.connecting;
    this.connecting = (async () => {
      const inner = new StdioClientTransport({
        command: this.opts.command,
        args: this.opts.args ?? [],
        env: { ...process.env, ...(this.opts.env ?? {}) } as Record<string, string>,
        cwd: this.opts.cwd,
      });
      const client = new Client({ name: 'memento-assistant', version: '0.1.0' }, { capabilities: {} });
      try {
        await client.connect(inner);
      } catch (err) {
        try { await inner.close(); } catch { /* ignore */ }
        throw err;
      }
      this.inner = inner;
      this.client = client;
      this.connected = true;
    })().finally(() => { this.connecting = null; });
    return this.connecting;
  }

  async recall(query: string, filters?: RecallParams['filters'], limit?: number): Promise<RecallResult> {
    if (!this.connected) await this.connect();
    const r = await this.client!.callTool({
      name: 'recall',
      arguments: { query, ...(filters ?? {}), limit },
    });
    return parseToolJson<RecallResult>(r) ?? { items: [] };
  }

  async remember(params: RememberParams): Promise<RememberResult> {
    if (!this.connected) await this.connect();
    const r = await this.client!.callTool({
      name: 'remember',
      arguments: { ...params },
    });
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

function parseToolJson<T>(resp: unknown): T | null {
  const content = getToolResponseContent(resp);
  for (const part of content) {
    if (part.type === 'json' && part.json !== undefined) return part.json as T;
    if (part.type === 'text' && part.text) {
      try { return JSON.parse(part.text) as T; } catch { /* continue */ }
    }
  }
  return null;
}

function getToolResponseContent(resp: unknown): Array<{ type: string; json?: unknown; text?: string }> {
  if (typeof resp !== 'object' || resp === null || !('content' in resp)) {
    return [];
  }
  const content = (resp as { content?: unknown }).content;
  if (!Array.isArray(content)) {
    return [];
  }
  return content.flatMap((part) => {
    if (typeof part !== 'object' || part === null) return [];
    const candidate = part as { type?: unknown; json?: unknown; text?: unknown };
    if (typeof candidate.type !== 'string') return [];
    return [{
      type: candidate.type,
      json: candidate.json,
      ...(typeof candidate.text === 'string' ? { text: candidate.text } : {})
    }];
  });
}
