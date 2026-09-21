import type { Request } from 'express';
import { describe, expect, it } from 'vitest';
import {
  decodeMcpHeaderValue,
  hasModernProtocolClaim,
  mapModernJsonRpcErrorHttpStatus,
  MODERN_PROTOCOL_VERSION,
  validateModernRequest,
} from './modern-request-validation.js';
import type { McpRequestMessage } from './types.js';

function mockReq(headers: Record<string, string>): Request {
  return {
    get(name: string) {
      const key = Object.keys(headers).find(h => h.toLowerCase() === name.toLowerCase());
      return key ? headers[key] : undefined;
    },
  } as Request;
}

function modernMessage(
  method: string,
  params: Record<string, unknown> = {},
  id = 1,
): McpRequestMessage {
  return {
    jsonrpc: '2.0',
    id,
    method,
    params: {
      ...params,
      _meta: {
        'io.modelcontextprotocol/protocolVersion': MODERN_PROTOCOL_VERSION,
        'io.modelcontextprotocol/clientInfo': { name: 'spec-client', version: '1.0.0' },
        'io.modelcontextprotocol/clientCapabilities': {},
        ...(params._meta as Record<string, unknown> | undefined),
      },
    },
  };
}

describe('modern-request-validation', () => {
  it('detects modern protocol claim from params._meta', () => {
    expect(hasModernProtocolClaim(modernMessage('tools/list'))).toBe(true);
    expect(hasModernProtocolClaim({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })).toBe(
      false,
    );
    expect(hasModernProtocolClaim(null)).toBe(false);
    expect(hasModernProtocolClaim(42)).toBe(false);
    expect(hasModernProtocolClaim('not-an-object')).toBe(false);
  });

  it('decodes RFC 2047 base64 sentinel values safely', () => {
    expect(decodeMcpHeaderValue('remember')).toBe('remember');
    expect(decodeMcpHeaderValue('=?base64?cmVtZW1iZXI=?=')).toBe('remember');
    expect(decodeMcpHeaderValue('=?base64?!!!?=')).toBeNull();
    expect(decodeMcpHeaderValue('x'.repeat(9000))).toBeNull();
  });

  it('maps modern JSON-RPC errors to HTTP statuses', () => {
    expect(mapModernJsonRpcErrorHttpStatus(-32022)).toBe(400);
    expect(mapModernJsonRpcErrorHttpStatus(-32020)).toBe(400);
    expect(mapModernJsonRpcErrorHttpStatus(-32021)).toBe(400);
    expect(mapModernJsonRpcErrorHttpStatus(-32602)).toBe(400);
    expect(mapModernJsonRpcErrorHttpStatus(-32601)).toBe(404);
    expect(mapModernJsonRpcErrorHttpStatus(-32603)).toBe(500);
  });

  it('requires _meta protocolVersion and clientCapabilities', () => {
    const missingMeta = validateModernRequest(
      mockReq({ 'MCP-Protocol-Version': MODERN_PROTOCOL_VERSION, 'Mcp-Method': 'tools/list' }),
      { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
      [MODERN_PROTOCOL_VERSION],
    );
    expect(missingMeta?.response.error?.code).toBe(-32602);

    const missingCaps = validateModernRequest(
      mockReq({ 'MCP-Protocol-Version': MODERN_PROTOCOL_VERSION, 'Mcp-Method': 'tools/list' }),
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
        params: {
          _meta: { 'io.modelcontextprotocol/protocolVersion': MODERN_PROTOCOL_VERSION },
        },
      },
      [MODERN_PROTOCOL_VERSION],
    );
    expect(missingCaps?.response.error?.code).toBe(-32602);
  });

  it('rejects header/body mismatches with -32020', () => {
    const message = modernMessage('tools/call', { name: 'remember', arguments: {} });
    const failure = validateModernRequest(
      mockReq({
        'MCP-Protocol-Version': MODERN_PROTOCOL_VERSION,
        'Mcp-Method': 'tools/call',
        'Mcp-Name': 'recall',
      }),
      message,
      [MODERN_PROTOCOL_VERSION],
    );
    expect(failure?.response.error?.code).toBe(-32020);
    expect(failure?.httpStatus).toBe(400);
  });

  it('does not require Mcp-Name for tools/list', () => {
    const message = modernMessage('tools/list');
    const failure = validateModernRequest(
      mockReq({
        'MCP-Protocol-Version': MODERN_PROTOCOL_VERSION,
        'Mcp-Method': 'tools/list',
      }),
      message,
      [MODERN_PROTOCOL_VERSION],
    );
    expect(failure).toBeNull();
  });

  it('requires Mcp-Name for tools/call and compares decoded values', () => {
    const message = modernMessage('tools/call', { name: '한글도구', arguments: {} });
    const failure = validateModernRequest(
      mockReq({
        'MCP-Protocol-Version': MODERN_PROTOCOL_VERSION,
        'Mcp-Method': 'tools/call',
        'Mcp-Name': '=?base64?7ZWc6riA64+E6rWs?=',
      }),
      message,
      [MODERN_PROTOCOL_VERSION],
    );
    expect(failure).toBeNull();
  });

  it('rejects unsupported protocol versions with -32022', () => {
    const message = modernMessage('tools/list', {
      _meta: {
        'io.modelcontextprotocol/protocolVersion': '2099-01-01',
        'io.modelcontextprotocol/clientCapabilities': {},
      },
    });
    const failure = validateModernRequest(
      mockReq({
        'MCP-Protocol-Version': '2099-01-01',
        'Mcp-Method': 'tools/list',
      }),
      message,
      [MODERN_PROTOCOL_VERSION],
    );
    expect(failure?.response.error?.code).toBe(-32022);
  });
});
