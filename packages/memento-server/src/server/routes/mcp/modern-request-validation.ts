import type { Request } from 'express';
import { createJsonRpcError } from './json-rpc.js';
import type { JsonRpcResponse, McpRequestMessage } from './types.js';

export const MODERN_PROTOCOL_VERSION = '2026-07-28';

/** ponytail: cap decoded header bytes; upgrade path is raise constant + spec review */
const MAX_MCP_HEADER_VALUE_BYTES = 8_192;

const MCP_NAME_BASE64_SENTINEL = /^=\?base64\?([A-Za-z0-9+/=]+)\?=$/;

export type ModernValidationFailure = {
  response: JsonRpcResponse;
  httpStatus: number;
};

function invalidParams(id: unknown, detail: string): ModernValidationFailure {
  return {
    response: createJsonRpcError(id, -32602, `Invalid params: ${detail}`),
    httpStatus: 400,
  };
}

function headerMismatch(id: unknown, detail: string): ModernValidationFailure {
  return {
    response: createJsonRpcError(id, -32020, `Header mismatch: ${detail}`),
    httpStatus: 400,
  };
}

function unsupportedVersion(id: unknown, supported: readonly string[]): ModernValidationFailure {
  return {
    response: createJsonRpcError(id, -32022, 'Unsupported protocol version', { supported }),
    httpStatus: 400,
  };
}

export function isJsonRpcRequestObject(body: unknown): body is McpRequestMessage {
  return body !== null && typeof body === 'object' && !Array.isArray(body);
}

export function hasModernProtocolClaim(message: unknown): boolean {
  if (!isJsonRpcRequestObject(message)) {
    return false;
  }
  const meta = message.params?.['_meta'];
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) {
    return false;
  }
  const protocolVersion = (meta as Record<string, unknown>)['io.modelcontextprotocol/protocolVersion'];
  return typeof protocolVersion === 'string' && protocolVersion.length > 0;
}

export function decodeMcpHeaderValue(rawValue: string): string | null {
  if (rawValue.length > MAX_MCP_HEADER_VALUE_BYTES) {
    return null;
  }

  if (rawValue.startsWith('=?base64?') && rawValue.endsWith('?=')) {
    const encoded = rawValue.match(MCP_NAME_BASE64_SENTINEL);
    if (!encoded) {
      return null;
    }

    try {
      const payload = encoded[1];
      if (!payload || !/^[A-Za-z0-9+/]*={0,2}$/.test(payload) || payload.length % 4 !== 0) {
        return null;
      }
      const decoded = Buffer.from(payload, 'base64').toString('utf8');
      if (decoded.length > MAX_MCP_HEADER_VALUE_BYTES) {
        return null;
      }
      return decoded;
    } catch {
      return null;
    }
  }

  return rawValue;
}

function readRequestMeta(message: McpRequestMessage): Record<string, unknown> | null {
  const meta = message.params?.['_meta'];
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) {
    return null;
  }
  return meta as Record<string, unknown>;
}

function requiresMcpName(method: string | undefined): boolean {
  return method === 'tools/call' || method === 'resources/read' || method === 'prompts/get';
}

function getMcpNameBodyValue(message: McpRequestMessage): string | undefined {
  const params = message.params;
  if (!params) {
    return undefined;
  }
  switch (message.method) {
    case 'tools/call':
    case 'prompts/get':
      return typeof params.name === 'string' ? params.name : undefined;
    case 'resources/read':
      return typeof params.uri === 'string' ? params.uri : undefined;
    default:
      return undefined;
  }
}

function validateModernMeta(
  message: McpRequestMessage,
): { protocolVersion: string } | ModernValidationFailure {
  const meta = readRequestMeta(message);
  if (!meta) {
    return invalidParams(message.id, 'missing _meta');
  }

  const protocolVersion = meta['io.modelcontextprotocol/protocolVersion'];
  if (typeof protocolVersion !== 'string' || protocolVersion.length === 0) {
    return invalidParams(message.id, 'missing io.modelcontextprotocol/protocolVersion in _meta');
  }

  if (!Object.prototype.hasOwnProperty.call(meta, 'io.modelcontextprotocol/clientCapabilities')) {
    return invalidParams(message.id, 'missing io.modelcontextprotocol/clientCapabilities in _meta');
  }

  const clientCapabilities = meta['io.modelcontextprotocol/clientCapabilities'];
  if (
    clientCapabilities === null ||
    typeof clientCapabilities !== 'object' ||
    Array.isArray(clientCapabilities)
  ) {
    return invalidParams(message.id, 'io.modelcontextprotocol/clientCapabilities must be an object');
  }

  return { protocolVersion };
}

function validateModernHeaders(
  req: Request,
  message: McpRequestMessage,
  protocolVersion: string,
): ModernValidationFailure | null {
  const headerProtocolVersion = req.get('mcp-protocol-version');
  if (!headerProtocolVersion) {
    return headerMismatch(message.id, 'missing MCP-Protocol-Version header');
  }
  if (headerProtocolVersion !== protocolVersion) {
    return headerMismatch(
      message.id,
      'MCP-Protocol-Version header does not match _meta protocolVersion',
    );
  }

  const headerMethod = req.get('mcp-method');
  if (!headerMethod) {
    return headerMismatch(message.id, 'missing Mcp-Method header');
  }
  if (typeof message.method !== 'string' || headerMethod !== message.method) {
    return headerMismatch(message.id, 'Mcp-Method header does not match request method');
  }

  if (!requiresMcpName(message.method)) {
    return null;
  }

  const headerName = req.get('mcp-name');
  if (!headerName) {
    return headerMismatch(message.id, 'missing Mcp-Name header');
  }

  const decodedHeaderName = decodeMcpHeaderValue(headerName);
  if (decodedHeaderName === null) {
    return headerMismatch(message.id, 'invalid Mcp-Name header encoding');
  }

  const bodyName = getMcpNameBodyValue(message);
  if (bodyName === undefined) {
    return headerMismatch(message.id, 'missing body name/uri for Mcp-Name validation');
  }
  if (decodedHeaderName !== bodyName) {
    return headerMismatch(message.id, 'Mcp-Name header does not match body value');
  }

  return null;
}

export function validateModernRequest(
  req: Request,
  message: McpRequestMessage,
  supportedVersions: readonly string[],
): ModernValidationFailure | null {
  const metaResult = validateModernMeta(message);
  if ('response' in metaResult) {
    return metaResult;
  }

  const headerFailure = validateModernHeaders(req, message, metaResult.protocolVersion);
  if (headerFailure) {
    return headerFailure;
  }

  if (!supportedVersions.includes(metaResult.protocolVersion)) {
    return unsupportedVersion(message.id, supportedVersions);
  }

  return null;
}

export function mapModernJsonRpcErrorHttpStatus(code: number): number {
  switch (code) {
    case -32022:
    case -32020:
    case -32021:
    case -32602:
      return 400;
    case -32601:
      return 404;
    case -32603:
      return 500;
    default:
      return 500;
  }
}
