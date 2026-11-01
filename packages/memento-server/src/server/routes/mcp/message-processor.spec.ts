import { describe, it, expect, vi, afterEach } from 'vitest';
import { SUPPORTED_PROTOCOL_VERSIONS } from '@modelcontextprotocol/sdk/types.js';
import packageJson from '../../../../package.json' with { type: 'json' };
import { getDiscoverSupportedVersions, processMcpMessage } from './message-processor.js';
import { MODERN_PROTOCOL_VERSION } from './modern-request-validation.js';

describe('message-processor server/discover (#840)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('#840: server/discover 가 SDK 의 지원 버전 목록을 그대로 광고한다', async () => {
    const response = await processMcpMessage(
      { jsonrpc: '2.0', id: 1, method: 'server/discover' },
      null,
      null,
    );
    const result = response.result as { supportedVersions: string[] };
    expect(result.supportedVersions).toEqual(getDiscoverSupportedVersions());
  });

  it('#840 Phase 1b: modern 서비스 활성 시 server/discover 가 2026-07-28 을 광고한다', async () => {
    vi.stubEnv('MEMENTO_MCP_ERA', 'dual');
    const { getDiscoverSupportedVersions: getVersions } = await import('./message-processor.js');
    expect(getVersions()).toContain(MODERN_PROTOCOL_VERSION);
    const response = await processMcpMessage(
      { jsonrpc: '2.0', id: 2, method: 'server/discover' },
      null,
      null,
    );
    const result = response.result as { supportedVersions: string[] };
    expect(result.supportedVersions[0]).toBe(MODERN_PROTOCOL_VERSION);
  });

  it('#840 Phase 1b: legacy-only gate 에서는 2026-07-28 을 광고하지 않는다', async () => {
    vi.stubEnv('MEMENTO_MCP_ERA', 'legacy');
    vi.resetModules();
    const { getDiscoverSupportedVersions: getVersions, processMcpMessage: process } = await import(
      './message-processor.js',
    );
    expect(getVersions()).not.toContain(MODERN_PROTOCOL_VERSION);
    const response = await process(
      { jsonrpc: '2.0', id: 2, method: 'server/discover' },
      null,
      null,
    );
    const result = response.result as { supportedVersions: string[] };
    expect(result.supportedVersions).toEqual([...SUPPORTED_PROTOCOL_VERSIONS]);
  });

  it('#840: server/discover 의 capabilities 가 initialize 와 같다', async () => {
    const discoverResponse = await processMcpMessage(
      { jsonrpc: '2.0', id: 3, method: 'server/discover' },
      null,
      null,
    );
    const initializeResponse = await processMcpMessage(
      { jsonrpc: '2.0', id: 4, method: 'initialize', params: {} },
      null,
      null,
    );
    const discoverResult = discoverResponse.result as { capabilities: unknown };
    const initializeResult = initializeResponse.result as { capabilities: unknown };
    expect(discoverResult.capabilities).toEqual(initializeResult.capabilities);
  });

  it('#840: modern era initialize 는 Method not found', async () => {
    const response = await processMcpMessage(
      { jsonrpc: '2.0', id: 6, method: 'initialize', params: {} },
      null,
      null,
      { transport: 'mcp_http' },
      { modernEra: true },
    );
    expect(response.error?.code).toBe(-32601);
  });

  it('#840: server/discover 가 serverInfo 를 _meta 에 싣는다', async () => {
    const response = await processMcpMessage(
      { jsonrpc: '2.0', id: 5, method: 'server/discover' },
      null,
      null,
    );
    const result = response.result as {
      _meta: Record<string, { name: string; version: string }>;
    };
    const serverInfo = result._meta['io.modelcontextprotocol/serverInfo'];
    expect(serverInfo.name).toBe('memento-mcp-server');
    expect(serverInfo.version).toBe(packageJson.version);
  });
});

describe('#1552 MCP current ID resources and explicit history', () => {
  it('lists current records and keeps history inside bound owner/project', async () => {
    const { default: Database } = await import('better-sqlite3');
    const db = new Database(':memory:');
    try {
      db.exec(`CREATE TABLE memory_item (
        id TEXT PRIMARY KEY, type TEXT, content TEXT, importance REAL, privacy_scope TEXT,
        tags TEXT, source TEXT, created_at TEXT, last_accessed TEXT, pinned INTEGER,
        owner_id TEXT, project_id TEXT, is_deleted INTEGER DEFAULT 0, superseded_by TEXT);
        INSERT INTO memory_item (id, type, content, owner_id, project_id, superseded_by) VALUES
        ('old', 'semantic', 'old body', 'a', 'p', 'target'),
        ('target', 'semantic', 'new body', 'a', 'p', NULL),
        ('foreign-owner', 'semantic', 'foreign body', 'b', 'p', NULL),
        ('foreign-project', 'semantic', 'foreign body', 'a', 'q', NULL);
        INSERT INTO memory_item (id, is_deleted, owner_id, project_id) VALUES ('deleted', 1, 'a', 'p');`);
      const audit = { transport: 'mcp_http' as const, boundAgentId: 'a', boundProjectId: 'p' };
      const list = await processMcpMessage({ jsonrpc: '2.0', id: 1, method: 'resources/list' }, db, null, audit);
      expect(list.result).toEqual({ resources: [expect.objectContaining({ uri: 'memory://target' })] });
      const read = (uri: string) => processMcpMessage({ jsonrpc: '2.0', id: 2, method: 'resources/read', params: { uri } }, db, null, audit);
      expect((await read('memory://old')).error?.code).toBe(-32602);
      const history = await read('memory://old?include_superseded=true');
      expect(history.error).toBeUndefined();
      expect(JSON.parse((history.result as { contents: Array<{ text: string }> }).contents[0]!.text).id).toBe('old');
      for (const id of ['foreign-owner', 'foreign-project']) {
        expect((await read(`memory://${id}?include_superseded=true`)).error?.code).toBe(-32602);
      }
      expect((await read('memory://deleted?include_superseded=true')).error?.code).toBe(-32602);
      expect((await read('memory://old?include_superseded=yes')).error?.code).toBe(-32602);
    } finally {
      db.close();
    }
  });
});
