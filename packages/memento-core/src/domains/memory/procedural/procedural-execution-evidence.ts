/**
 * #1550: 절차 실행 증거와 채택 회귀 게이트.
 *
 * 증거는 실행한 행 id, 기록 시점의 본문 해시, 고정 환경(environment, tool_version)에 묶인다.
 * 게이트는 판정만 돌려주고 기억을 바꾸지 않는다. 새 버전 채택은 사람이 판정을 보고 따로 한다.
 */
import type Database from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';
import { mementoConfig } from '../../../shared/config/index.js';
import { type CallerMemoryScope, selectIdsInScope } from '../../../shared/utils/owned-ids.js';
import {
  findActiveProcedureSubject,
  findServedProceduralVersion,
  type ProcedureSubjectRow,
} from '../repositories/memory-item-repository.js';

export type ExecutionKind = 'replay' | 'held_out';
export type ExecutionOutcome = 'success' | 'failure';

export interface ProceduralExecutionInput {
  memoryId: string;
  /** 호출자가 실행 한 번에 붙이는 id. 같은 실행을 다시 보내도 한 번만 남는다. */
  runId: string;
  caseId: string;
  kind: ExecutionKind;
  environment: string;
  toolVersion: string;
  outcome: ExecutionOutcome;
  detail?: string | null;
}

export type ProceduralExecutionRecordOutcome =
  | { kind: 'recorded'; id: string }
  | { kind: 'already_recorded'; id: string }
  | {
      kind: 'rejected';
      reason:
        | 'disabled'
        | 'invalid_input'
        | 'memory_not_found'
        | 'not_procedure'
        | 'out_of_scope'
        | 'run_id_conflict';
    };

export type AdoptionGateBlock =
  | 'candidate_not_found'
  | 'candidate_not_unverified'
  | 'served_not_found'
  | 'scope_mismatch'
  | 'series_mismatch';
export type AdoptionGateReason = 'no_baseline_success' | 'regression' | 'missing_case' | 'replay_only' | 'held_out_failure';

export interface CaseTally {
  cases: number;
  passed: number;
}

export interface AdoptionGateReport {
  servedMemoryId: string;
  /** 제공 버전이 고정 환경에서 성공한 case. 회귀를 막을 대상이다. */
  baselineSuccessCases: string[];
  regressions: string[];
  missingCases: string[];
  replay: CaseTally;
  heldOut: CaseTally;
  /** 기록 뒤 본문이 바뀌어 판정에서 뺀 증거 수. */
  staleEvidence: number;
}

export type AdoptionGateVerdict =
  | { kind: 'blocked'; reason: AdoptionGateBlock }
  | { kind: 'judged'; passed: boolean; reasons: AdoptionGateReason[]; report: AdoptionGateReport };

interface EvidenceRow {
  id: string;
  run_id: string;
  memory_id: string;
  content_sha256: string;
  case_id: string;
  kind: ExecutionKind;
  environment: string;
  tool_version: string;
  outcome: ExecutionOutcome;
  detail: string | null;
  created_at: string;
}

const EXECUTION_KINDS: readonly string[] = ['replay', 'held_out'] satisfies ExecutionKind[];
const EXECUTION_OUTCOMES: readonly string[] = ['success', 'failure'] satisfies ExecutionOutcome[];

/** append-only 테이블 detail 상한(UTF-8 바이트). */
export const PROCEDURAL_EXECUTION_DETAIL_MAX_BYTES = 4096;
const DETAIL_TRUNCATED_SUFFIX = '\n...[detail truncated]';

function trimExecutionField(value: string): string {
  return value.trim();
}

function truncateUtf8Detail(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) {
    return text;
  }
  const suffixBytes = Buffer.byteLength(DETAIL_TRUNCATED_SUFFIX, 'utf8');
  const budget = maxBytes - suffixBytes;
  let end = text.length;
  while (end > 0 && Buffer.byteLength(text.slice(0, end), 'utf8') > budget) {
    end -= 1;
  }
  return `${text.slice(0, end)}${DETAIL_TRUNCATED_SUFFIX}`;
}

function normalizeDetail(detail: string | null | undefined): string | null {
  if (detail == null) {
    return null;
  }
  const trimmed = detail.trim();
  if (trimmed === '') {
    return null;
  }
  return truncateUtf8Detail(trimmed, PROCEDURAL_EXECUTION_DETAIL_MAX_BYTES);
}

