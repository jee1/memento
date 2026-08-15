#!/usr/bin/env node
/**
 * Memento MCP Server 메인 진입점
 */

import {
closeDatabase,
createMementoCore,
createToolContext,
executeTool,
getExposedTools,
mementoConfig,
validateConfig,
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
} from '@modelcontextprotocol/sdk/types.js';
import Database from 'better-sqlite3';
import type { Server as HttpServer } from 'node:http';
import packageJson from '../../package.json' with { type: 'json' };
import { mcpLogger } from './mcp-logger.js';
import { deleteServerInfo, resolveServerInfoConfigDir } from './server-info.js';
import { ServerState } from './server-state.js';
import { releaseLock } from './utils/instance-lock.js';
import { assertToolAuditCoverage, recordToolAudit } from './audit-tool-dispatch.js';

// 전역 상태 및 인스턴스
let server: Server;
let db: Database.Database | null = null;
let serverServices: ServerServices | null = null;
let mgmtHttpServer: HttpServer | null = null;

const serverState = ServerState.getInstance();
serverState.setMcpServerInitialized(false);

/** MCP 초기화 완료를 기다리기 위한 Promise */
let resolveInit: () => void;
let rejectInit: (err: Error) => void;

const initPromise = new Promise<void>((resolve, reject) => {
  resolveInit = resolve;
  rejectInit = reject;
});

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

// process.stderr.write 가드 (Issue #179 방어)
// Node 20+에서 stderr.write(undefined/null) 호출 시 발생하는 ERR_INVALID_ARG_TYPE 방지
const originalStderrWrite = process.stderr.write.bind(process.stderr);
const guardedStderrWrite = ((chunk: unknown, encoding?: BufferEncoding | ((err?: Error | null) => void), cb?: (err?: Error | null) => void) => {
  if (chunk === undefined || chunk === null) {
    return true;
  }
  if (typeof encoding === 'function') {
    return originalStderrWrite(chunk as string | Uint8Array, encoding);
  }
  return originalStderrWrite(chunk as string | Uint8Array, encoding, cb);
}) as typeof process.stderr.write;
process.stderr.write = guardedStderrWrite;

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
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: getExposedTools(),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    await initPromise;
    if (!db || !serverServices) throw new Error('Server not initialized');

    return await concurrencyLimiter.acquire().then(async () => {
      try {
        const context = createToolContext(db!, serverServices!);
        const auditContext = { transport: 'mcp_stdio' as const };
        assertToolAuditCoverage(db!, request.params.name, request.params.arguments, auditContext);
        try {
          const result = await executeTool(request.params.name, request.params.arguments, context);
          recordToolAudit(db!, request.params.name, request.params.arguments, auditContext, 'success');
          return result;
        } catch (error) {
          recordToolAudit(db!, request.params.name, request.params.arguments, auditContext, 'failure');
          throw error;
        }
      } finally {
        concurrencyLimiter.release();
      }
    });
  });

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: [] }));
  server.setRequestHandler(ReadResourceRequestSchema, async () => { throw new Error('Not implemented'); });
  server.setRequestHandler(ListPromptsRequestSchema, async () => ({ prompts: [] }));
  server.setRequestHandler(GetPromptRequestSchema, async () => { throw new Error('Not implemented'); });
  // Note: SetLevelRequestSchema is automatically handled by the SDK when logging capability is declared.
}

/**
 * 서버 시작
 */
export async function startServer() {
  try {
    const transport = new StdioServerTransport();
    server = new Server(
      { name: 'memento-mcp-server', version: packageJson.version },
      { 
        capabilities: { tools: {}, resources: {}, prompts: {}, logging: {} },
        instructions: MEMENTO_SERVER_INSTRUCTIONS
      }
    );

    registerHandlers();
    await server.connect(transport);
    
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
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    process.stderr.write(`\n[ERROR] MCP Server Start Failed: ${err.message}\n`);
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
      if (serverServices.runtimeDiagnosticsLogger) {
        await serverServices.runtimeDiagnosticsLogger.writeEvent({
          type: 'server_cleanup_start',
          timestamp: new Date().toISOString(),
          transport: 'stdio'
        });
      }
      
      if (serverServices.runtimeDiagnosticsSamplerCleanup) {
        await serverServices.runtimeDiagnosticsSamplerCleanup();
      }
      
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

  if (serverServices?.runtimeDiagnosticsLogger) {
    try {
      await serverServices.runtimeDiagnosticsLogger.writeEvent({
        type: 'server_cleanup_finish',
        timestamp: new Date().toISOString(),
        transport: 'stdio'
      });
    } catch { /* ignore */ }
  }
}

/** 테스트 전용 의존성 주입 도구 */
export const __test = {
  setTestDependencies: (deps: { 
    database: Database.Database | null, 
    serverServices: ServerServices | null 
  }) => {
    db = deps.database;
    serverServices = deps.serverServices;
  }
};

// Global error handlers
process.on('uncaughtException', (error: Error) => {
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
  srv.start().catch((error: unknown) => {
    const err = error instanceof Error ? error : new Error(String(error));
    process.stderr.write(`\n[FATAL ERROR] Unhandled start failure: ${err.message}\n`);
    process.exit(1);
  });
}
