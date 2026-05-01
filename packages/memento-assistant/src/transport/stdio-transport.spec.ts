// packages/memento-assistant/src/transport/stdio-transport.spec.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StdioTransport } from './stdio-transport.js';

// Real MCP server returns { content: [{ type: 'text', text: JSON.stringify(...) }] }
// (verified in packages/memento-core/src/tools/base-tool.ts). parseToolJson supports
// both 'json' and 'text' shapes — the mock uses both to prevent drift.
vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: vi.fn().mockImplementation(() => ({
    connect: vi.fn().mockResolvedValue(undefined),
    callTool: vi.fn().mockImplementation(async ({ name, arguments: args }: any) => {
      if (name === 'recall') {
        // Real server shape: type:'text' + JSON.stringify
        return { content: [{ type: 'text', text: JSON.stringify({ items: [{ id: 'm:1', content: 'hi', type: 'semantic' }] }) }] };
      }
      if (name === 'remember') {
        // Alternative allowed shape: type:'json' + json directly
        return { content: [{ type: 'json', json: { id: 'm:2' } }] };
      }
      throw new Error(`unknown tool ${name}`);
    }),
    close: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: vi.fn().mockImplementation(() => ({})),
}));

describe('StdioTransport', () => {
  it('spawns child with default command and forwards recall', async () => {
    const t = new StdioTransport({ command: 'npx', args: ['-y', 'memento-mcp-server@latest'] });
    await t.connect();
    const r = await t.recall('hi', undefined, 1);
    expect(r.items).toHaveLength(1);
    expect(r.items[0].id).toBe('m:1');
  });

  it('forwards remember', async () => {
    const t = new StdioTransport({ command: 'npx', args: ['-y', 'memento-mcp-server@latest'] });
    await t.connect();
    const r = await t.remember({ content: 'x', type: 'working' });
    expect(r.id).toBe('m:2');
  });

  it('close is idempotent', async () => {
    const t = new StdioTransport({ command: 'x', args: [] });
    await t.connect();
    await t.close();
    await t.close();
  });
});
