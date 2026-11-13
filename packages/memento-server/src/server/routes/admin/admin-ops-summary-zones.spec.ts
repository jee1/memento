import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { resetBatchScheduler, getBatchScheduler } from '@memento/core';
import { buildOpsSummary } from './admin-ops-summary.service.js';
import {
  buildOpsSummaryZones,
  decomposeEmptySearchForTest,
} from './admin-ops-summary-zones.js';
import { buildAdminStatus } from './admin-status-service.js';
import type { ServerServices } from '../../bootstrap.js';
import type { OpsSummaryTimeWindow, OpsSummaryZoneItem } from './admin-ops-summary.types.js';

function ensureTelemetryTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS telemetry_events (
      id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      request_id TEXT,
      owner_id TEXT,
      outcome TEXT,
      extra_data TEXT,
      created_at TEXT NOT NULL
    );
  `);
}

function insertTe(
  db: Database.Database,
  row: {
    id: string;
    event_type: string;
    request_id?: string | null;
    owner_id?: string | null;
    outcome?: string | null;
    extra_data?: string | null;
    created_at: string;
  },
): void {
  db.prepare(
    `INSERT INTO telemetry_events (id, event_type, request_id, owner_id, outcome, extra_data, created_at)
     VALUES (@id, @event_type, @request_id, @owner_id, @outcome, @extra_data, @created_at)`,
  ).run({
    id: row.id,
    event_type: row.event_type,
    request_id: row.request_id ?? null,
    owner_id: row.owner_id ?? null,
    outcome: row.outcome ?? null,
    extra_data: row.extra_data ?? null,
    created_at: row.created_at,
  });
}

const WINDOW: OpsSummaryTimeWindow = {
  period: '24h',
  since: '2026-11-12T00:00:00.000Z',
  until: '2026-11-13T00:00:00.000Z',
};

function byKey(items: OpsSummaryZoneItem[], key: string): OpsSummaryZoneItem {
  const hit = items.find((i) => i.key === key);
  if (!hit) throw new Error(`missing zone key ${key}`);
  return hit;
}

describe('ops summary zones (#1698)', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    resetBatchScheduler();
  });

  afterEach(() => {
    db.close();
    resetBatchScheduler();
  });

  it('empty DB: zones present with 0/null values and no throw', async () => {
    const summary = await buildOpsSummary(db, null, '24h', null, Date.parse('2026-11-13T12:00:00.000Z'));
    expect(summary.zones).toBeDefined();
    expect(summary.zones.system_ok.length).toBeGreaterThan(0);
    expect(summary.zones.doing_work.length).toBeGreaterThan(0);
    expect(summary.zones.needs_action.length).toBeGreaterThan(0);
    expect(byKey(summary.zones.doing_work, 'item_filter_empty').value).toBe(0);
    expect(byKey(summary.zones.doing_work, 'injection_empty').value).toBe(0);
    expect(byKey(summary.zones.system_ok, 'auth_denied_count').value).toBe(0);
    expect(byKey(summary.zones.doing_work, 'gate_drift_alert').value).toBeNull();
  });

  it('preserves existing questions fields alongside zones', async () => {
    const summary = await buildOpsSummary(db, null, '24h', null, Date.parse('2026-11-13T12:00:00.000Z'));
    expect(summary.questions.search_health).toMatchObject({
      availability: 'unmeasured',
      search_failed_events: 0,
    });
    expect(summary.admin_status_path).toBe('/admin/status');
    expect(summary.zones).toBeTruthy();
  });

  it('search empty split: rejected + no_result equals empty count (rejected)', () => {
    ensureTelemetryTable(db);
    insertTe(db, {
      id: 'e1',
      event_type: 'memory.search.empty',
      request_id: 'r1',
      created_at: '2026-11-12T10:00:00.000Z',
    });
    insertTe(db, {
      id: 'rr1',
      event_type: 'memory.search.reranked',
      request_id: 'r1',
      extra_data: JSON.stringify({ rejection_gate_verdict: 'rejected' }),
      created_at: '2026-11-12T10:00:01.000Z',
    });
    const split = decomposeEmptySearchForTest(db, WINDOW, null);
    expect(split.total).toBe(1);
    expect(split.rejected).toBe(1);
    expect(split.no_result).toBe(0);
    expect(split.rejected + split.no_result).toBe(split.total);
  });

  it('search empty split: no_result when gate passed', () => {
    ensureTelemetryTable(db);
    insertTe(db, {
      id: 'e2',
      event_type: 'memory.search.empty',
      request_id: 'r2',
      created_at: '2026-11-12T11:00:00.000Z',
    });
    insertTe(db, {
      id: 'rr2',
      event_type: 'memory.search.reranked',
      request_id: 'r2',
      extra_data: JSON.stringify({ rejection_gate_verdict: 'passed' }),
      created_at: '2026-11-12T11:00:01.000Z',
    });
    const split = decomposeEmptySearchForTest(db, WINDOW, null);
    expect(split.rejected).toBe(0);
    expect(split.no_result).toBe(1);
  });

  it('search empty split: no_result when gate off (no verdict)', () => {
    ensureTelemetryTable(db);
    insertTe(db, {
      id: 'e3',
      event_type: 'memory.search.empty',
      request_id: 'r3',
      created_at: '2026-11-12T12:00:00.000Z',
    });
    insertTe(db, {
      id: 'rr3',
      event_type: 'memory.search.reranked',
      request_id: 'r3',
      extra_data: JSON.stringify({ candidate_count: 0 }),
      created_at: '2026-11-12T12:00:01.000Z',
    });
    const split = decomposeEmptySearchForTest(db, WINDOW, null);
    expect(split.rejected).toBe(0);
    expect(split.no_result).toBe(1);
  });

  it('item_filter_empty and injection_empty are separate', () => {
    ensureTelemetryTable(db);
    // filter off: kept=2 dropped=0 empty flag false, but outcome empty = 빈 주입
    insertTe(db, {
      id: 'f1',
      event_type: 'memory.injection.item_filtered',
      outcome: 'empty',
      extra_data: JSON.stringify({
        item_filter_kept: 0,
        item_filter_dropped: 0,
        item_filter_empty: false,
      }),
      created_at: '2026-11-12T08:00:00.000Z',
    });
    // filter emptied: kept=0 scored>0 → item_filter_empty true, outcome success
    insertTe(db, {
      id: 'f2',
      event_type: 'memory.injection.item_filtered',
      outcome: 'success',
      extra_data: JSON.stringify({
        item_filter_kept: 0,
        item_filter_dropped: 5,
        item_filter_empty: true,
      }),
      created_at: '2026-11-12T09:00:00.000Z',
    });
    const adminStatus = buildAdminStatus(db);
    const zones = buildOpsSummaryZones({
      db,
      serverServices: null,
      window: WINDOW,
      ownerId: null,
      nowMs: Date.parse('2026-11-13T00:00:00.000Z'),
      adminStatus,
      llmPressure: { availability: 'unmeasured', window: WINDOW },
    });
    expect(byKey(zones.doing_work, 'item_filter_empty').value).toBe(1);
    expect(byKey(zones.doing_work, 'injection_empty').value).toBe(1);
  });

  it('schema_version uses applied order, not lexicographic MAX ("9.0" vs "66.0")', () => {
    db.exec(
      `CREATE TABLE memento_schema_version (
         version TEXT PRIMARY KEY,
         applied_at TIMESTAMP,
         migration_name TEXT NOT NULL
       )`,
    );
    db.prepare('INSERT INTO memento_schema_version VALUES (?, ?, ?)').run(
      '9.0',
      '2025-01-01 00:00:00',
      '009',
    );
    db.prepare('INSERT INTO memento_schema_version VALUES (?, ?, ?)').run(
      '66.0',
      '2026-11-01 00:00:00',
      '066',
    );
    // Lexicographic MAX(version) would wrongly yield "9.0".
    const lexMax = (
      db.prepare('SELECT MAX(version) AS v FROM memento_schema_version').get() as { v: string }
    ).v;
    expect(lexMax).toBe('9.0');

    const adminStatus = buildAdminStatus(db);
    const zones = buildOpsSummaryZones({
      db,
      serverServices: null,
      window: WINDOW,
      ownerId: null,
      nowMs: Date.parse('2026-11-13T00:00:00.000Z'),
      adminStatus,
      llmPressure: { availability: 'unmeasured', window: WINDOW },
    });
    expect(byKey(zones.system_ok, 'schema_version').value).toBe('66.0');
  });

  it('job with no success row is not overdue', () => {
    const scheduler = getBatchScheduler();
    const detailedSpy = vi.spyOn(scheduler, 'getDetailedStats').mockReturnValue({
      status: {
        isRunning: true,
        config: { walCheckpointInterval: 60_000 },
      },
      jobs: [{ name: 'wal_checkpoint', isRunning: false, errorCount: 0 }],
      health: { runningJobs: 0, queueSize: 0, uptime: 0, memoryUsage: 0, errorRate: 0 },
    } as ReturnType<typeof scheduler.getDetailedStats>);
    db.exec(`
      CREATE TABLE IF NOT EXISTS job_run (
        id TEXT PRIMARY KEY,
        job_name TEXT NOT NULL,
        trigger TEXT NOT NULL,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        success INTEGER NOT NULL,
        duration_ms INTEGER,
        processed INTEGER,
        error_count INTEGER,
        details_json TEXT
      );
    `);
    const adminStatus = buildAdminStatus(db);
    const zones = buildOpsSummaryZones({
      db,
      serverServices: null,
      window: WINDOW,
      ownerId: null,
      nowMs: Date.parse('2026-11-13T12:00:00.000Z'),
      adminStatus,
      llmPressure: { availability: 'unmeasured', window: WINDOW },
    });
    expect(byKey(zones.system_ok, 'job_interval_overdue_count').value).toBe(0);
    detailedSpy.mockRestore();
  });

  it('severity: scheduler stopped is crit', () => {
    const adminStatus = buildAdminStatus(db);
    // force scheduler.running false via stubbed status shape
    const stub = {
      ...adminStatus,
      scheduler: { ...adminStatus.scheduler, running: false },
    };
    const zones = buildOpsSummaryZones({
      db,
      serverServices: null,
      window: WINDOW,
      ownerId: null,
      nowMs: Date.parse('2026-11-13T00:00:00.000Z'),
      adminStatus: stub,
      llmPressure: { availability: 'unmeasured', window: WINDOW },
    });
    expect(byKey(zones.system_ok, 'scheduler_running').severity).toBe('crit');
  });

  it('severity: batch failure within 24h is crit', () => {
    const nowMs = Date.parse('2026-11-13T12:00:00.000Z');
    const adminStatus = buildAdminStatus(db);
    const stub = {
      ...adminStatus,
      batchImpact: {
        ...adminStatus.batchImpact,
        failedRunCount: 1,
        durationMsSum: 10,
        lastFailedAt: new Date(nowMs - 60_000).toISOString(),
      },
    };
    const zones = buildOpsSummaryZones({
      db,
      serverServices: null,
      window: WINDOW,
      ownerId: null,
      nowMs,
      adminStatus: stub,
      llmPressure: { availability: 'unmeasured', window: WINDOW },
    });
    expect(byKey(zones.system_ok, 'batch_failed_run_count').severity).toBe('crit');
  });

  it('severity: paused jobs warn; overdue jobs warn', () => {
    const scheduler = getBatchScheduler();
    const pauseSpy = vi.spyOn(scheduler, 'getPausedJobNames').mockReturnValue(['cleanup']);
    const detailedSpy = vi.spyOn(scheduler, 'getDetailedStats').mockReturnValue({
      status: {
        isRunning: true,
        config: { walCheckpointInterval: 60_000 },
      },
      jobs: [{ name: 'wal_checkpoint', isRunning: false, errorCount: 0 }],
      health: { runningJobs: 0, queueSize: 0, uptime: 0, memoryUsage: 0, errorRate: 0 },
    } as ReturnType<typeof scheduler.getDetailedStats>);
    const nowMs = Date.parse('2026-11-13T12:00:00.000Z');
    db.exec(`
      CREATE TABLE IF NOT EXISTS job_run (
        id TEXT PRIMARY KEY,
        job_name TEXT NOT NULL,
        trigger TEXT NOT NULL,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        success INTEGER NOT NULL,
        duration_ms INTEGER,
        processed INTEGER,
        error_count INTEGER,
        details_json TEXT
      );
    `);
    db.prepare(
      `INSERT INTO job_run (id, job_name, trigger, started_at, success) VALUES ('j1','wal_checkpoint','schedule',?,1)`,
    ).run('2026-10-01T00:00:00.000Z');

    const adminStatus = buildAdminStatus(db);
    const zones = buildOpsSummaryZones({
      db,
      serverServices: null,
      window: WINDOW,
      ownerId: null,
      nowMs,
      adminStatus,
      llmPressure: { availability: 'unmeasured', window: WINDOW },
    });
    expect(byKey(zones.system_ok, 'paused_job_count').value).toBe(1);
    expect(byKey(zones.system_ok, 'paused_job_count').severity).toBe('warn');
    expect(byKey(zones.system_ok, 'job_interval_overdue_count').value).toBeGreaterThan(0);
    expect(byKey(zones.system_ok, 'job_interval_overdue_count').severity).toBe('warn');
    pauseSpy.mockRestore();
    detailedSpy.mockRestore();
  });

  it('severity: review last decision >30d with pending warn; netFlow>0 warn; embedding>0 warn', () => {
    const nowMs = Date.parse('2026-11-13T12:00:00.000Z');
    const adminStatus = buildAdminStatus(db);
    const stub = {
      ...adminStatus,
      review: {
        ...adminStatus.review,
        pendingTotal: 3,
        netFlow1h: 2,
      },
      embedding: { ...adminStatus.embedding, problemCount: 4 },
    };
    db.exec(`
      CREATE TABLE IF NOT EXISTS memory_review_candidate (
        id TEXT PRIMARY KEY,
        reviewed_at TEXT,
        status TEXT
      );
    `);
    db.prepare(`INSERT INTO memory_review_candidate (id, reviewed_at, status) VALUES ('c1', ?, 'reviewed')`).run(
      '2026-09-01T00:00:00.000Z',
    );

    const zones = buildOpsSummaryZones({
      db,
      serverServices: null,
      window: WINDOW,
      ownerId: null,
      nowMs,
      adminStatus: stub,
      llmPressure: { availability: 'unmeasured', window: WINDOW },
    });
    expect(byKey(zones.needs_action, 'review_pending_total').severity).toBe('warn');
    expect(byKey(zones.needs_action, 'review_net_flow_1h').severity).toBe('warn');
    expect(byKey(zones.needs_action, 'embedding_problem_count').severity).toBe('warn');
  });

  it('severity: gate_drift alert warn then clears when latest not alert; owner scope omits drift', () => {
    const nowMs = Date.parse('2026-11-13T12:00:00.000Z');
    const adminStatus = buildAdminStatus(db);
    const getRejectionGateDrift = vi
      .fn()
      .mockReturnValueOnce({
        latest_verdict: { alert: true, checked_at: '2026-11-13T01:00:00.000Z' },
        active_baseline: null,
      })
      .mockReturnValueOnce({
        latest_verdict: { alert: false, checked_at: '2026-11-13T02:00:00.000Z' },
        active_baseline: null,
      });
    const tel = {
      getFeedbackQuality: () => ({ positive_count: 0, negative_count: 0 }),
      getSearchQuality: () => ({ search_count: 0 }),
      getRejectionGateDrift,
    };
    const serverServices = { telemetryService: tel } as unknown as ServerServices;
    const llmPressure = { availability: 'unmeasured' as const, window: WINDOW };

    const alertZones = buildOpsSummaryZones({
      db,
      serverServices,
      window: WINDOW,
      ownerId: null,
      nowMs,
      adminStatus,
      llmPressure,
    });
    expect(byKey(alertZones.doing_work, 'gate_drift_alert').severity).toBe('warn');
    expect(byKey(alertZones.doing_work, 'gate_drift_alert').value).toBe(true);

    const clearZones = buildOpsSummaryZones({
      db,
      serverServices,
      window: WINDOW,
      ownerId: null,
      nowMs,
      adminStatus,
      llmPressure,
    });
    expect(byKey(clearZones.doing_work, 'gate_drift_alert').severity).toBe('ok');
    expect(byKey(clearZones.doing_work, 'gate_drift_alert').value).toBe(false);

    const scoped = buildOpsSummaryZones({
      db,
      serverServices,
      window: WINDOW,
      ownerId: 'owner-a',
      nowMs,
      adminStatus,
      llmPressure,
    });
    expect(byKey(scoped.doing_work, 'gate_drift_alert').value).toBeNull();
    expect(byKey(scoped.doing_work, 'gate_drift_alert').severity).toBeNull();
  });

  it('null-severity keys stay null (auth_denied, versions, injection, feedback, supersede)', () => {
    const adminStatus = buildAdminStatus(db);
    const zones = buildOpsSummaryZones({
      db,
      serverServices: {
        telemetryService: {
          getFeedbackQuality: () => ({ positive_count: 2, negative_count: 1 }),
          getSearchQuality: () => ({ search_count: 9 }),
          getRejectionGateDrift: () => ({ latest_verdict: null, active_baseline: null }),
        },
      } as unknown as ServerServices,
      window: WINDOW,
      ownerId: null,
      nowMs: Date.parse('2026-11-13T00:00:00.000Z'),
      adminStatus,
      llmPressure: {
        availability: 'measured',
        window: WINDOW,
        by_feature: [
          {
            feature: 'relation_extraction',
            attempts: 3,
            rate_limited: 1,
            other_failures: 0,
            final_fallback: 0,
            final_deferred: 0,
          },
        ],
      },
    });
    for (const key of [
      'auth_denied_count',
      'server_version',
      'schema_version',
      'item_filter_kept',
      'feedback_positive_count',
      'search_empty_rejected',
      'supersede_pending_count',
      'llm_relation_extraction_attempts',
    ]) {
      const zone = [...zones.system_ok, ...zones.doing_work, ...zones.needs_action].find((i) => i.key === key);
      expect(zone, key).toBeTruthy();
      expect(zone!.severity, key).toBeNull();
    }
  });

  it('admin_status-sourced items use 30d window; request period on request-scoped items', () => {
    const adminStatus = buildAdminStatus(db);
    const zones = buildOpsSummaryZones({
      db,
      serverServices: null,
      window: WINDOW,
      ownerId: null,
      nowMs: Date.parse('2026-11-13T00:00:00.000Z'),
      adminStatus,
      llmPressure: { availability: 'unmeasured', window: WINDOW },
    });
    expect(byKey(zones.system_ok, 'process_database').window!.period).toBe('30d');
    expect(byKey(zones.needs_action, 'embedding_problem_count').window!.period).toBe('30d');
    expect(byKey(zones.doing_work, 'item_filter_kept').window!.period).toBe('24h');
  });

  it('disk signals (#1704): migration backup + db/wal in system_ok, severity/window null', () => {
    const adminStatus = buildAdminStatus(db);
    const zones = buildOpsSummaryZones({
      db,
      serverServices: null,
      window: WINDOW,
      ownerId: null,
      nowMs: Date.parse('2026-11-13T00:00:00.000Z'),
      adminStatus,
      llmPressure: { availability: 'unmeasured', window: WINDOW },
      diskSignals: {
        migration_backup_latest_at: '2026-06-01T12:00:00.000Z',
        migration_backup_file_count: 2,
        db_size_mb: 12.5,
        wal_size_mb: 0.5,
      },
    });
    const backup = byKey(zones.system_ok, 'migration_backup');
    expect(backup.value).toBe('2026-06-01T12:00:00.000Z');
    expect(backup.severity).toBeNull();
    expect(backup.window).toBeNull();
    expect(byKey(zones.system_ok, 'migration_backup_file_count').value).toBe(2);
    expect(byKey(zones.system_ok, 'db_size_mb')).toMatchObject({
      value: 12.5,
      unit: 'MB',
      severity: null,
      window: null,
    });
    expect(byKey(zones.system_ok, 'wal_size_mb')).toMatchObject({
      value: 0.5,
      unit: 'MB',
      severity: null,
      window: null,
    });
  });

  it('disk signals (#1704): missing backups → null values, not omitted', () => {
    const adminStatus = buildAdminStatus(db);
    const zones = buildOpsSummaryZones({
      db,
      serverServices: null,
      window: WINDOW,
      ownerId: null,
      nowMs: Date.parse('2026-11-13T00:00:00.000Z'),
      adminStatus,
      llmPressure: { availability: 'unmeasured', window: WINDOW },
      diskSignals: {
        migration_backup_latest_at: null,
        migration_backup_file_count: null,
        db_size_mb: null,
        wal_size_mb: null,
      },
    });
    expect(byKey(zones.system_ok, 'migration_backup').value).toBeNull();
    expect(byKey(zones.system_ok, 'migration_backup_file_count').value).toBeNull();
    expect(byKey(zones.system_ok, 'db_size_mb').value).toBeNull();
    expect(byKey(zones.system_ok, 'wal_size_mb').value).toBeNull();
  });
});
