import {
  AuditHashChainService,
  assertAuditCoverage,
  formatMementoResourceUri,
  getAuditMode,
  isStrictAuditAction,
  type AuditAction,
  type AuditTransport,
} from '@memento/core';
import type Database from 'better-sqlite3';

export type ToolAuditContext = {
  transport: AuditTransport;
  actorId?: string | null;
  agentId?: string | null;
};

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
