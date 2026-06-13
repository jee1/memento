#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Database from 'better-sqlite3';

export interface ReleaseGateEvidence {
  hook_return_latency_ms: number[];
  agent_attempts: number;
  agent_unblocked_attempts: number;
  queue_dropped_count: number;
  secret_fixtures: string[];
  regressions: {
    benchmark_v3?: boolean;
    mcp_tools?: boolean;
    assistant?: boolean;
  };
}

type CheckStatus = 'pass' | 'fail' | 'insufficient_evidence';

interface ReleaseGateCheck {
  name: string;
  status: CheckStatus;
  actual: number | string | boolean | null;
  threshold: number | string | boolean;
  sample_count: number;
}

export interface ReleaseGateReport {
  schema_version: 1;
  generated_at: string;
  status: 'pass' | 'fail';
  checks: ReleaseGateCheck[];
}

interface CountRow {
  count: number;
}

function percentile(values: number[], ratio: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * ratio) - 1] ?? null;
}

function tableExists(db: Database.Database, table: string): boolean {
  return Boolean(db.prepare(`
    SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?
  `).get(table));
}

function check(
  name: string,
  actual: number | string | boolean | null,
  threshold: number | string | boolean,
  sampleCount: number,
  passed: boolean,
): ReleaseGateCheck {
  return {
    name,
    status: sampleCount === 0 ? 'insufficient_evidence' : passed ? 'pass' : 'fail',
    actual,
    threshold,
    sample_count: sampleCount,
  };
}

function scanSecrets(db: Database.Database, secrets: string[]): number {
  if (secrets.length === 0) return 0;
  const sources: Array<[string, string]> = [
    ['agent_observation', 'payload_json'],
    ['memory_item', 'content'],
    ['telemetry_events', 'extra_data'],
  ];
  let leaks = 0;
  for (const [table, column] of sources) {
    if (!tableExists(db, table)) continue;
    for (const secret of secrets) {
      const row = db.prepare(`
        SELECT COUNT(*) AS count FROM ${table}
        WHERE ${column} IS NOT NULL AND instr(${column}, ?) > 0
      `).get(secret) as CountRow;
      leaks += row.count;
    }
  }
  return leaks;
}

function derivedMemoryCounts(db: Database.Database): { derived: number; covered: number } {
  const summaryRows = db.prepare(`
    SELECT summary_memory_id AS memory_id
    FROM agent_session
    WHERE summary_memory_id IS NOT NULL
  `).all() as Array<{ memory_id: string }>;
  const promotionRows = tableExists(db, 'agent_memory_promotion_candidate')
    ? db.prepare(`
        SELECT memory_id
        FROM agent_memory_promotion_candidate
        WHERE status = 'approved' AND memory_id IS NOT NULL
      `).all() as Array<{ memory_id: string }>
    : [];
  const memoryIds = [...new Set([...summaryRows, ...promotionRows].map(row => row.memory_id))];
  const covered = memoryIds.filter(memoryId => {
    const row = db.prepare(`
      SELECT COUNT(*) AS count FROM memory_provenance
      WHERE memory_id = ? AND observation_id IS NOT NULL
    `).get(memoryId) as CountRow;
    return row.count > 0;
  }).length;
  return { derived: memoryIds.length, covered };
}

