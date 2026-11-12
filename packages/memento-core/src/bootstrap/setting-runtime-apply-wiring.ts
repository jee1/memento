/**
 * #1599: 즉시 조정 키의 런타임 소비자(검색 게이트, 배치 스케줄) 재적용.
 */
import type Database from 'better-sqlite3';
import { createRelevanceGate } from '../domains/search/services/relevance-gate/create-relevance-gate.js';
import type { HybridSearchEngine } from '../domains/search/algorithms/hybrid-search-engine.js';
import { mementoConfig } from '../shared/config/index.js';
import { resolveBoolean } from '../shared/config/environment.js';
import { getBatchScheduler } from '../infrastructure/scheduler/batch-scheduler/batch-scheduler-singleton.js';
import { countActiveMemoryItems } from '../domains/memory/index.js';
import { captureRejectionGateBaselineIfChanged } from '../domains/telemetry/index.js';
import { logger } from '../shared/utils/logger.js';
import { registerSettingRuntimeReapply, unregisterSettingRuntimeReapply } from '../domains/settings/setting-runtime-reapply-registry.js';

type RejectionGateTarget = Pick<HybridSearchEngine, 'setRejectionGate'>;

let rejectionGateTarget: RejectionGateTarget | null = null;

export function registerSearchRejectionGateTarget(target: RejectionGateTarget | null): void {
  rejectionGateTarget = target;
}

function applySearchRejectionGate(): void {
  rejectionGateTarget?.setRejectionGate(createRelevanceGate());
}

/** 관측 쓰기 실패가 임계값 변경을 되돌리면 안 된다. 핸들러가 throw 하면 설정이 롤백된다. */
export function captureBaselineWithoutThrowing(db: Database.Database, source: 'setting_change' | 'startup'): void {
  try {
    captureRejectionGateBaselineIfChanged(db, source, countActiveMemoryItems);
  } catch (error) {
    logger.warn('rejection gate baseline capture failed', {
      source,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function applySupersedeCandidateScanSchedule(): void {
  const enabled = resolveBoolean('SUPERSEDE_CANDIDATE_SCAN_ENABLED', { defaultValue: false });
  const scheduler = getBatchScheduler();
  scheduler.updateConfig({ supersedeCandidateScanEnabled: enabled });
  const batchEnabled = resolveBoolean('BATCH_SCHEDULER_ENABLED', { defaultValue: true });
  if (!batchEnabled || !mementoConfig.batchSchedulerEnabled) {
    return;
  }
  if (enabled) {
    scheduler.restartJob('supersede_candidate_scan');
  } else {
    scheduler.stopJob('supersede_candidate_scan');
  }
}

export function wireSettingRuntimeReapply(hybridSearchEngine: HybridSearchEngine, db: Database.Database): void {
  registerSearchRejectionGateTarget(hybridSearchEngine);
  registerSettingRuntimeReapply('SEARCH_REJECTION_GATE', () => {
    applySearchRejectionGate();
    captureBaselineWithoutThrowing(db, 'setting_change');
  });
  registerSettingRuntimeReapply('SEARCH_REJECTION_GATE_THRESHOLD', () => captureBaselineWithoutThrowing(db, 'setting_change'));
  registerSettingRuntimeReapply('SUPERSEDE_CANDIDATE_SCAN_ENABLED', applySupersedeCandidateScanSchedule);
}

export function unwireSettingRuntimeReapply(): void {
  registerSearchRejectionGateTarget(null);
  unregisterSettingRuntimeReapply('SEARCH_REJECTION_GATE');
  unregisterSettingRuntimeReapply('SEARCH_REJECTION_GATE_THRESHOLD');
  unregisterSettingRuntimeReapply('SUPERSEDE_CANDIDATE_SCAN_ENABLED');
}
