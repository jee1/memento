import {
  AuditHashChainService,
  assertAuditCoverage,
  createToolContext,
  executeTool,
  formatMementoResourceUri,
  getAuditMode,
  isStrictAuditAction,
  type AuditAction,
  type AuditTransport,
  type ServerServices,
  type ToolContext,
  type ToolResult,
  ToolInputValidationError,
} from '@memento/core';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import type Database from 'better-sqlite3';
import { mapToolExecutionErrorToJsonRpc } from './utils/mcp-tool-call-error.js';

export type ToolAuditContext = {
  transport: AuditTransport;
  actorId?: string | null;
  agentId?: string | null;
  /** API 토큰에 묶인 agent. 헤더로 주장한 agentId 와 달리 인자로 바꿀 수 없다. */
  boundAgentId?: string | null;
  projectId?: string | null;
};

type ToolExecutor = (name: string, args: unknown, context: ToolContext) => Promise<ToolResult>;

type ToolDispatcher = (
  name: string,
  args: unknown,
  db: Database.Database,
  services: ServerServices,
  auditContext: ToolAuditContext,
) => Promise<ToolResult>;

class ToolDispatchError extends McpError {
  constructor(
    code: number,
    readonly protocolMessage: string,
    data?: unknown,
  ) {
    super(code, protocolMessage, data);
  }
}

class Semaphore {
  private available: number;
  private readonly waiting: Array<() => void> = [];

  constructor(permits: number) {
    if (!Number.isInteger(permits) || permits < 1) throw new Error('maxConcurrency must be a positive integer');
    this.available = permits;
  }

  async acquire(): Promise<void> {
    if (this.available > 0) {
      this.available -= 1;
      return;
    }
    await new Promise<void>((resolve) => this.waiting.push(resolve));
  }

  release(): void {
    const next = this.waiting.shift();
    if (next) {
      next();
      return;
    }
    this.available += 1;
  }
}

function auditActionForTool(name: string): AuditAction {
  if (name === 'forget' || name.startsWith('remove_') || name.startsWith('delete_')) return 'delete';
  if (
    name === 'recall' || name === 'memory_injection' || name === 'export_memories'
    || name.startsWith('get_') || name.startsWith('search_') || name.startsWith('list_')
  ) return 'read';
  return 'write';
}

