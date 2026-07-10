import type Database from 'better-sqlite3';
import type { ServerServices } from '../../bootstrap.js';
import {
  getToolRegistry,
  executeTool,
  createToolContext,
  logger,
  DatabaseUtils,
  MemoryNeighborService,
  getVectorSearchEngine
} from '@memento/core';
import { mapToolExecutionErrorToJsonRpc } from '../../utils/mcp-tool-call-error.js';
import { createJsonRpcError } from './json-rpc.js';
import type { JsonRpcResponse, McpRequestMessage } from './types.js';

type MemoryResourceListRow = {
  id: string;
};

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

type MemoryResourceRow = {
  id: string;
  type: string;
  content: string;
  importance: number;
  privacy_scope: string;
  tags: string | null;
  source: string | null;
  created_at: string;
  last_accessed: string | null;
  pinned: number | boolean;
};

export async function processMcpMessage(
  message: McpRequestMessage,
  db: Database.Database | null,
  serverServices: ServerServices | null
): Promise<JsonRpcResponse> {
  if (message.method === 'initialize') {
    logger.info('MCP initialize request processing');
    return {
      jsonrpc: '2.0',
      id: message.id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: {
          tools: {}
        },
        serverInfo: {
          name: 'memento-memory',
          version: '0.1.0'
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
    return handleToolsCall(message, db, serverServices);
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
    const { name } = message.params ?? {};
    if (name === 'memory_injection') {
      return {
        jsonrpc: '2.0',
        id: message.id,
        result: {
          description: '관련 기억을 요약하여 프롬프트에 주입',
          arguments: memoryInjectionPromptDefinition().arguments
        }
      };
    }
    return createJsonRpcError(message.id, -32601, 'Prompt not found');
  }

  if (message.method === 'prompts/call') {
    return handlePromptsCall(message, db, serverServices);
  }

  if (message.method === 'resources/list') {
    return handleResourcesList(message, db);
  }

  if (message.method === 'resources/read') {
    return handleResourcesRead(message, db, serverServices);
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

function createServerToolContext(
  db: Database.Database | null,
  serverServices: ServerServices | null
): ReturnType<typeof createToolContext> | null {
  if (!serverServices) {
    return null;
  }
  return createToolContext({ db: db!, services: serverServices });
}

function handleToolsList(message: McpRequestMessage): JsonRpcResponse {
  logger.info('MCP tools/list request processing');
  try {
    const toolRegistry = getToolRegistry();
    return {
      jsonrpc: '2.0',
      id: message.id,
      result: { tools: toolRegistry.getAll() }
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
  serverServices: ServerServices | null
): Promise<JsonRpcResponse> {
  const { name, arguments: args } = message.params ?? {};
  if (typeof name !== 'string') {
    return createJsonRpcError(message.id, -32602, 'Invalid params', 'Tool name is required');
  }

  const toolContext = createServerToolContext(db, serverServices);
  if (!toolContext) {
    return createJsonRpcError(message.id, -32603, 'Internal error', '서비스가 초기화되지 않았습니다');
  }

  try {
    const toolResult = await executeTool(name, args, toolContext);
    return {
      jsonrpc: '2.0',
      id: message.id,
      // stdio MCP 경로(index.ts CallTool)와 동일: executeTool ToolResult를 그대로 반환
      result: toolResult
    };
  } catch (error) {
    const mapped = mapToolExecutionErrorToJsonRpc(error);
    if (mapped) {
      logger.warn('MCP tools/call rejected invalid params', { tool: name, error: mapped.data });
      return createJsonRpcError(message.id, mapped.code, mapped.message, mapped.data);
    }
    throw error;
  }
}

async function handlePromptsCall(
  message: McpRequestMessage,
  db: Database.Database | null,
  serverServices: ServerServices | null
): Promise<JsonRpcResponse> {
  const { name, arguments: args } = message.params ?? {};
  if (name !== 'memory_injection') {
    return createJsonRpcError(message.id, -32601, 'Prompt not found');
  }

  try {
    const toolContext = createServerToolContext(db, serverServices);
    if (!toolContext) {
      return createJsonRpcError(message.id, -32603, 'Internal error', '서비스가 초기화되지 않았습니다');
    }
    const promptResult = await executeTool('memory_injection', args, toolContext);
    return {
      jsonrpc: '2.0',
      id: message.id,
      result: promptResult
    };
  } catch (error) {
    return createJsonRpcError(
      message.id,
      -32603,
      'Prompt execution failed',
      error instanceof Error ? error.message : 'Unknown error'
    );
  }
}

async function handleResourcesList(
  message: McpRequestMessage,
  db: Database.Database | null
): Promise<JsonRpcResponse> {
  logger.info('MCP resources/list request processing');
  if (!db) {
    return createJsonRpcError(message.id, -32603, 'Internal error', 'Database not initialized');
  }

  try {
    const memories = await DatabaseUtils.all(
      db,
      'SELECT id FROM memory_item ORDER BY created_at DESC LIMIT 1000'
    ) as MemoryResourceListRow[];

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
  serverServices: ServerServices | null
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
    const memoryData = await readMemoryResource(message.id, uri, db, serverServices);
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
  serverServices: ServerServices | null
): Promise<MemoryResourceData | JsonRpcResponse> {
  const uriMatch = uri.match(/^memory:\/\/([^?]+)(\?.*)?$/);
  if (!uriMatch) {
    return createJsonRpcError(requestId, -32602, 'Invalid params', `Invalid resource URI: ${uri}`);
  }

  const memoryId = uriMatch[1];
  if (!memoryId) {
    return createJsonRpcError(requestId, -32602, 'Invalid params', `Invalid memory ID in URI: ${uri}`);
  }

  const memory = DatabaseUtils.get(
    db,
    'SELECT id, type, content, importance, privacy_scope, tags, source, created_at, last_accessed, pinned FROM memory_item WHERE id = ?',
    [memoryId]
  ) as MemoryResourceRow | undefined;
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

  const queryString = uriMatch[2] || '';
  if (queryString.includes('include_neighbors=true')) {
    await attachMemoryNeighbors(memoryData, memoryId, db, serverServices);
  }
  return memoryData;
}

async function attachMemoryNeighbors(
  memoryData: MemoryResourceData,
  memoryId: string,
  db: Database.Database,
  serverServices: ServerServices | null
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
      similarity_threshold: 0.8
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
