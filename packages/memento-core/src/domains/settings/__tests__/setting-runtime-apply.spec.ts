import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mementoConfig } from '../../../shared/config/index.js';
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

const { wireSettingRuntimeReapply, registerSearchRejectionGateTarget } = await import(
  '../../../bootstrap/setting-runtime-apply-wiring.js'
);

describe('setting runtime reapply wiring (#1599)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearSettingRuntimeReapplyForTest();
    registerSearchRejectionGateTarget(null);
    delete process.env.SUPERSEDE_CANDIDATE_SCAN_ENABLED;
    mementoConfig.searchRejectionGate = 'off';
    mementoConfig.typesafeApiKey = '';
  });

  it('pushes a fresh rejection gate into the registered hybrid engine', () => {
    mementoConfig.searchRejectionGate = 'typesafe';
    mementoConfig.typesafeApiKey = 'test-key';
    const target = { setRejectionGate: vi.fn() };
    wireSettingRuntimeReapply(target as never);
    runSettingRuntimeReapply('SEARCH_REJECTION_GATE');
    expect(target.setRejectionGate).toHaveBeenCalledWith(expect.objectContaining({ score: expect.any(Function) }));
  });

  it('updates batch scheduler config and restarts or stops supersede scan', () => {
    wireSettingRuntimeReapply({ setRejectionGate: vi.fn() } as never);
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
});
