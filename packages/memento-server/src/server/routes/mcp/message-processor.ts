import type Database from 'better-sqlite3';
import type { ServerServices } from '../../bootstrap.js';
import {
  getExposedTools,
  logger,
  findMemoryResourceRowById,
  listRecentMemoryResourceIds,
  MemoryNeighborService,
  getVectorSearchEngine,
  callerMemoryScope,
  type CallerMemoryScope
} from '@memento/core';
import {
  dispatchTool,
  mapToolDispatchError,
  type ToolAuditContext,
} from '../../audit-tool-dispatch.js';
import { MEMENTO_SERVER_INSTRUCTIONS } from '../../mcp-instructions.js';
import {
  isModernMcpServiceEnabled,
  mementoConfig,
} from '@memento/core';
import {
  LATEST_PROTOCOL_VERSION,
  SUPPORTED_PROTOCOL_VERSIONS,
} from '@modelcontextprotocol/sdk/types.js';
import packageJson from '../../../../package.json' with { type: 'json' };
import { MODERN_PROTOCOL_VERSION } from './modern-request-validation.js';
import { createJsonRpcError } from './json-rpc.js';
import type { JsonRpcResponse, McpRequestMessage } from './types.js';

/** initialize 와 server/discover 가 같은 것을 광고해야 한다. 이 파일이 실제로 처리하는 것만 넣는다 (#840). */
const MCP_CAPABILITIES = {
  tools: {},
  resources: {},
  prompts: {}
};

export function getDiscoverSupportedVersions(): string[] {
  if (isModernMcpServiceEnabled(mementoConfig.mcpEra)) {
    return [MODERN_PROTOCOL_VERSION, ...SUPPORTED_PROTOCOL_VERSIONS];
  }
  return [...SUPPORTED_PROTOCOL_VERSIONS];
}

type MemoryResourceData = {
  id: string;
  type: string;
  content: string;
  importance: number;
  privacy_scope: string;
  tags: unknown[];
  source: string | null;
  created_at: string;
  last_accessed: string | null;
  pinned: boolean;
  neighbors?: unknown[];
  neighbors_count?: number;
  neighbors_query_time?: number;
};

