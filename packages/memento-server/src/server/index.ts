#!/usr/bin/env node
/**
 * Memento MCP Server 메인 진입점 (리팩토링된 버전)
 * 모듈화된 도구들을 사용하여 유지보수성 개선
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  SetLevelRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema
} from '@modelcontextprotocol/sdk/types.js';
import {
  createMementoCore,
  closeDatabase,
  createToolContext,
  getToolRegistry,
  executeTool,
  type ServerServices,
  mementoConfig,
  validateConfig,
  DatabaseUtils,
  ErrorSeverity,
  ErrorCategory,
  withErrorHandling,
  MemoryNeighborService,
  getVectorSearchEngine,
  getBatchScheduler
} from '@memento/core';
import { mcpLogger } from './mcp-logger.js';
import { ServerState } from './server-state.js';
import Database from 'better-sqlite3';
import express from 'express';
import { createServer as createHttpServer } from 'http';
import type { AddressInfo } from 'net';
import { homedir } from 'os';
import { writeServerInfo, deleteServerInfo } from './server-info.js';
import packageJson from '../../package.json' with { type: 'json' };

/**
 * Server instructions (MCP InitializeResult.instructions).
 * Exposed to clients (e.g. Cursor) as serverUseInstructions so the LLM knows how to use Memento.
 * @see https://modelcontextprotocol.io/specification — InitializeResult optional "instructions" field
 */
const MEMENTO_SERVER_INSTRUCTIONS = `Memento MCP provides persistent memory for AI agents (recall, remember, feedback, memory_injection, search_local, anchors, extract_triples).

- **Before a task**: Use \`recall\` (hybrid search) or \`memory_injection\` (query-based context) to check for relevant memories. If an anchor is set, use \`search_local\` for anchor-scoped memories.
- **After using recall results**: Use \`feedback\` to record helpful/not_helpful (optional \`score_breakdown\` from recall when explaining poor results). Prefer calling after handling the recall response (FR-004 orchestration).
- **After a task**: Use \`remember\` to store outcomes: episodic (e.g. tag: completed), semantic (e.g. best-practice, knowledge), or procedural (e.g. procedure). Check for existing memories first to avoid duplicates; include concrete, searchable keywords.
- **Triples / knowledge graph**: Use \`extract_triples\` (MCP) to extract subject–predicate–object triples from conversation or body text and optionally persist to \`kg_triple\`. For Graphviz DOT output of **memory relation** graphs, use the HTTP admin \`visualize_relations\` endpoint with \`format: "dot"\` (relation tools are not exposed via MCP stdio in this build).
- Prefer \`recall\` for general lookup and \`memory_injection\` when you need injected context for a specific query.`;

// stderr.write 래핑: undefined/null 전달 및 "undefined" 문자열 출력 차단
// (Cursor MCP 클라이언트가 stderr 라인마다 반환값을 표시할 때 undefined가 찍히는 현상 완화)
const _stderrWrite = process.stderr.write.bind(process.stderr);
process.stderr.write = function (chunk: any, ...args: any[]): boolean {
  if (chunk === undefined || chunk === null) return true;
  const s = typeof chunk === 'string' ? chunk : String(chunk);
  if (s === 'undefined' || s.trim() === 'undefined') return true;
  return _stderrWrite(s, ...args);
} as typeof process.stderr.write;

// MCP 서버 인스턴스
let server: Server;
let db: Database.Database | null = null;
// core에서 반환된 서비스 (ToolContext 생성 시 사용)
let serverServices: ServerServices | null = null;
let mgmtHttpServer: ReturnType<typeof createHttpServer> | null = null;

type TestDependencies = {
  database: Database.Database | null;
  serverServices?: ServerServices | null;
};

function setTestDependencies(_deps: TestDependencies): void {
  db = _deps.database ?? null;
  serverServices = _deps.serverServices ?? null;
}

async function writeRuntimeDiagnosticsEvent(
  type: string,
  payload: Record<string, unknown> = {}
): Promise<void> {
  if (!serverServices?.runtimeDiagnosticsLogger) {
    return;
  }

  try {
    await serverServices.runtimeDiagnosticsLogger.writeEvent({
      type,
      timestamp: new Date().toISOString(),
      transport: 'stdio',
      ...payload
    });
  } catch {
    return;
  }
}

