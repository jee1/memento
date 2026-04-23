#!/usr/bin/env node
/**
 * Memento MCP Server 메인 진입점
 */

import {
DatabaseUtils,
ErrorCategory,
ErrorSeverity,
MemoryNeighborService,
closeDatabase,
createMementoCore,
createToolContext,
executeTool,
getBatchScheduler,
getToolRegistry,
getVectorSearchEngine,
mementoConfig,
validateConfig,
withErrorHandling,
type ServerServices
} from '@memento/core';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
CallToolRequestSchema,
GetPromptRequestSchema,
ListPromptsRequestSchema,
ListResourcesRequestSchema,
ListToolsRequestSchema,
ReadResourceRequestSchema,
SetLevelRequestSchema
} from '@modelcontextprotocol/sdk/types.js';
import Database from 'better-sqlite3';
import express from 'express';
import { createServer as createHttpServer } from 'http';
import type { AddressInfo } from 'net';
import packageJson from '../../package.json' with { type: 'json' };
import { mcpLogger } from './mcp-logger.js';
import { deleteServerInfo, resolveServerInfoConfigDir, writeServerInfo } from './server-info.js';
import { ServerState } from './server-state.js';
import { releaseLock } from './utils/instance-lock.js';

// 전역 상태 및 인스턴스
let server: Server;
let db: Database.Database | null = null;
let serverServices: ServerServices | null = null;
let mgmtHttpServer: ReturnType<typeof createHttpServer> | null = null;

const serverState = ServerState.getInstance();
serverState.setMcpServerInitialized(false);

/** MCP 초기화 완료를 기다리기 위한 Promise */
let initPromise: Promise<void>;
let resolveInit: () => void;
let rejectInit: (err: Error) => void;

// Semaphore for concurrency
export class Semaphore {
  private permits: number;
  private waiting: Array<() => void> = [];
  constructor(permits: number) { this.permits = permits; }
  async acquire(): Promise<void> {
    if (this.permits > 0) { this.permits--; return; }
    return new Promise(resolve => { this.waiting.push(resolve); });
  }
  release(): void {
    this.permits++;
    if (this.waiting.length > 0) {
      const resolve = this.waiting.shift()!;
      this.permits--;
      resolve();
    }
  }
}
const concurrencyLimiter = new Semaphore(20);

// 서버 지침
const MEMENTO_SERVER_INSTRUCTIONS = `Memento MCP provides persistent memory for AI agents (recall, remember, feedback, memory_injection, search_local, anchors, extract_triples).`;

/**
 * 무거운 초기화(DB·서비스)를 백그라운드에서 수행
 */
async function runHeavyInit() {
  try {
    mcpLogger.logServer('info', `Memento MCP Server v${packageJson.version} 초기화 중...`);
    validateConfig();
    const core = await createMementoCore({ dbPath: process.env.DB_PATH ?? mementoConfig.dbPath });
    db = core.db;
    serverServices = core.services;
    resolveInit();
    mcpLogger.logServer('info', '서버 초기화 완료 및 서비스 시작');
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    try { if (db) { closeDatabase(db); db = null; } } catch { /* ignore */ }
    rejectInit(err);
  }
}

/**
 * MCP 요청 핸들러 등록
 */
function registerHandlers() {
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const tools = getToolRegistry().getAll();
    return { tools: tools.map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) };
  });
    
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    await initPromise;
    if (!db) throw new Error('Database not initialized');
    const memories = DatabaseUtils.all(db, 'SELECT id FROM memory_item ORDER BY created_at DESC LIMIT 1000') as Array<{ id: string }>;
    return { resources: memories.map((m) => ({ uri: `memory://${m.id}`, name: `Memory ${m.id}`, mimeType: 'application/json' })) };
  });

  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: [{ name: 'memory_injection', description: '관련 기억을 요약하여 프롬프트에 주입' }]
  }));

  server.setRequestHandler(GetPromptRequestSchema, async (req) => {
    if (req.params.name === 'memory_injection') return { description: '관련 기억을 요약하여 프롬프트에 주입' };
    throw new Error(`Prompt not found: ${req.params.name}`);
  });
    
  server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
    await initPromise;
    const match = req.params.uri.match(/^memory:\/\/([^?]+)(\?.*)?$/);
    if (!match || !match[1]) throw new Error(`Invalid URI: ${req.params.uri}`);
    if (!db) throw new Error('Database not initialized');
    const memory = DatabaseUtils.get(db, 'SELECT * FROM memory_item WHERE id = ?', [match[1]]) as any;
    if (!memory) throw new Error(`Memory not found: ${match[1]}`);
    return { contents: [{ uri: req.params.uri, mimeType: 'application/json', text: JSON.stringify(memory) }] };
  });
    
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    await initPromise;
    const { name, arguments: args } = req.params;
    await concurrencyLimiter.acquire();
    try {
      return await withErrorHandling(
        async () => {
          if (!serverServices || !db) throw new Error('Not initialized');
          const result = await executeTool(name, args, createToolContext(db, serverServices));
          return { content: [{ type: 'text', text: JSON.stringify(result) }] };
        },
        { operation: 'tool_execution', toolName: name },
        { 
          errorLoggingService: serverServices!.errorLoggingService, 
          severity: ErrorSeverity.HIGH, 
          category: ErrorCategory.TOOL_EXECUTION, 
          transformError: (e) => new Error(`Tool execution failed: ${e.message}`) 
        }
      );
    } finally { concurrencyLimiter.release(); }
  });
    
  server.setRequestHandler(SetLevelRequestSchema, async (req) => {
    process.env.LOG_LEVEL = req.params.level;
    return {};
  });
}

