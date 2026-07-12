import { createHash, randomUUID } from 'crypto';
import type Database from 'better-sqlite3';

export const AUDIT_MODE_ENV = 'MEMENTO_AUDIT_MODE';

export type AuditTransport = 'mcp_stdio' | 'mcp_http' | 'http_admin';
export type AuditAction = 'read' | 'write' | 'delete' | 'admin' | 'auth_denied';
export type AuditResultStatus = 'success' | 'failure' | 'denied';
export type AuditEvidenceMode = 'full' | 'redacted' | 'metadata_only' | 'unavailable';
export type AuditPayloadState = 'captured' | 'redacted' | 'omitted';
export type AuditOutputState = 'captured' | 'truncated' | 'omitted';
export type AuditVerdict = 'pass' | 'fail' | 'incomplete';
export type AuditCoverageGap =
  | 'audit_write_failed'
  | 'actor_unverified'
  | 'payload_redacted'
  | 'output_truncated'
  | 'retention_conflict';
export type AuditMode = 'best-effort' | 'strict';

export interface AuditLogInput {
  actorId?: string | null;
  ownerId?: string | null;
  agentId?: string | null;
  transport: AuditTransport;
  toolOrEndpoint: string;
  action: AuditAction;
  targetUri?: string | null;
  resultStatus: AuditResultStatus;
  evidenceMode?: AuditEvidenceMode;
  requestSeen?: boolean;
  responseSeen?: boolean;
  toolArgsState?: AuditPayloadState;
  outputState?: AuditOutputState;
  auditVerdict?: AuditVerdict;
  coverageGap?: AuditCoverageGap | null;
}

export interface AuditLogRecord extends Required<Omit<AuditLogInput, 'actorId' | 'ownerId' | 'agentId' | 'targetUri' | 'coverageGap'>> {
  id: string;
  timestamp: string;
  actorId: string | null;
  ownerId: string | null;
  agentId: string | null;
  targetUri: string | null;
  coverageGap: AuditCoverageGap | null;
  previousHash: string | null;
  currentHash: string;
}

export interface AuditLogQuery {
  action?: AuditAction;
  transport?: AuditTransport;
  actorId?: string;
  limit?: number;
}

export interface AuditChainVerification {
  valid: boolean;
  checked: number;
  brokenAtId?: string;
}

export class AuditCoverageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuditCoverageError';
  }
}

export function getAuditMode(): AuditMode {
  return process.env[AUDIT_MODE_ENV] === 'strict' ? 'strict' : 'best-effort';
}

export function isStrictAuditAction(action: AuditAction): boolean {
  return action === 'delete' || action === 'admin' || action === 'auth_denied';
}

function inferCoverageGap(input: AuditLogInput): AuditCoverageGap | null {
  if (input.coverageGap !== undefined) return input.coverageGap;
  if (!input.actorId) return 'actor_unverified';
  if (input.toolArgsState === 'redacted') return 'payload_redacted';
  if (input.outputState === 'truncated') return 'output_truncated';
  return null;
}

export function assertAuditCoverage(input: AuditLogInput): void {
  const coverageGap = inferCoverageGap(input);
  const unavailable = input.evidenceMode === 'unavailable';
  const incomplete = input.auditVerdict === 'incomplete';
  const alreadyRejected = input.action === 'auth_denied' && input.resultStatus === 'denied';
  if (getAuditMode() === 'strict' && isStrictAuditAction(input.action) && !alreadyRejected && (coverageGap || unavailable || incomplete)) {
    throw new AuditCoverageError(`Strict audit coverage is incomplete for ${input.action}: ${coverageGap ?? 'evidence_unavailable'}`);
  }
}

function hashRecord(record: Omit<AuditLogRecord, 'currentHash'>): string {
  const canonical = JSON.stringify({
    id: record.id,
    timestamp: record.timestamp,
    actorId: record.actorId,
    ownerId: record.ownerId,
    agentId: record.agentId,
    transport: record.transport,
    toolOrEndpoint: record.toolOrEndpoint,
    action: record.action,
    targetUri: record.targetUri,
    resultStatus: record.resultStatus,
    evidenceMode: record.evidenceMode,
    requestSeen: record.requestSeen,
    responseSeen: record.responseSeen,
    toolArgsState: record.toolArgsState,
    outputState: record.outputState,
    auditVerdict: record.auditVerdict,
    coverageGap: record.coverageGap,
    previousHash: record.previousHash,
  });
  return createHash('sha256').update(canonical).digest('hex');
}