/** Cursor 등 클라이언트가 7초 내에 Initialize 응답을 받도록, 무거운 초기화는 transport 연결 후 백그라운드에서 수행 */
let initPromise: Promise<void>;
let resolveInit: () => void;
let rejectInit: (err: Error) => void;

// MCP 서버에서는 모든 로그 출력을 완전히 차단
// 모든 console 메서드를 빈 함수로 교체
// MCP 프로토콜 스펙: stdio 전송 시 stdout에는 오직 JSON-RPC 메시지만 출력되어야 함
// 모든 로그는 stderr로 출력되어야 함 (mcpLogger 사용)
// 단, 초기화 전 에러는 stderr에 직접 출력하여 디버깅 가능하도록 함

// 초기화 상태 추적 플래그
// 초기화 전: false (fallback logger 사용)
// 초기화 후: true (MCP Logger 사용)
// ServerState를 사용하여 전역 상태 관리
const serverState = ServerState.getInstance();
serverState.setMcpServerInitialized(false);

/**
 * console.error 오버라이드 함수
 * 초기화 상태에 따라 로깅 전략을 변경:
 * - 초기화 전: fallback logger (stderr 직접 출력)
 * - 초기화 후: MCP Logger 사용 (MCP 스펙 준수)
 * 
 * 중복 등록 방지:
 * - 이미 오버라이드되었는지 확인하여 중복 등록 방지
 * - 왜 필요한가? 모듈이 여러 번 로드되면 중복 등록 가능
 */
function setupConsoleErrorOverride(): void {
  // 중복 등록 방지: 이미 오버라이드되었는지 확인
  if (serverState.isConsoleErrorOverridden()) {
    return;
  }
  
  // eslint-disable-next-line no-console
  console.error = (...args: any[]) => {
    const isInitialized = serverState.isMcpServerInitialized();
    
    if (isInitialized) {
      // 초기화 후: MCP Logger 사용 (MCP 스펙 준수)
      const message = args.map(a => String(a)).join(' ');
      mcpLogger.logServer('error', message);
    } else {
      // 초기화 전: fallback logger (stderr 직접 출력)
      // MCP 스펙 적용 범위 밖 - 서버 초기화 단계
      process.stderr.write(`[CONSOLE ERROR] ${args.map(a => String(a)).join(' ')}\n`);
    }
  };
  
  // 오버라이드 완료 플래그 설정
  serverState.setConsoleErrorOverridden(true);
}

// console 메서드 오버라이드 (중복 등록 방지)
// eslint-disable-next-line no-console
if (!serverState.isConsoleOverridden()) {
  // eslint-disable-next-line no-console
  console.log = () => {};
  setupConsoleErrorOverride();
  // eslint-disable-next-line no-console
  console.warn = () => {};
  // eslint-disable-next-line no-console
  console.info = () => {};
  // eslint-disable-next-line no-console
  console.debug = () => {};
  serverState.setConsoleOverridden(true);
}

// MCP 프로토콜 준수: stdio 전송 시 stdout에는 오직 JSON-RPC 메시지만 출력되어야 함
// 모든 로그는 stderr로 출력되어야 함 (mcpLogger 사용)
// 주의: process.stdout.write를 래핑하지 않음
// MCP SDK의 StdioServerTransport가 stdout을 직접 사용하므로 래핑하면 간섭 발생
// 대신 모듈 로드 시점부터 stdout에 출력이 발생하지 않도록 보장

// MCP 서버가 connect()되기 전까지는 로그 출력을 억제
// MCP 프로토콜 스펙: 서버가 초기화되면서 stdout에 출력이 발생하면 JSON 파싱 오류 발생

// 동시성 제한을 위한 세마포어
export class Semaphore {
  private permits: number;
  private waiting: Array<() => void> = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return;
    }

    return new Promise(resolve => {
      this.waiting.push(resolve);
    });
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

// 동시 처리 제한 (최대 20개 동시 요청)
const concurrencyLimiter = new Semaphore(20);

