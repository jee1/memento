import { describe, it, expect } from 'vitest';
import { SUPPORTED_PROTOCOL_VERSIONS } from '@modelcontextprotocol/sdk/types.js';
import packageJson from '../../../../package.json' with { type: 'json' };
import { processMcpMessage } from './message-processor.js';

describe('message-processor server/discover (#840)', () => {
  it('#840: server/discover 가 SDK 의 지원 버전 목록을 그대로 광고한다', async () => {
    const response = await processMcpMessage(
      { jsonrpc: '2.0', id: 1, method: 'server/discover' },
      null,
      null,
    );
    const result = response.result as { supportedVersions: string[] };
    expect(result.supportedVersions).toEqual([...SUPPORTED_PROTOCOL_VERSIONS]);
  });

  it('#840: server/discover 는 아직 2026-07-28 을 광고하지 않는다', async () => {
    const response = await processMcpMessage(
      { jsonrpc: '2.0', id: 2, method: 'server/discover' },
      null,
      null,
    );
    const result = response.result as { supportedVersions: string[] };
    expect(result.supportedVersions).not.toContain('2026-07-28');
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