function normalizeExecutionInput(input: ProceduralExecutionInput): ProceduralExecutionInput | null {
  if (typeof input.runId !== 'string' || input.runId.trim() === '') {
    return null;
  }
  const caseId = trimExecutionField(input.caseId);
  const environment = trimExecutionField(input.environment);
  const toolVersion = trimExecutionField(input.toolVersion);
  if (!caseId || !environment || !toolVersion) {
    return null;
  }
  if (!EXECUTION_KINDS.includes(input.kind) || !EXECUTION_OUTCOMES.includes(input.outcome)) {
    return null;
  }
  return {
    ...input,
    runId: input.runId,
    caseId,
    environment,
    toolVersion,
    detail: normalizeDetail(input.detail),
  };
}

/** 후보가 이 시리즈를 고치려는 제안인지. 추출기가 쓰는 workflow_name 이나 skill_name 이 같아야 한다. */
function proposesForSeries(candidate: ProcedureSubjectRow, served: ProcedureSubjectRow): boolean {
  return (
    (candidate.workflowName !== null && candidate.workflowName === served.workflowName) ||
    (candidate.skillName !== null && candidate.skillName === served.skillName)
  );
}

const PAYLOAD_FIELDS = [
  'memory_id', 'content_sha256', 'case_id', 'kind', 'environment', 'tool_version', 'outcome', 'detail',
] as const;

function contentSha256(subject: ProcedureSubjectRow): string {
  return createHash('sha256').update(JSON.stringify([subject.content, subject.steps]), 'utf8').digest('hex');
}

function isUnverifiedCandidate(subject: ProcedureSubjectRow): boolean {
  if (subject.type !== 'episodic' || !subject.originSource) {
    return false;
  }
  try {
    return JSON.parse(subject.originSource)?.reflexion?.state === 'unverified_candidate';
  } catch {
    return false;
  }
}

export function recordProceduralExecution(
  db: Database.Database,
  input: ProceduralExecutionInput,
  scope: CallerMemoryScope = {},
): ProceduralExecutionRecordOutcome {
  if (!mementoConfig.proceduralExecutionEvidenceEnabled) {
    return { kind: 'rejected', reason: 'disabled' };
  }
  const normalized = normalizeExecutionInput(input);
  if (!normalized) {
    return { kind: 'rejected', reason: 'invalid_input' };
  }
  const subject = findActiveProcedureSubject(db, normalized.memoryId);
  if (!subject) {
    return { kind: 'rejected', reason: 'memory_not_found' };
  }
  if (subject.type !== 'procedural' && !isUnverifiedCandidate(subject)) {
    return { kind: 'rejected', reason: 'not_procedure' };
  }
  if (!selectIdsInScope(db, scope, [subject.id]).has(subject.id)) {
    return { kind: 'rejected', reason: 'out_of_scope' };
  }
  const row: EvidenceRow = {
    id: `pex_${randomUUID()}`,
    run_id: normalized.runId,
    memory_id: subject.id,
    content_sha256: contentSha256(subject),
    case_id: normalized.caseId,
    kind: normalized.kind,
    environment: normalized.environment,
    tool_version: normalized.toolVersion,
    outcome: normalized.outcome,
    detail: normalized.detail ?? null,
    created_at: new Date().toISOString(),
  };
  const inserted = db
    .prepare(
      `INSERT INTO procedural_execution_evidence
         (id, run_id, memory_id, content_sha256, case_id, kind, environment, tool_version, outcome, detail, created_at)
       VALUES (@id, @run_id, @memory_id, @content_sha256, @case_id, @kind, @environment, @tool_version, @outcome,
         @detail, @created_at)
       ON CONFLICT(run_id) DO NOTHING`,
    )
    .run(row).changes === 1;
  if (inserted) {
    return { kind: 'recorded', id: row.id };
  }
  const existing = db
    .prepare('SELECT * FROM procedural_execution_evidence WHERE run_id = ?')
    .get(normalized.runId) as EvidenceRow;
  return PAYLOAD_FIELDS.every((field) => existing[field] === row[field])
    ? { kind: 'already_recorded', id: existing.id }
    : { kind: 'rejected', reason: 'run_id_conflict' };
}

