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
  StdioClientTransport: vi.fn().mockImplementation(() => ({ close: vi.fn().mockResolvedValue(undefined) })),
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

  it('remember throws on empty response', async () => {
    const t = new StdioTransport({ command: 'npx', args: [] });
    await t.connect();
    // Override callTool to return empty content for this test
    const mockCallTool = vi.fn().mockResolvedValue({ content: [] });
    (t as any).client.callTool = mockCallTool;
    await expect(t.remember({ content: 'x', type: 'working' })).rejects.toThrow('memento remember: empty response');
  });

  it('connect is idempotent — concurrent calls do not double-spawn', async () => {
    const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
    const MockStdio = StdioClientTransport as any;
    MockStdio.mockClear();
    const t = new StdioTransport({ command: 'npx', args: [] });
    await Promise.all([t.connect(), t.connect()]);
    expect(MockStdio).toHaveBeenCalledTimes(1);
  });

  it('connect failure cleans up — inner transport close is called', async () => {
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
    const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
    const MockClient = Client as any;
    const MockStdio = StdioClientTransport as any;
    MockClient.mockClear();
    MockStdio.mockClear();
    // First connect: fail
    MockClient.mockImplementationOnce(() => ({
      connect: vi.fn().mockRejectedValue(new Error('spawn failed')),
      close: vi.fn(),
      callTool: vi.fn(),
    }));
    const t = new StdioTransport({ command: 'npx', args: [] });
    await expect(t.connect()).rejects.toThrow('spawn failed');
    // connected stays false — recall() will retry connect()
    expect((t as any).connected).toBe(false);
    // inner transport must be closed for cleanup (orphaned process prevention)
    const innerInstance = MockStdio.mock.results[0]?.value;
    expect(innerInstance?.close).toHaveBeenCalledTimes(1);
  });
});