function stringArgument(args: unknown, key: string): string | null {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return null;
  const value = (args as Record<string, unknown>)[key];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function targetUriFromArgs(args: unknown): string | null {
  const uri = stringArgument(args, 'target_uri') ?? stringArgument(args, 'uri');
  if (uri?.startsWith('memento://')) return uri;
  const memoryId = stringArgument(args, 'memory_id');
  return memoryId
    ? formatMementoResourceUri({ ownerId: stringArgument(args, 'owner_id'), kind: 'memory', id: memoryId })
    : null;
}

function coverageInput(name: string, args: unknown, context: ToolAuditContext) {
  return {
    actorId: context.actorId ?? null,
    ownerId: stringArgument(args, 'owner_id'),
    agentId: context.agentId ?? stringArgument(args, 'agent_id'),
    transport: context.transport,
    toolOrEndpoint: name,
    action: auditActionForTool(name),
    targetUri: targetUriFromArgs(args),
    resultStatus: 'success' as const,
    evidenceMode: 'metadata_only' as const,
    requestSeen: true,
    responseSeen: false,
    toolArgsState: 'omitted' as const,
    outputState: 'omitted' as const,
  };
}

/** owner_id 가 누구의 기억을 읽을지 정하는 도구들. */
const OWNER_FILTER_TOOLS = new Set(['recall', 'memory_injection', 'export_memories']);

/**
 * 토큰에 묶인 agent 는 owner_id·agent_id 인자로 다른 agent 를 지정할 수 없고,
 * owner_id 를 비우면 자기 기억만 읽는다. 모든 transport 가 이 경계를 지난다.
 */
export function scopeArgsToBoundAgent(name: string, args: unknown, boundAgentId: string | null | undefined): unknown {
  if (!boundAgentId) return args;
  const record = args && typeof args === 'object' && !Array.isArray(args) ? args as Record<string, unknown> : {};
  for (const key of ['owner_id', 'agent_id']) {
    const value = record[key];
    if (value === undefined || value === null) continue;
    const values: unknown[] = Array.isArray(value) ? value : [value];
    if (values.some((v) => v !== boundAgentId)) {
      throw new ToolInputValidationError(`${key} must match the agent bound to this API token.`);
    }
  }
  return OWNER_FILTER_TOOLS.has(name) && record.owner_id == null ? { ...record, owner_id: boundAgentId } : args;
}

/** Validates strict-mode audit prerequisites before a tool can mutate state. */
export function assertToolAuditCoverage(
  db: Database.Database,
  name: string,
  args: unknown,
  context: ToolAuditContext,
): void {
  const input = coverageInput(name, args, context);
  assertAuditCoverage(input);
  if (getAuditMode() === 'strict' && isStrictAuditAction(input.action)) {
    db.prepare('SELECT 1 FROM audit_log LIMIT 1').get();
  }
}

/** Records dispatch metadata only; raw tool arguments and outputs never enter the audit chain. */
export function recordToolAudit(
  db: Database.Database,
  name: string,
  args: unknown,
  context: ToolAuditContext,
  resultStatus: 'success' | 'failure',
): void {
  const input = coverageInput(name, args, context);
  try {
    new AuditHashChainService(db).append({ ...input, resultStatus, responseSeen: true });
  } catch (error) {
    if (getAuditMode() === 'strict' && isStrictAuditAction(input.action)) throw error;
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[memento-audit] failed to append tool dispatch record: ${message}\n`);
  }
}

export function mapToolDispatchError(error: unknown): ToolDispatchError {
  if (error instanceof ToolDispatchError) return error;
  if (error instanceof McpError) {
    const prefix = `MCP error ${error.code}: `;
    const protocolMessage = error.message.startsWith(prefix) ? error.message.slice(prefix.length) : error.message;
    return new ToolDispatchError(error.code, protocolMessage, error.data);
  }
  const mapped = mapToolExecutionErrorToJsonRpc(error);
  if (mapped) return new ToolDispatchError(mapped.code, mapped.message, mapped.data);
  return new ToolDispatchError(
    ErrorCode.InternalError,
    'Internal error',
    error instanceof Error ? error.message : String(error),
  );
}

export function createToolDispatcher(options: {
  maxConcurrency?: number;
  execute?: ToolExecutor;
} = {}): ToolDispatcher {
  const limiter = new Semaphore(options.maxConcurrency ?? 20);

  return async (name, rawArgs, db, services, auditContext) => {
    await limiter.acquire();
    let executionStarted = false;
    let args = rawArgs;
    try {
      args = scopeArgsToBoundAgent(name, rawArgs, auditContext.boundAgentId);
      assertToolAuditCoverage(db, name, args, auditContext);
      executionStarted = true;
      const context = createToolContext({
        db,
        services,
        ...(auditContext.agentId ? { agentId: auditContext.agentId } : {}),
        ...(auditContext.boundAgentId ? { boundAgentId: auditContext.boundAgentId } : {}),
        ...(auditContext.projectId ? { projectId: auditContext.projectId } : {}),
      });
      const result = await (options.execute ?? executeTool)(name, args, context);
      recordToolAudit(db, name, args, auditContext, 'success');
      return result;
    } catch (error) {
      if (executionStarted) {
        try {
          recordToolAudit(db, name, args, auditContext, 'failure');
        } catch (auditError) {
          throw mapToolDispatchError(auditError);
        }
      }
      throw mapToolDispatchError(error);
    } finally {
      limiter.release();
    }
  };
}

/** Shared tool execution boundary for stdio, HTTP MCP, WebSocket, and REST. */
export const dispatchTool = createToolDispatcher();
