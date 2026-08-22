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
} from '@memento/core';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import type Database from 'better-sqlite3';
import { mapToolExecutionErrorToJsonRpc } from './utils/mcp-tool-call-error.js';

export type ToolAuditContext = {
  transport: AuditTransport;
  actorId?: string | null;
  agentId?: string | null;
};

type ToolExecutor = (name: string, args: unknown, context: ToolContext) => Promise<ToolResult>;

export type ToolDispatcher = (
  name: string,
  args: unknown,
  db: Database.Database,
  services: ServerServices,
  auditContext: ToolAuditContext,
) => Promise<ToolResult>;

export class ToolDispatchError extends McpError {
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

  return async (name, args, db, services, auditContext) => {
    await limiter.acquire();
    let executionStarted = false;
    try {
      assertToolAuditCoverage(db, name, args, auditContext);
      executionStarted = true;
      const context = createToolContext({
        db,
        services,
        ...(auditContext.agentId ? { agentId: auditContext.agentId } : {}),
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
