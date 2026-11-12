import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mementoConfig } from '../../../shared/config/index.js';
import { createGateDriftDb } from '../../telemetry/gate-drift/__tests__/gate-drift-test-support.js';
import {
  clearSettingRuntimeReapplyForTest,
  registerSettingRuntimeReapply,
  runSettingRuntimeReapply,
} from '../setting-runtime-reapply-registry.js';

const scheduler = vi.hoisted(() => ({
  updateConfig: vi.fn(),
  restartJob: vi.fn(),
  stopJob: vi.fn(),
}));

vi.mock('../../../infrastructure/scheduler/batch-scheduler/batch-scheduler-singleton.js', () => ({
  getBatchScheduler: () => scheduler,
}));

const { wireSettingRuntimeReapply, registerSearchRejectionGateTarget, unwireSettingRuntimeReapply } = await import(
  '../../../bootstrap/setting-runtime-apply-wiring.js'
);

describe('setting runtime reapply wiring (#1599)', () => {
  let db: Database.Database;

  beforeEach(async () => {
    db = await createGateDriftDb();
    vi.clearAllMocks();
    clearSettingRuntimeReapplyForTest();
    registerSearchRejectionGateTarget(null);
    delete process.env.SUPERSEDE_CANDIDATE_SCAN_ENABLED;
    mementoConfig.searchRejectionGate = 'off';
    mementoConfig.typesafeApiKey = '';
    mementoConfig.batchSchedulerEnabled = true;
    mementoConfig.searchRejectionGateThreshold = 0.4;
  });

  afterEach(() => {
    db.close();
  });

  it('pushes a fresh rejection gate into the registered hybrid engine', () => {
    mementoConfig.searchRejectionGate = 'typesafe';
    mementoConfig.typesafeApiKey = 'test-key';
    const target = { setRejectionGate: vi.fn() };
    wireSettingRuntimeReapply(target as never, db);
    runSettingRuntimeReapply('SEARCH_REJECTION_GATE');
    expect(target.setRejectionGate).toHaveBeenCalledWith(expect.objectContaining({ score: expect.any(Function) }));
  });

  it('updates batch scheduler config and restarts or stops supersede scan', () => {
    wireSettingRuntimeReapply({ setRejectionGate: vi.fn() } as never, db);
    process.env.SUPERSEDE_CANDIDATE_SCAN_ENABLED = 'true';
    runSettingRuntimeReapply('SUPERSEDE_CANDIDATE_SCAN_ENABLED');
    expect(scheduler.updateConfig).toHaveBeenCalledWith({ supersedeCandidateScanEnabled: true });
    expect(scheduler.restartJob).toHaveBeenCalledWith('supersede_candidate_scan');

    vi.clearAllMocks();
    process.env.SUPERSEDE_CANDIDATE_SCAN_ENABLED = 'false';
    runSettingRuntimeReapply('SUPERSEDE_CANDIDATE_SCAN_ENABLED');
    expect(scheduler.updateConfig).toHaveBeenCalledWith({ supersedeCandidateScanEnabled: false });
    expect(scheduler.stopJob).toHaveBeenCalledWith('supersede_candidate_scan');
  });

  it('ignores unknown keys', () => {
    registerSettingRuntimeReapply('CUSTOM', vi.fn());
    expect(() => runSettingRuntimeReapply('MISSING')).not.toThrow();
  });

  it('skips restartJob when batch scheduler is disabled at runtime', () => {
    wireSettingRuntimeReapply({ setRejectionGate: vi.fn() } as never, db);
    mementoConfig.batchSchedulerEnabled = false;
    vi.stubEnv('BATCH_SCHEDULER_ENABLED', 'false');
    process.env.SUPERSEDE_CANDIDATE_SCAN_ENABLED = 'true';
    runSettingRuntimeReapply('SUPERSEDE_CANDIDATE_SCAN_ENABLED');
    expect(scheduler.updateConfig).toHaveBeenCalledWith({ supersedeCandidateScanEnabled: true });
    expect(scheduler.restartJob).not.toHaveBeenCalled();
  });

  it('clears reapply handlers on unwire so later changes do not touch consumers', () => {
    const target = { setRejectionGate: vi.fn() };
    wireSettingRuntimeReapply(target as never, db);
    unwireSettingRuntimeReapply();
    runSettingRuntimeReapply('SEARCH_REJECTION_GATE');
    expect(target.setRejectionGate).not.toHaveBeenCalled();
  });

  const baselineSources = () =>
    db.prepare('SELECT source FROM rejection_gate_baseline WHERE id > 2 ORDER BY id').all();

  it('records a setting_change baseline when the threshold is reapplied with a new value', () => {
    mementoConfig.searchRejectionGate = 'typesafe';
    wireSettingRuntimeReapply({ setRejectionGate: vi.fn() } as never, db);
    runSettingRuntimeReapply('SEARCH_REJECTION_GATE_THRESHOLD');
    expect(baselineSources()).toEqual([]);

    mementoConfig.searchRejectionGateThreshold = 0.5;
    runSettingRuntimeReapply('SEARCH_REJECTION_GATE_THRESHOLD');
    runSettingRuntimeReapply('SEARCH_REJECTION_GATE_THRESHOLD');
    expect(baselineSources()).toEqual([{ source: 'setting_change' }]);
  });

  it('records a baseline when turning the gate on with a threshold that differs from the active one', () => {
    wireSettingRuntimeReapply({ setRejectionGate: vi.fn() } as never, db);
    mementoConfig.searchRejectionGateThreshold = 0.5;
    mementoConfig.searchRejectionGate = 'typesafe';
    mementoConfig.typesafeApiKey = 'test-key';
    runSettingRuntimeReapply('SEARCH_REJECTION_GATE');
    expect(baselineSources()).toEqual([{ source: 'setting_change' }]);
  });

  it('does not throw when the baseline cannot be written, so the threshold change is not rolled back', () => {
    mementoConfig.searchRejectionGate = 'typesafe';
    mementoConfig.searchRejectionGateThreshold = 0.5;
    wireSettingRuntimeReapply({ setRejectionGate: vi.fn() } as never, db);
    db.close();
    expect(() => runSettingRuntimeReapply('SEARCH_REJECTION_GATE_THRESHOLD')).not.toThrow();
  });
});