// 데이터베이스 상태 모니터링
/**
 * 초기 데이터베이스 상태 확인 (한 번만 실행)
 * 주기적 모니터링은 DatabaseLockMonitor가 담당하므로, 초기 상태만 확인
 */
async function checkInitialDatabaseStatus() {
  if (!db) return;
  
  try {
    const status = await DatabaseUtils.getDatabaseStatus(db);
    mcpLogger.logServer('info', '초기 데이터베이스 상태 확인', {
      journalMode: status.journalMode,
      walAutoCheckpoint: status.walAutoCheckpoint,
      busyTimeout: status.busyTimeout,
      isLocked: status.isLocked ? '잠김' : '정상'
    });
    
    // 주기적 모니터링은 DatabaseLockMonitor가 담당하므로 여기서는 초기 상태만 확인
    // 락이 감지되면 DatabaseLockMonitor가 자동으로 처리함
  } catch (error) {
    mcpLogger.logServer('warn', '초기 데이터베이스 상태 확인 실패', { error: error instanceof Error ? error.message : String(error) });
  }
}

/**
 * 무거운 초기화(DB·서비스·툴 등). transport 연결 후 백그라운드에서 실행하며,
 * 완료 시 resolveInit()을 호출해 도구/리소스 요청이 동작하도록 함.
 */
async function runHeavyInit() {
  try {
    mcpLogger.logServer('info', `Memento MCP Server v${packageJson.version}`);
    mcpLogger.logServer('info', 'MCP 서버 초기화(백그라운드) 시작...');

    validateConfig();
    mcpLogger.logServer('info', '설정 검증 완료');

    const core = await createMementoCore({
      dbPath: process.env.DB_PATH ?? mementoConfig.dbPath
    });
    db = core.db;
    serverServices = core.services;

    mcpLogger.logServer('info', '데이터베이스·서비스 초기화 완료');

    await checkInitialDatabaseStatus();
    mcpLogger.logServer('info', '초기 데이터베이스 상태 확인 완료');

    const services = serverServices;
    mcpLogger.logServer('info', '서비스 초기화 완료');

    const batchScheduler = services.batchScheduler;
    const status = batchScheduler ? batchScheduler.getStatus() : { isRunning: false, activeJobs: 0, uptime: 0 };
    mcpLogger.logServer('info', `배치 스케줄러 상태: ${JSON.stringify({
      isRunning: status.isRunning,
      activeJobs: status.activeJobs,
      uptime: status.uptime
    }, null, 2)}`);

    const providerInfo: Record<string, unknown> = {
      provider: mementoConfig.embeddingProvider.toUpperCase()
    };
    if (mementoConfig.embeddingProvider === 'openai' && mementoConfig.openaiApiKey) {
      providerInfo.model = mementoConfig.openaiModel;
      providerInfo.dimensions = mementoConfig.embeddingDimensions;
    } else if (mementoConfig.embeddingProvider === 'gemini' && mementoConfig.geminiApiKey) {
      providerInfo.model = mementoConfig.geminiModel;
      providerInfo.dimensions = mementoConfig.embeddingDimensions;
    } else if (mementoConfig.embeddingProvider === 'lightweight') {
      providerInfo.model = 'lightweight-hybrid';
      providerInfo.dimensions = 512;
    }
    mcpLogger.logServer('info', '임베딩 프로바이더 정보', providerInfo);
    mcpLogger.logServer('info', '검색 엔진 초기화 완료');

    resolveInit();
    mcpLogger.logServer('info', 'MCP 서버 초기화(백그라운드) 완료');
    mcpLogger.logServer('info', 'Memento MCP Server가 시작되었습니다!');
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    try {
      if (db) {
        closeDatabase(db);
        db = null;
      }
    } catch {
      // ignore
    }
    rejectInit(err);
  }
}

/**
 * MCP 핸들러 등록.
 * - tools/list, prompts/list, prompts/get: 정적 목록·메타데이터만 반환하므로 무거운 init을 기다리지 않음(디스커버리 타임아웃 방지).
 * - 그 외: DB·서비스가 필요하면 await initPromise.
 */