interface Environment {
  environment: string;
  toolVersion: string;
}

function currentEvidence(db: Database.Database, subject: ProcedureSubjectRow, env: Environment) {
  const rows = db
    .prepare(
      `SELECT * FROM procedural_execution_evidence
       WHERE memory_id = ? AND environment = ? AND tool_version = ?`,
    )
    .all(subject.id, env.environment, env.toolVersion) as EvidenceRow[];
  const sha = contentSha256(subject);
  const current = rows.filter((row) => row.content_sha256 === sha);
  return { current, stale: rows.length - current.length };
}

/** case 마다 성공 기록과 실패 기록이 있었는지. 실패가 한 번이라도 있으면 통과나 기준선 성공이 아니다. */
function summarizeCases(rows: EvidenceRow[]): Map<string, { succeeded: boolean; failed: boolean }> {
  const cases = new Map<string, { succeeded: boolean; failed: boolean }>();
  for (const row of rows) {
    const entry = cases.get(row.case_id) ?? { succeeded: false, failed: false };
    if (row.outcome === 'success') entry.succeeded = true;
    else entry.failed = true;
    cases.set(row.case_id, entry);
  }
  return cases;
}

function tally(rows: EvidenceRow[], kind: ExecutionKind): CaseTally {
  const cases = [...summarizeCases(rows.filter((row) => row.kind === kind)).values()];
  return { cases: cases.length, passed: cases.filter((entry) => !entry.failed).length };
}

/**
 * 후보가 시리즈의 제공 버전보다 고정 환경에서 나빠지지 않았는지 판정한다.
 * 다른 버전, 다른 환경, 기록 뒤 바뀐 본문의 증거와 feedback(helpful)은 세지 않는다.
 */
export function evaluateProceduralAdoption(
  db: Database.Database,
  input: { candidateMemoryId: string; versionSeriesId: string } & Environment,
): AdoptionGateVerdict {
  const environment = trimExecutionField(input.environment);
  const toolVersion = trimExecutionField(input.toolVersion);
  const env: Environment = { environment, toolVersion };
  const candidate = findActiveProcedureSubject(db, input.candidateMemoryId);
  if (!candidate) {
    return { kind: 'blocked', reason: 'candidate_not_found' };
  }
  if (!isUnverifiedCandidate(candidate)) {
    return { kind: 'blocked', reason: 'candidate_not_unverified' };
  }
  const served = findServedProceduralVersion(db, input.versionSeriesId);
  if (!served) {
    return { kind: 'blocked', reason: 'served_not_found' };
  }
  if (served.ownerId !== candidate.ownerId || served.projectId !== candidate.projectId) {
    return { kind: 'blocked', reason: 'scope_mismatch' };
  }
  if (!proposesForSeries(candidate, served)) {
    return { kind: 'blocked', reason: 'series_mismatch' };
  }

  const baseline = currentEvidence(db, served, env);
  const proposed = currentEvidence(db, candidate, env);
  const proposedCases = summarizeCases(proposed.current);
  const baselineSuccessCases = [...summarizeCases(baseline.current)]
    .filter(([, entry]) => entry.succeeded && !entry.failed)
    .map(([caseId]) => caseId)
    .sort();
  const report: AdoptionGateReport = {
    servedMemoryId: served.id,
    baselineSuccessCases,
    regressions: baselineSuccessCases.filter((caseId) => proposedCases.get(caseId)?.failed === true),
    missingCases: baselineSuccessCases.filter((caseId) => !proposedCases.has(caseId)),
    replay: tally(proposed.current, 'replay'),
    heldOut: tally(proposed.current, 'held_out'),
    staleEvidence: baseline.stale + proposed.stale,
  };

  const reasons: AdoptionGateReason[] = [];
  if (baselineSuccessCases.length === 0) reasons.push('no_baseline_success');
  if (report.regressions.length > 0) reasons.push('regression');
  if (report.missingCases.length > 0) reasons.push('missing_case');
  if (report.heldOut.cases === 0) reasons.push('replay_only');
  if (report.heldOut.passed < report.heldOut.cases) reasons.push('held_out_failure');
  return { kind: 'judged', passed: reasons.length === 0, reasons, report };
}