export async function processMcpMessage(
  message: McpRequestMessage,
  db: Database.Database | null,
  serverServices: ServerServices | null,
  auditContext: ToolAuditContext = { transport: 'mcp_http' },
  options: { modernEra?: boolean } = {},
): Promise<JsonRpcResponse> {
  if (options.modernEra && message.method === 'initialize') {
    return createJsonRpcError(message.id, -32601, 'Method not found');
  }

  if (message.method === 'initialize') {
    // 클라이언트가 요청한 버전을 지원하면 그대로 돌려준다. 예전에는 무엇을 받든
    // '2024-11-05' 를 돌려줘서, 최신 버전을 요청한 클라이언트를 조용히 끌어내렸다.
    const requestedVersion = message.params?.['protocolVersion'];
    const protocolVersion =
      typeof requestedVersion === 'string' &&
      (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(requestedVersion)
        ? requestedVersion
        : LATEST_PROTOCOL_VERSION;
    logger.info('MCP initialize request processing', { protocolVersion });
    return {
      jsonrpc: '2.0',
      id: message.id,
      result: {
        protocolVersion,
        // 이 파일이 실제로 처리하는 것만 광고한다. logging 은 HTTP 에 핸들러가
        // 없으므로 넣지 않는다 (stdio 에만 있다).
        capabilities: MCP_CAPABILITIES,
        instructions: MEMENTO_SERVER_INSTRUCTIONS,
        serverInfo: {
          name: 'memento-mcp-server',
          version: packageJson.version
        }
      }
    };
  }

  if (message.method === 'server/discover') {
    // 2026-07-28 이 MUST 로 요구하는 메서드. modern 클라이언트가 핸드셰이크 없이
    // 지원 버전을 확인하고, 없으면 legacy initialize 로 폴백할 수 있게 한다.
    //
    // modern 경로가 활성일 때만 2026-07-28 을 광고한다 (#840 Phase 1b).
    logger.info('MCP server/discover request processing');
    return {
      jsonrpc: '2.0',
      id: message.id,
      result: {
        supportedVersions: getDiscoverSupportedVersions(),
        capabilities: MCP_CAPABILITIES,
        instructions: MEMENTO_SERVER_INSTRUCTIONS,
        _meta: {
          'io.modelcontextprotocol/serverInfo': {
            name: 'memento-mcp-server',
            version: packageJson.version
          }
        }
      }
    };
  }

  if (message.method === 'notifications/initialized') {
    logger.info('MCP initialized notification received');
    return {
      jsonrpc: '2.0',
      id: message.id,
      result: {}
    };
  }

  if (message.method === 'tools/list') {
    return handleToolsList(message);
  }

  if (message.method === 'tools/call') {
    return handleToolsCall(message, db, serverServices, auditContext);
  }

  if (message.method === 'prompts/list') {
    logger.info('MCP prompts/list request processing');
    return {
      jsonrpc: '2.0',
      id: message.id,
      result: { prompts: [memoryInjectionPromptDefinition()] }
    };
  }

  if (message.method === 'prompts/get') {
    return handlePromptsGet(message, db, serverServices, auditContext);
  }

  if (message.method === 'prompts/call') {
    if (message.params?.name !== 'memory_injection') {
      return createJsonRpcError(message.id, -32601, 'Prompt not found');
    }
    return handleToolsCall(message, db, serverServices, auditContext);
  }

  if (message.method === 'resources/list') {
    return handleResourcesList(message, db, callerMemoryScope(auditContext));
  }

  if (message.method === 'resources/read') {
    return handleResourcesRead(message, db, serverServices, callerMemoryScope(auditContext));
  }

  return createJsonRpcError(message.id, -32601, 'Method not found');
}

function memoryInjectionPromptDefinition(): {
  name: string;
  description: string;
  arguments: Array<{ name: string; description: string; required: boolean }>;
} {
  return {
    name: 'memory_injection',
    description: '관련 기억을 요약하여 프롬프트에 주입',
    arguments: [
      {
        name: 'query',
        description: '검색할 쿼리',
        required: true
      },
      {
        name: 'token_budget',
        description: '토큰 예산 (기본값: 1000)',
        required: false
      },
      {
        name: 'max_memories',
        description: '최대 기억 개수 (기본값: 5)',
        required: false
      }
    ]
  };
}

/** memory_injection 도구를 실행해 GetPromptResult 꼴로 감싼다 (#1849). owner 범위는 tools/call 과 같은 dispatch 가 건다. */
async function handlePromptsGet(
  message: McpRequestMessage,
  db: Database.Database | null,
  serverServices: ServerServices | null,
  auditContext: ToolAuditContext,
): Promise<JsonRpcResponse> {
  if (message.params?.['name'] !== 'memory_injection') {
    return createJsonRpcError(message.id, -32602, 'Prompt not found');
  }
  // 프롬프트 인자는 사양상 문자열이라 도구의 숫자 인자로 바꾼다. 선언한 인자만 넘긴다.
  const given = (message.params['arguments'] ?? {}) as Record<string, unknown>;
  // 빈 값은 생략한 것으로 본다. Number('') 는 0 이라 결과가 비어 버린다.
  const toNumber = (value: unknown) => (String(value ?? '').trim() === '' ? undefined : Number(value));
  const response = await handleToolsCall(
    {
      ...message,
      params: {
        name: 'memory_injection',
        arguments: {
          query: given['query'],
          token_budget: toNumber(given['token_budget']),
          max_memories: toNumber(given['max_memories']),
        },
      },
    },
    db,
    serverServices,
    auditContext,
  );
  if (response.error) return response;

  const toolResult = response.result as { content: Array<{ text: string }> };
  const { message: text } = JSON.parse(toolResult.content[0]!.text) as { message: string };
  return {
    jsonrpc: '2.0',
    id: message.id,
    result: {
      description: memoryInjectionPromptDefinition().description,
      messages: [{ role: 'user', content: { type: 'text', text } }],
    },
  };
}

function handleToolsList(message: McpRequestMessage): JsonRpcResponse {
  logger.info('MCP tools/list request processing');
  try {
    return {
      jsonrpc: '2.0',
      id: message.id,
      result: { tools: getExposedTools() }
    };
  } catch (toolsError) {
    logger.error('tools/list processing error', {
      error: toolsError instanceof Error ? toolsError.message : String(toolsError)
    });
    return createJsonRpcError(
      message.id,
      -32603,
      'Internal error',
      toolsError instanceof Error ? toolsError.message : String(toolsError)
    );
  }
}

async function handleToolsCall(
  message: McpRequestMessage,
  db: Database.Database | null,
  serverServices: ServerServices | null,
  auditContext: ToolAuditContext,
): Promise<JsonRpcResponse> {
  const { name, arguments: args } = message.params ?? {};
  if (typeof name !== 'string') {
    return createJsonRpcError(message.id, -32602, 'Invalid params', 'Tool name is required');
  }

  if (!db || !serverServices) {
    return createJsonRpcError(message.id, -32603, 'Internal error', '서비스가 초기화되지 않았습니다');
  }

  try {
    const toolResult = await dispatchTool(name, args, db, serverServices, auditContext);
    return {
      jsonrpc: '2.0',
      id: message.id,
      // stdio MCP 경로(index.ts CallTool)와 동일: executeTool ToolResult를 그대로 반환
      result: toolResult
    };
  } catch (error) {
    const mapped = mapToolDispatchError(error);
    if (mapped.code === -32602) {
      logger.warn('MCP tools/call rejected invalid params', { tool: name, error: mapped.data });
    } else {
      logger.warn('MCP tools/call failed', { tool: name, code: mapped.code, error: mapped.data });
    }
    return createJsonRpcError(message.id, mapped.code, mapped.protocolMessage, mapped.data);
  }
}

async function handleResourcesList(
  message: McpRequestMessage,
  db: Database.Database | null,
  scope: CallerMemoryScope
): Promise<JsonRpcResponse> {
  logger.info('MCP resources/list request processing');
  if (!db) {
    return createJsonRpcError(message.id, -32603, 'Internal error', 'Database not initialized');
  }

  try {
    const memories = listRecentMemoryResourceIds(db, scope);

    return {
      jsonrpc: '2.0',
      id: message.id,
      result: {
        resources: memories.map((memory) => ({
          uri: `memory://${memory.id}`,
          name: `Memory ${memory.id}`,
          description: `Memory item with ID: ${memory.id}`,
          mimeType: 'application/json'
        }))
      }
    };
  } catch (error) {
    logger.error('resources/list processing error', {
      error: error instanceof Error ? error.message : String(error)
    });
    return createJsonRpcError(
      message.id,
      -32603,
      'Internal error',
      error instanceof Error ? error.message : 'Unknown error'
    );
  }
}

async function handleResourcesRead(
  message: McpRequestMessage,
  db: Database.Database | null,
  serverServices: ServerServices | null,
  scope: CallerMemoryScope
): Promise<JsonRpcResponse> {
  logger.info('MCP resources/read request processing', { uri: message.params?.uri });
  const { uri } = message.params ?? {};
  if (typeof uri !== 'string' || uri.length === 0) {
    return createJsonRpcError(message.id, -32602, 'Invalid params', 'URI parameter is required');
  }
  if (!db) {
    return createJsonRpcError(message.id, -32603, 'Internal error', 'Database not initialized');
  }

  try {
    const memoryData = await readMemoryResource(message.id, uri, db, serverServices, scope);
    if ('error' in memoryData) {
      return memoryData;
    }
    return {
      jsonrpc: '2.0',
      id: message.id,
      result: {
        contents: [
          {
            uri,
            mimeType: 'application/json',
            text: JSON.stringify(memoryData, null, 2)
          }
        ]
      }
    };
  } catch (error) {
    logger.error('resources/read processing error', {
      error: error instanceof Error ? error.message : String(error)
    });
    return createJsonRpcError(
      message.id,
      -32603,
      'Internal error',
      error instanceof Error ? error.message : 'Unknown error'
    );
  }
}

async function readMemoryResource(
  requestId: unknown,
  uri: string,
  db: Database.Database,
  serverServices: ServerServices | null,
  scope: CallerMemoryScope
): Promise<MemoryResourceData | JsonRpcResponse> {
  const uriMatch = uri.match(/^memory:\/\/([^?]+)(\?.*)?$/);
  if (!uriMatch) {
    return createJsonRpcError(requestId, -32602, 'Invalid params', `Invalid resource URI: ${uri}`);
  }

  const memoryId = uriMatch[1];
  if (!memoryId) {
    return createJsonRpcError(requestId, -32602, 'Invalid params', `Invalid memory ID in URI: ${uri}`);
  }

  const query = new URLSearchParams(uriMatch[2]?.slice(1));
  const history = query.getAll('include_superseded');
  if (history.length > 1 || (history.length === 1 && history[0] !== 'true' && history[0] !== 'false')) {
    return createJsonRpcError(requestId, -32602, 'Invalid params', 'include_superseded must be true or false');
  }
  const memory = findMemoryResourceRowById(db, memoryId, scope, history[0] === 'true');
  if (!memory) {
    return createJsonRpcError(requestId, -32602, 'Invalid params', `Memory not found: ${memoryId}`);
  }

  const memoryData: MemoryResourceData = {
    id: memory.id,
    type: memory.type,
    content: memory.content,
    importance: memory.importance,
    privacy_scope: memory.privacy_scope,
    tags: memory.tags ? JSON.parse(memory.tags) : [],
    source: memory.source,
    created_at: memory.created_at,
    last_accessed: memory.last_accessed,
    pinned: memory.pinned === 1
  };

  if (query.get('include_neighbors') === 'true') {
    await attachMemoryNeighbors(memoryData, memoryId, db, serverServices, scope);
  }
  return memoryData;
}

async function attachMemoryNeighbors(
  memoryData: MemoryResourceData,
  memoryId: string,
  db: Database.Database,
  serverServices: ServerServices | null,
  scope: CallerMemoryScope
): Promise<void> {
  try {
    if (!serverServices) {
      logger.warn('Server services not available for neighbor search');
      memoryData.neighbors = [];
      memoryData.neighbors_count = 0;
      return;
    }
    const vectorSearchEngine = getVectorSearchEngine();
    const neighborService = new MemoryNeighborService(
      vectorSearchEngine,
      serverServices.embeddingService,
      db
    );
    const neighborsResult = await neighborService.getNeighbors(memoryId, {
      limit: 5,
      similarity_threshold: 0.8,
      scope
    });
    memoryData.neighbors = neighborsResult.neighbors;
    memoryData.neighbors_count = neighborsResult.total_count;
    memoryData.neighbors_query_time = neighborsResult.query_time;
  } catch (error) {
    logger.warn('Neighbor search failed', {
      error: error instanceof Error ? error.message : String(error)
    });
    memoryData.neighbors = [];
    memoryData.neighbors_count = 0;
  }
}