/**
 * 관리용 HTTP 서버 기동 (API 호출용)
 */
async function startMgmtHttpServer(): Promise<void> {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.get('/health', (_req, res) => res.json({ status: 'healthy' }));
  app.post('/tools/:name', async (req, res) => {
    if (!db || !serverServices) return res.status(503).json({ error: 'Initializing' });
    try {
      const result = await executeTool(req.params.name, req.body, createToolContext(db, serverServices));
      res.json({ result });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });
  mgmtHttpServer = createHttpServer(app);
  await new Promise<void>((resolve) => {
    mgmtHttpServer!.listen(0, '127.0.0.1', async () => {
      const addr = mgmtHttpServer!.address() as AddressInfo;
      await writeServerInfo(resolveServerInfoConfigDir(), addr.port);
      mcpLogger.logServer('info', `Management HTTP server started on port ${addr.port}`);
      resolve();
    });
  });
}

/**
 * 서버 시작 및 시그널 처리
 */
export async function startServer() {
  try {
    initPromise = new Promise<void>((res, rej) => { resolveInit = res; rejectInit = rej; });
    server = new Server(
      { name: mementoConfig.serverName, version: mementoConfig.serverVersion }, 
      { capabilities: { tools: {}, resources: {}, prompts: {}, logging: {} }, instructions: MEMENTO_SERVER_INSTRUCTIONS }
    );
    mcpLogger.setServer(server);
    registerHandlers();
    
    await server.connect(new StdioServerTransport());
    await startMgmtHttpServer();
    
    serverState.setMcpTransportConnected(true);
    serverState.setMcpServerInitialized(true);
    
    void runHeavyInit();
    
    return new Promise<void>((resolve) => {
      const handleShutdown = async (signal: string) => {
        mcpLogger.logServer('info', `Server received ${signal}, cleaning up...`);
        await cleanup();
        resolve();
        process.exit(0);
      };
      process.on('SIGINT', () => handleShutdown('SIGINT'));
      process.on('SIGTERM', () => handleShutdown('SIGTERM'));
    });
  } catch (error: any) {
    process.stderr.write(`\n[ERROR] MCP Server Start Failed: ${error.message}\n`);
    process.exit(1);
  }
}

/**
 * 리소스 정리
 */
export async function cleanup() {
  if (mgmtHttpServer) {
    await deleteServerInfo(resolveServerInfoConfigDir());
    await new Promise(r => mgmtHttpServer!.close(r));
    mgmtHttpServer = null;
  }
  if (serverServices) {
    try {
      await serverServices.walCheckpointScheduler.stop();
      serverServices.databaseLockMonitor.stop();
      if (serverServices.writeCoalescingManager) {
        await serverServices.writeCoalescingManager.flush();
        await serverServices.writeCoalescingManager.destroy();
      }
    } catch { /* ignore */ }
  }
  if (db) {
    closeDatabase(db);
    db = null;
  }
  releaseLock();
}

// Global error handlers
process.on('uncaughtException', (error: any) => {
  process.stderr.write(`\n[FATAL ERROR] Uncaught Exception: ${error.message}\n`);
  cleanup().then(() => process.exit(1));
});

// Entry point
import { basename } from 'path';
import { fileURLToPath } from 'url';
import { createServerFactory } from './server-factory.js';

const currentFile = fileURLToPath(import.meta.url);
const currentFileName = basename(currentFile);
const scriptPath = process.argv[1] || '';
const isMainModule = currentFileName === 'index.js' || (scriptPath && (scriptPath.endsWith('index.js') || scriptPath.endsWith('index.ts')));

if (isMainModule) {
  const factory = createServerFactory();
  const srv = factory.createServerFromEnv();
  srv.start().catch((error: any) => {
    process.stderr.write(`\n[FATAL ERROR] Unhandled start failure: ${error.message}\n`);
    process.exit(1);
  });
}