export function evaluateAgentIntegrationReleaseGate(
  db: Database.Database,
  evidence: ReleaseGateEvidence,
): ReleaseGateReport {
  const capture = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status IN ('ACCEPTED', 'REDACTED', 'DUPLICATE') THEN 1 ELSE 0 END) AS successful
    FROM agent_observation
  `).get() as { total: number; successful: number | null };
  const captureRate = capture.total === 0 ? null : (capture.successful ?? 0) / capture.total;

  const provenance = derivedMemoryCounts(db);
  const provenanceCoverage = provenance.derived === 0 ? null : provenance.covered / provenance.derived;

  const injectionRows = db.prepare(`
    SELECT latency_ms, extra_data
    FROM telemetry_events
    WHERE event_type = 'agent.injection.completed'
  `).all() as Array<{ latency_ms: number | null; extra_data: string | null }>;
  const injectionLatencies = injectionRows
    .map(row => row.latency_ms)
    .filter((value): value is number => typeof value === 'number');
  const budgetExceeded = injectionRows.filter(row => {
    try {
      const data = JSON.parse(row.extra_data ?? '{}') as Record<string, unknown>;
      return data.budget_exceeded === true
        || (
          typeof data.token_budget === 'number'
          && typeof data.token_used === 'number'
          && data.token_used > data.token_budget
        );
    } catch {
      return true;
    }
  }).length;

  const duplicateRows = db.prepare(`
    SELECT COUNT(*) AS count FROM (
      SELECT adapter_name, event_id
      FROM agent_observation
      GROUP BY adapter_name, event_id
      HAVING COUNT(*) > 1
    )
  `).get() as CountRow;
  const secretLeaks = scanSecrets(db, evidence.secret_fixtures);
  const hookP95 = percentile(evidence.hook_return_latency_ms, 0.95);
  const injectionP95 = percentile(injectionLatencies, 0.95);
  const unblockedRate = evidence.agent_attempts === 0
    ? null
    : evidence.agent_unblocked_attempts / evidence.agent_attempts;
  const regressionValues = [
    evidence.regressions.benchmark_v3,
    evidence.regressions.mcp_tools,
    evidence.regressions.assistant,
  ];
  const measuredRegressions = regressionValues.filter(value => typeof value === 'boolean');

  const checks: ReleaseGateCheck[] = [
    check('capture_success_rate', captureRate, '>=0.99', capture.total, captureRate !== null && captureRate >= 0.99),
    check(
      'provenance_coverage',
      provenanceCoverage,
      '1.0',
      provenance.derived,
      provenanceCoverage === 1,
    ),
    check(
      'secret_leak_count',
      secretLeaks,
      0,
      evidence.secret_fixtures.length,
      secretLeaks === 0,
    ),
    check(
      'hook_return_p95_ms',
      hookP95,
      '<=50',
      evidence.hook_return_latency_ms.length,
      hookP95 !== null && hookP95 <= 50,
    ),
    check(
      'injection_p95_ms',
      injectionP95,
      '<=1500',
      injectionLatencies.length,
      injectionP95 !== null && injectionP95 <= 1500,
    ),
    check(
      'injection_budget_exceeded',
      budgetExceeded,
      0,
      injectionRows.length,
      budgetExceeded === 0,
    ),
    check(
      'queue_dropped_count',
      evidence.queue_dropped_count,
      0,
      evidence.agent_attempts,
      evidence.queue_dropped_count === 0,
    ),
    check(
      'duplicate_event_rows',
      duplicateRows.count,
      0,
      capture.total,
      duplicateRows.count === 0,
    ),
    check(
      'agent_unblocked_rate',
      unblockedRate,
      '1.0',
      evidence.agent_attempts,
      unblockedRate === 1,
    ),
    check(
      'regression_suite',
      measuredRegressions.length === 3 && regressionValues.every(Boolean),
      true,
      measuredRegressions.length,
      measuredRegressions.length === 3 && regressionValues.every(Boolean),
    ),
  ];

  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    status: checks.every(item => item.status === 'pass') ? 'pass' : 'fail',
    checks,
  };
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function main(): void {
  const databasePath = argument('--db') ?? process.env.DB_PATH;
  const evidencePath = argument('--evidence');
  const outputPath = argument('--output');
  if (!databasePath || !evidencePath) {
    console.error(
      'Usage: npm run quality:agent-integration:release-gate -- --db <path> --evidence <json> [--output <json>]',
    );
    process.exitCode = 2;
    return;
  }
  const evidence = JSON.parse(
    readFileSync(resolve(evidencePath), 'utf8'),
  ) as ReleaseGateEvidence;
  const db = new Database(resolve(databasePath), { readonly: true });
  try {
    const report = evaluateAgentIntegrationReleaseGate(db, evidence);
    const serialized = `${JSON.stringify(report, null, 2)}\n`;
    if (outputPath) writeFileSync(resolve(outputPath), serialized, 'utf8');
    process.stdout.write(serialized);
    if (report.status !== 'pass') process.exitCode = 1;
  } finally {
    db.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