function toRecord(row: Record<string, unknown>): AuditLogRecord {
  return {
    id: row.id as string,
    timestamp: row.timestamp as string,
    actorId: row.actor_id as string | null,
    ownerId: row.owner_id as string | null,
    agentId: row.agent_id as string | null,
    transport: row.transport as AuditTransport,
    toolOrEndpoint: row.tool_or_endpoint as string,
    action: row.action as AuditAction,
    targetUri: row.target_uri as string | null,
    resultStatus: row.result_status as AuditResultStatus,
    evidenceMode: row.evidence_mode as AuditEvidenceMode,
    requestSeen: Boolean(row.request_seen),
    responseSeen: Boolean(row.response_seen),
    toolArgsState: row.tool_args_state as AuditPayloadState,
    outputState: row.output_state as AuditOutputState,
    auditVerdict: row.audit_verdict as AuditVerdict,
    coverageGap: row.coverage_gap as AuditCoverageGap | null,
    previousHash: row.previous_hash as string | null,
    currentHash: row.current_hash as string,
  };
}

function normalizeRecord(input: AuditLogInput, previousHash: string | null): Omit<AuditLogRecord, 'currentHash'> {
  const coverageGap = inferCoverageGap(input);
  return {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    actorId: input.actorId ?? null,
    ownerId: input.ownerId ?? null,
    agentId: input.agentId ?? null,
    transport: input.transport,
    toolOrEndpoint: input.toolOrEndpoint,
    action: input.action,
    targetUri: input.targetUri ?? null,
    resultStatus: input.resultStatus,
    evidenceMode: input.evidenceMode ?? 'metadata_only',
    requestSeen: input.requestSeen ?? false,
    responseSeen: input.responseSeen ?? false,
    toolArgsState: input.toolArgsState ?? 'omitted',
    outputState: input.outputState ?? 'omitted',
    auditVerdict: input.auditVerdict ?? (coverageGap ? 'incomplete' : 'pass'),
    coverageGap,
    previousHash,
  };
}

export class AuditHashChainService {
  constructor(private readonly db: Database.Database) {}

  append(input: AuditLogInput): AuditLogRecord {
    assertAuditCoverage(input);
    const previousHash = (this.db.prepare('SELECT current_hash FROM audit_log ORDER BY rowid DESC LIMIT 1').get() as { current_hash?: string } | undefined)?.current_hash ?? null;
    const pending = normalizeRecord(input, previousHash);
    const record: AuditLogRecord = { ...pending, currentHash: hashRecord(pending) };

    this.db.prepare(`
      INSERT INTO audit_log (
        id, timestamp, actor_id, owner_id, agent_id, transport, tool_or_endpoint, action, target_uri,
        result_status, evidence_mode, request_seen, response_seen, tool_args_state, output_state,
        audit_verdict, coverage_gap, previous_hash, current_hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.id, record.timestamp, record.actorId, record.ownerId, record.agentId, record.transport,
      record.toolOrEndpoint, record.action, record.targetUri, record.resultStatus, record.evidenceMode,
      Number(record.requestSeen), Number(record.responseSeen), record.toolArgsState, record.outputState,
      record.auditVerdict, record.coverageGap, record.previousHash, record.currentHash,
    );
    return record;
  }

  list(query: AuditLogQuery = {}): AuditLogRecord[] {
    const limit = query.limit ?? 100;
    if (!Number.isInteger(limit) || limit < 1 || limit > 1_000) throw new Error('limit must be an integer between 1 and 1000');
    const conditions: string[] = [];
    const values: unknown[] = [];
    if (query.action) {
      conditions.push('action = ?');
      values.push(query.action);
    }
    if (query.transport) {
      conditions.push('transport = ?');
      values.push(query.transport);
    }
    if (query.actorId) {
      conditions.push('actor_id = ?');
      values.push(query.actorId);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = this.db.prepare(`SELECT * FROM audit_log ${where} ORDER BY rowid DESC LIMIT ?`).all(...values, limit) as Array<Record<string, unknown>>;
    return rows.map(toRecord);
  }

  verify(): AuditChainVerification {
    const rows = this.db.prepare('SELECT * FROM audit_log ORDER BY rowid ASC').all() as Array<Record<string, unknown>>;
    let previousHash: string | null = null;
    for (const row of rows) {
      const record = toRecord(row);
      const { currentHash, ...pending } = record;
      if (record.previousHash !== previousHash || currentHash !== hashRecord(pending)) {
        return { valid: false, checked: rows.indexOf(row), brokenAtId: record.id };
      }
      previousHash = currentHash;
    }
    return { valid: true, checked: rows.length };
  }
}