function registerHandlers() {
  // Tools 등록
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    await mcpLogger.logMCPProtocol('debug', '도구 목록 요청 처리');
    const toolRegistry = getToolRegistry();
    const tools = toolRegistry.getAll();
      await mcpLogger.logMCPProtocol('debug', `등록된 도구 개수: ${tools.length}`, { count: tools.length });
      
      return {
        tools: tools.map(tool => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema
        }))
      };
    });
    
    // Resources 목록 핸들러
    server.setRequestHandler(ListResourcesRequestSchema, async () => {
      await initPromise;
      await mcpLogger.logMCPProtocol('debug', '리소스 목록 요청 처리');
      if (!db) {
        throw new Error('Database not initialized');
      }
      
      // 모든 메모리 ID 조회
      const memories = DatabaseUtils.all(db, 'SELECT id FROM memory_item ORDER BY created_at DESC LIMIT 1000') as Array<{ id: string }>;
      await mcpLogger.logMCPProtocol('debug', `리소스 개수: ${memories.length}`, { count: memories.length });
      
      return {
        resources: memories.map((memory) => ({
          uri: `memory://${memory.id}`,
          name: `Memory ${memory.id}`,
          description: `Memory item with ID: ${memory.id}`,
          mimeType: 'application/json'
        }))
      };
    });

    // Prompts 목록 핸들러 (listOfferingsForUI 등 클라이언트 호출 시 Method not found 방지)
    server.setRequestHandler(ListPromptsRequestSchema, async () => {
      await mcpLogger.logMCPProtocol('debug', '프롬프트 목록 요청 처리');
      return {
        prompts: [
          {
            name: 'memory_injection',
            description: '관련 기억을 요약하여 프롬프트에 주입',
            arguments: [
              { name: 'query', description: '검색할 쿼리', required: true },
              { name: 'token_budget', description: '토큰 예산 (기본값: 1000)', required: false },
              { name: 'max_memories', description: '최대 기억 개수 (기본값: 5)', required: false }
            ]
          }
        ]
      };
    });

    // Prompt 조회 핸들러
    server.setRequestHandler(GetPromptRequestSchema, async (request) => {
      const { name } = request.params;
      await mcpLogger.logMCPProtocol('debug', `프롬프트 조회 요청: ${name}`, { name });
      if (name === 'memory_injection') {
        return {
          description: '관련 기억을 요약하여 프롬프트에 주입',
          arguments: [
            { name: 'query', description: '검색할 쿼리', required: true },
            { name: 'token_budget', description: '토큰 예산 (기본값: 1000)', required: false },
            { name: 'max_memories', description: '최대 기억 개수 (기본값: 5)', required: false }
          ]
        };
      }
      throw new Error(`Prompt not found: ${name}`);
    });
    
    // Resource 읽기 핸들러
    server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      await initPromise;
      const { uri } = request.params;
      await mcpLogger.logMCPProtocol('debug', `리소스 읽기 요청: ${uri}`, { uri });
      
      // URI 파싱: memory://{id}?include_neighbors=true
      const uriMatch = uri.match(/^memory:\/\/([^?]+)(\?.*)?$/);
      if (!uriMatch) {
        throw new Error(`Invalid resource URI: ${uri}`);
      }
      
      const memoryId = uriMatch[1];
      if (!memoryId) {
        throw new Error(`Invalid memory ID in URI: ${uri}`);
      }
      
      const queryString = uriMatch[2] || '';
      const includeNeighbors = queryString.includes('include_neighbors=true');
      
      if (!db) {
        throw new Error('Database not initialized');
      }
      
      // 메모리 조회
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

      const memory = DatabaseUtils.get(
        db,
        'SELECT id, type, content, importance, privacy_scope, tags, source, created_at, last_accessed, pinned FROM memory_item WHERE id = ?',
        [memoryId]
      ) as MemoryResourceRow | undefined;
      
      if (!memory) {
        throw new Error(`Memory not found: ${memoryId}`);
      }
      
      // 메모리 데이터 구성
      const memoryData: Record<string, unknown> = {
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
      
      // 이웃 기억 포함 여부 확인
      if (includeNeighbors) {
        try {
          const vectorSearchEngine = getVectorSearchEngine();
          const neighborService = new MemoryNeighborService(
            vectorSearchEngine,
            serverServices!.embeddingService,
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
          mcpLogger.logServer('warn', `이웃 기억 조회 실패: ${error instanceof Error ? error.message : String(error)}`, { error: error instanceof Error ? error.message : String(error) });
          memoryData.neighbors = [];
          memoryData.neighbors_count = 0;
        }
      }
      
      return {
        contents: [
          {
            uri,
            mimeType: 'application/json',
            text: JSON.stringify(memoryData, null, 2)
          }
        ]
      };
    });
    
    // Tool 실행 핸들러 - 동시성 제한 적용
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      await initPromise;
      const { name, arguments: args } = request.params;
      await mcpLogger.logMCPProtocol('debug', `도구 실행 요청: ${name}`, { toolName: name, args });
      await concurrencyLimiter.acquire();
      try {
        return await withErrorHandling(
          async () => {
            if (!serverServices) throw new Error('서비스가 초기화되지 않았습니다');
            if (!db) throw new Error('데이터베이스가 초기화되지 않았습니다');
            const context = createToolContext(db, serverServices);
            const toolResult = await executeTool(name, args, context);
            await mcpLogger.logMCPProtocol('debug', `도구 실행 완료: ${name}`, { toolName: name });
            
            // MCP 형식으로 변환
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(toolResult)
                }
              ]
            };
          },
          {
            operation: 'tool_execution',
            toolName: name,
            requestId: `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
          },
          {
            errorLoggingService: serverServices!.errorLoggingService,
            severity: ErrorSeverity.HIGH,
            category: ErrorCategory.TOOL_EXECUTION,
            transformError: (error) => new Error(`Tool execution failed: ${error.message}`)
          }
        );
      } finally {
        // 동시성 제한 해제
        concurrencyLimiter.release();
      }
    });
    
    // logging/setLevel 핸들러 - MCP 스펙 준수
    // MCP 스펙: logging/setLevel 요청 처리 필수
    // 참조: https://spec.modelcontextprotocol.io/specification/server/#logging
    // 
    // 구현 사항:
    // - 유효한 로그 레벨 검증 (debug, info, warn, error)
    // - 환경 변수에 로그 레벨 설정 (MCPLogger가 환경 변수를 읽음)
    // - 에러 처리: 잘못된 레벨 시 명확한 에러 메시지 반환
    server.setRequestHandler(SetLevelRequestSchema, async (request) => {
      await initPromise;
      const { level } = request.params;
      await mcpLogger.logMCPProtocol('debug', `로그 레벨 변경 요청: ${level}`, { level });
      
      // 로그 레벨 검증 (MCP 스펙: 유효한 레벨만 허용)
      const validLevels = ['debug', 'info', 'warn', 'error'];
      if (!validLevels.includes(level)) {
        throw new Error(`Invalid log level: ${level}. Valid levels are: ${validLevels.join(', ')}`);
      }
      
      // 환경 변수에 로그 레벨 설정 (MCPLogger의 getCurrentLogLevel()이 환경 변수를 읽음)
      // MCP 스펙: 로그 레벨 변경은 즉시 적용되어야 함
      process.env.LOG_LEVEL = level;
      
      await mcpLogger.logMCPProtocol('info', `로그 레벨이 ${level}로 변경되었습니다`, { level });
      
      return {};
    });
}

// 관리 HTTP 서버 기동 (CLI 통신용)
async function startMgmtHttpServer(): Promise<void> {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.get('/health', (_req, res) => {
    res.json({ status: 'healthy', transport: 'stdio' });
  });

  app.post('/tools/:name', async (req, res) => {
    if (!db || !serverServices) {
      res.status(503).json({ error: '서버 초기화 중입니다. 잠시 후 다시 시도하세요.' });
      return;
    }
    const { name } = req.params;
    try {
      const context = createToolContext(db, serverServices);
      const result = await executeTool(name, req.body as Record<string, unknown>, context);
      let actual: unknown = result;
      if (Array.isArray(result.content) && result.content[0]?.text) {
        try { actual = JSON.parse(result.content[0].text as string); } catch { /* ignore parse error */ }
      }
      res.json({ result: actual, tool: name, timestamp: new Date().toISOString() });
    } catch (err) {
      res.status(500).json({
        error: 'Tool execution failed',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  });

  mgmtHttpServer = createHttpServer(app);

  await new Promise<void>((resolvePromise, rejectPromise) => {
    mgmtHttpServer!.once('error', rejectPromise);
    mgmtHttpServer!.listen(0, '127.0.0.1', async () => {
      const addr = mgmtHttpServer!.address() as AddressInfo;
      const configDir = process.env.MEMENTO_CONFIG_DIR ?? join(homedir(), '.memento');
      try {
        await writeServerInfo(configDir, addr.port);
      } catch (err) {
        mcpLogger.logServer('error', `server.json 기록 실패: ${err}`);
        rejectPromise(err instanceof Error ? err : new Error(String(err)));
        return;
      }
      mcpLogger.logServer('info', `관리 HTTP 서버 기동 완료 (port: ${addr.port})`);
      resolvePromise();
    });
  });
}

// 서버 시작
async function startServer() {
  try {
    serverState.setMcpTransportConnected(false);

    initPromise = new Promise<void>((resolve, reject) => {
      resolveInit = resolve;
      rejectInit = reject;
    });

    server = new Server(
      {
        name: mementoConfig.serverName,
        version: mementoConfig.serverVersion,
      },
      {
        capabilities: {
          tools: {},
          resources: {},
          prompts: {},
          logging: {}
        },
        instructions: MEMENTO_SERVER_INSTRUCTIONS
      }
    );
    mcpLogger.setServer(server);
    registerHandlers();

    // transport를 먼저 연결해 Cursor가 7초 내에 Initialize 응답을 받도록 함
    const transport = new StdioServerTransport();
    await server.connect(transport);

    // 관리 HTTP 서버 기동 (CLI 통신용)
    await startMgmtHttpServer();

    serverState.setMcpTransportConnected(true);
    serverState.setMcpServerInitialized(true);
    mcpLogger.logServer('info', 'MCP 전송 계층 연결 완료');
    await writeRuntimeDiagnosticsEvent('server_start');

    // 무거운 초기화(DB·서비스)는 백그라운드에서 수행
    void runHeavyInit();
    void initPromise.catch((err: unknown) => {
      const e = err instanceof Error ? err : new Error(String(err));
      mcpLogger.logServer('error', '백그라운드 초기화 실패(후속 MCP 요청은 JSON-RPC 오류로 반환됨)', {
        error: e.message,
        stack: e.stack
      });
    });
    mcpLogger.logServer('info', 'MCP 클라이언트 연결 대기 중...');
    
    // 서버가 종료될 때까지 대기
    return new Promise<void>((resolve) => {
      process.on('SIGINT', () => {
        mcpLogger.logServer('info', '서버 종료 신호 수신 (SIGINT)');
        void writeRuntimeDiagnosticsEvent('server_shutdown_signal', { signal: 'SIGINT' });
        cleanup().then(() => {
          resolve();
          process.exit(0);
        });
      });

      process.on('SIGTERM', () => {
        mcpLogger.logServer('info', '서버 종료 신호 수신 (SIGTERM)');
        void writeRuntimeDiagnosticsEvent('server_shutdown_signal', { signal: 'SIGTERM' });
        cleanup().then(() => {
          resolve();
          process.exit(0);
        });
      });
    });
  } catch (error) {
    // 에러 발생 시 상세 정보를 stderr에 출력
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    mcpLogger.logServer('error', `서버 시작 실패: ${errorMessage}`, { 
      error: errorMessage,
      stack: errorStack,
      type: error instanceof Error ? error.constructor.name : typeof error
    });
    
    // stderr에 직접 출력하여 Cursor에서도 확인 가능하도록
    process.stderr.write(`\n[ERROR] MCP Server Start Failed\n`);
    process.stderr.write(`Error: ${errorMessage}\n`);
    if (errorStack) {
      process.stderr.write(`Stack:\n${errorStack}\n`);
    }
    process.stderr.write(`\n`);
    
    process.exit(1);
  }
}

// 정리 함수
let isCleaningUp = false;

async function cleanup() {
  if (isCleaningUp) {
    return; // 이미 정리 중이면 중복 실행 방지
  }
  
  isCleaningUp = true;

  // server.json 삭제 및 관리 HTTP 서버 종료
  if (mgmtHttpServer) {
    const configDir = process.env.MEMENTO_CONFIG_DIR ?? join(homedir(), '.memento');
    try {
      await deleteServerInfo(configDir);
    } catch {
      // ignore cleanup errors
    }
    await new Promise<void>((resolveClose) => mgmtHttpServer!.close(() => resolveClose()));
    mgmtHttpServer = null;
  }

  mcpLogger.logServer('info', '서버 정리 시작...');
  await writeRuntimeDiagnosticsEvent('server_cleanup_start');
  
  // WAL 체크포인트 스케줄러 및 데이터베이스 락 모니터 중지
  if (serverServices) {
    if (serverServices.runtimeDiagnosticsSamplerCleanup) {
      try {
        await serverServices.runtimeDiagnosticsSamplerCleanup();
        mcpLogger.logServer('info', '런타임 진단 샘플러 중지됨');
      } catch (error) {
        mcpLogger.logServer('error', `런타임 진단 샘플러 중지 실패: ${error}`, {
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    try {
      await serverServices.walCheckpointScheduler.stop();
      mcpLogger.logServer('info', 'WAL 체크포인트 스케줄러 중지됨');
    } catch (error) {
      mcpLogger.logServer('error', `WAL 체크포인트 스케줄러 중지 실패: ${error}`, { error: error instanceof Error ? error.message : String(error) });
    }
    
    try {
      serverServices.databaseLockMonitor.stop();
      mcpLogger.logServer('info', '데이터베이스 락 모니터 중지됨');
    } catch (error) {
      mcpLogger.logServer('error', `데이터베이스 락 모니터 중지 실패: ${error}`, { error: error instanceof Error ? error.message : String(error) });
    }
  }
  
  // Write Coalescing Manager의 남은 버퍼 flush
  if (serverServices?.writeCoalescingManager) {
    try {
      await serverServices.writeCoalescingManager.flush();
      await serverServices.writeCoalescingManager.destroy();
    } catch (error) {
      mcpLogger.logServer('warn', `Write coalescing flush 실패 (종료 시): ${error instanceof Error ? error.message : String(error)}`, { error: error instanceof Error ? error.message : String(error) });
    }
  }
  
  // 배치 스케줄러 중지
  try {
    const batchScheduler = getBatchScheduler();
    await batchScheduler.stop();
    mcpLogger.logServer('info', '배치 스케줄러 중지됨');
  } catch (error) {
    mcpLogger.logServer('warn', `배치 스케줄러 중지 실패: ${error instanceof Error ? error.message : String(error)}`, { error: error instanceof Error ? error.message : String(error) });
  }
  
  if (db) {
    closeDatabase(db);
    db = null; // 참조 제거
  }
  
  mcpLogger.logServer('info', '서버 정리 완료');
  await writeRuntimeDiagnosticsEvent('server_cleanup_finish');
  // Memento MCP Server 종료
}

// 프로세스 종료 시 정리
// Note: SIGINT와 SIGTERM 핸들러는 startServer() 내부에서 등록되므로
// 여기서는 uncaughtException만 처리합니다.
process.on('uncaughtException', (error) => {
  // 예상치 못한 오류 로깅
  const errorMessage = error instanceof Error ? error.message : String(error);
  const errorStack = error instanceof Error ? error.stack : undefined;
  
  // stderr에 직접 출력하여 Cursor에서도 확인 가능하도록
  process.stderr.write(`\n[FATAL ERROR] Uncaught Exception\n`);
  process.stderr.write(`Error: ${errorMessage}\n`);
  if (errorStack) {
    process.stderr.write(`Stack:\n${errorStack}\n`);
  }
  process.stderr.write(`\n`);
  
  // mcpLogger가 준비되었다면 사용
  try {
    mcpLogger.logServer('error', 'Uncaught exception', { 
      error: errorMessage,
      stack: errorStack
    });
  } catch {
    // mcpLogger 초기화 실패 시 무시
  }
  
  void writeRuntimeDiagnosticsEvent('uncaught_exception', {
    error: errorMessage,
    stack: errorStack
  });
  cleanup();
  process.exit(1);
});

// 서버 시작 함수 export (팩토리 패턴을 위해)
export { startServer, cleanup };

export const __test: {
  setTestDependencies: (deps: TestDependencies) => void;
  getDatabase: () => unknown;
  getServerServices: () => ServerServices | null;
} = {
  setTestDependencies,
  getDatabase: () => db,
  getServerServices: () => serverServices
};

// 팩토리 패턴을 사용하여 서버 시작
import { createServerFactory } from './server-factory.js';

// 서버 시작 (팩토리 패턴 사용)
async function main() {
  try {
    const factory = createServerFactory();
    const server = factory.createServerFromEnv();
    await server.start();
  } catch (error) {
    // 초기화 전 에러는 mcpLogger가 아직 준비되지 않았을 수 있으므로
    // stderr에 직접 출력
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    
    process.stderr.write(`\n[FATAL ERROR] Failed to start MCP server\n`);
    process.stderr.write(`Error: ${errorMessage}\n`);
    if (errorStack) {
      process.stderr.write(`Stack:\n${errorStack}\n`);
    }
    process.stderr.write(`\n`);
    
    // mcpLogger가 준비되었다면 사용
    try {
      mcpLogger.logServer('error', 'Failed to start server', { 
        error: errorMessage,
        stack: errorStack
      });
    } catch {
      // mcpLogger 초기화 실패 시 무시
    }
    
    process.exit(1);
  }
}

// index.ts가 직접 실행되는 경우에만 팩토리 패턴으로 서버 시작
// 팩토리 패턴을 사용하지 않는 경우를 위해 기존 startServer도 유지
// NPM 패키지로 실행할 때도 작동하도록 강화된 체크
import { fileURLToPath } from 'url';
import { basename, join, resolve } from 'path';

const currentFile = fileURLToPath(import.meta.url);
const currentFileName = basename(currentFile);
const scriptPath = process.argv[1] || '';

// 여러 방법으로 메인 모듈인지 확인
// NPM 패키지로 실행할 때는 경로가 다를 수 있으므로 파일 이름으로도 확인
// 가장 안전한 방법: process.argv[1]이 존재하고 index.js로 끝나거나 포함하는 경우
// 또는 현재 파일이 index.js인 경우 항상 실행 (bin 필드로 실행되는 경우)
const isMainModule = 
  // 현재 파일이 index.js인 경우 (가장 안전한 방법)
  currentFileName === 'index.js' ||
  // process.argv[1]이 존재하고 index.js로 끝나는 경우 (직접 실행)
  (scriptPath && (scriptPath.endsWith('index.js') || scriptPath.endsWith('index.ts'))) ||
  // 직접 실행된 경우 (로컬 개발) - import.meta.url과 비교
  import.meta.url === `file://${scriptPath}` ||
  import.meta.url.endsWith(scriptPath) ||
  // 절대 경로로 변환하여 비교 (NPM 캐시 경로 대응)
  (scriptPath && resolve(scriptPath) === resolve(currentFile)) ||
  // NPM 패키지로 실행할 때 bin 필드로 실행되는 경우 (경로에 index.js 포함)
  (scriptPath && scriptPath.includes('index.js')) ||
  // 환경 변수로 강제 실행 (디버깅용)
  process.env.FORCE_START_SERVER === 'true';

if (isMainModule) {
  main().catch((error) => {
    // 초기화 전 에러는 mcpLogger가 아직 준비되지 않았을 수 있으므로
    // stderr에 직접 출력
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    
    process.stderr.write(`\n[FATAL ERROR] Failed to start MCP server (unhandled)\n`);
    process.stderr.write(`Error: ${errorMessage}\n`);
    if (errorStack) {
      process.stderr.write(`Stack:\n${errorStack}\n`);
    }
    process.stderr.write(`\n`);
    
    // mcpLogger가 준비되었다면 사용
    try {
      mcpLogger.logServer('error', 'Failed to start server', { 
        error: errorMessage,
        stack: errorStack
      });
    } catch {
      // mcpLogger 초기화 실패 시 무시
    }
    
    process.exit(1);
  });
}
