#!/usr/bin/env node
/**
 * Memento MCP Server 메인 진입점
 */

import {
closeDatabase,
createMementoCore,
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
import { deleteServerInfo, isServerAlive, readServerInfo, resolveServerInfoConfigDir } from './server-info.js';
import { ServerState } from './server-state.js';
import { releaseLock, tryAcquireLock } from './utils/instance-lock.js';
import { dispatchTool } from './audit-tool-dispatch.js';
import { closeHttpServer, startServer as startHttpServer } from './http-server.js';

// 전역 상태 및 인스턴스
let server: Server;
let db: Database.Database | null = null;
let serverServices: ServerServices | null = null;
let mgmtHttpServer: HttpServer | null = null;
let mgmtConfigDir: string | null = null;
let heavyInitPromise: Promise<void> | null = null;
let cleanupPromise: Promise<void> | null = null;
let shuttingDown = false;

const serverState = ServerState.getInstance();
serverState.setMcpServerInitialized(false);

/** MCP 초기화 완료를 기다리기 위한 Promise */
let resolveInit: () => void;
let rejectInit: (err: Error) => void;

const initPromise = new Promise<void>((resolve, reject) => {
  resolveInit = resolve;
  rejectInit = reject;
});

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
    await startHttpSidecar();
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    try { if (db) { closeDatabase(db); db = null; } } catch { /* ignore */ }
    rejectInit(err);
  }
}

async function startHttpSidecar(): Promise<void> {
  if (process.env.MEMENTO_HTTP_SIDECAR !== '1' || shuttingDown || !db || !serverServices) return;
  try {
    const configDir = resolveServerInfoConfigDir();
    const existing = await readServerInfo(configDir);
    if (existing && await isServerAlive(existing)) return;
    if (shuttingDown || !tryAcquireLock(process.env.DB_PATH ?? mementoConfig.dbPath).acquired) return;
    mgmtHttpServer = await startHttpServer({ database: db, serverServices });
    mgmtConfigDir = configDir;
  } catch (error) {
    releaseLock();
    // Optional HTTP must never reject the stdio core initialization.
    if ((error as NodeJS.ErrnoException)?.code !== 'EADDRINUSE') {
      mcpLogger.logServer('warn', 'HTTP sidecar 기동 실패; stdio MCP는 계속 실행됩니다');
    }
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

    return dispatchTool(
      request.params.name,
      request.params.arguments,
      db,
      serverServices,
      { transport: 'mcp_stdio' },
    );
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

    let resolveShutdown!: () => void;
    const shutdown = new Promise<void>((resolve) => { resolveShutdown = resolve; });
    const handleShutdown = async (signal: string) => {
      mcpLogger.logServer('info', `Server received ${signal}, cleaning up...`);
      await cleanup();
      resolveShutdown();
      process.exit(0);
    };
    server.onclose = () => { void handleShutdown('stdio close'); };
    // The SDK transport does not forward stdin EOF to Server.onclose.
    process.stdin.once('end', () => { void handleShutdown('stdio close'); });
    process.on('SIGINT', () => { void handleShutdown('SIGINT'); });
    process.on('SIGTERM', () => { void handleShutdown('SIGTERM'); });

    registerHandlers();
    await server.connect(transport);
    if (shuttingDown) return shutdown;
    
    serverState.setMcpTransportConnected(true);
    serverState.setMcpServerInitialized(true);
    
    heavyInitPromise = runHeavyInit();
    
    return shutdown;
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    process.stderr.write(`\n[ERROR] MCP Server Start Failed: ${err.message}\n`);
    process.exit(1);
  }
}

/**
 * 리소스 정리
 */
export function cleanup(): Promise<void> {
  shuttingDown = true;
  cleanupPromise ??= performStdioCleanup();
  return cleanupPromise;
}

async function performStdioCleanup(): Promise<void> {
  // Do not close the shared DB while initialization/listen is still using it.
  await heavyInitPromise;
  if (mgmtHttpServer) {
    const address = mgmtHttpServer.address();
    await closeHttpServer();
    const info = mgmtConfigDir ? await readServerInfo(mgmtConfigDir) : null;
    if (mgmtConfigDir && info?.pid === process.pid && address && typeof address === 'object' && info.port === address.port) {
      await deleteServerInfo(mgmtConfigDir);
    }
    mgmtHttpServer = null;
    mgmtConfigDir = null;
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

      await serverServices.batchScheduler?.stop();
      
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
  runHeavyInit: () => { heavyInitPromise = runHeavyInit(); return heavyInitPromise; },
  setTestDependencies: (deps: { 
    database: Database.Database | null, 
    serverServices: ServerServices | null 
  }) => {
    db = deps.database;
    serverServices = deps.serverServices;
    heavyInitPromise = null;
    cleanupPromise = null;
    shuttingDown = false;
  }
};

// Global error handlers
process.on('uncaughtException', (error: Error) => {
  process.stderr.write(`\n[FATAL ERROR] Uncaught Exception: ${error.message}\n`);
  cleanup().then(() => process.exit(1));
});

// Entry point
import { resolve } from 'node:path';
import { fileURLToPath } from 'url';

const currentFile = fileURLToPath(import.meta.url);
const scriptPath = process.argv[1] || '';
const isMainModule = scriptPath !== '' && currentFile === resolve(scriptPath);

export function resolveServerStart(transportType = process.env.TRANSPORT_TYPE) {
  const normalizedType = transportType?.toLowerCase() || 'stdio';

  if (normalizedType === 'stdio') return startServer;
  if (normalizedType === 'sse') return startHttpServer;

  throw new Error(
    `지원되지 않는 TRANSPORT_TYPE: ${transportType}. 'stdio' 또는 'sse'를 사용하세요.`,
  );
}

if (isMainModule) {
  Promise.resolve()
    .then(async () => { await resolveServerStart()(); })
    .catch((error: unknown) => {
      const err = error instanceof Error ? error : new Error(String(error));
      process.stderr.write(`\n[FATAL ERROR] Unhandled start failure: ${err.message}\n`);
      process.exit(1);
    });
}
