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
