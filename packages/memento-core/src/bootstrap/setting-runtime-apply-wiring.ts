/**
 * #1599: 즉시 조정 키의 런타임 소비자(검색 게이트, 배치 스케줄) 재적용.
 */
import { createRelevanceGate } from '../domains/search/services/relevance-gate/create-relevance-gate.js';
import type { HybridSearchEngine } from '../domains/search/algorithms/hybrid-search-engine.js';
import { resolveBoolean } from '../shared/config/environment.js';
import { getBatchScheduler } from '../infrastructure/scheduler/batch-scheduler/batch-scheduler-singleton.js';
import { registerSettingRuntimeReapply } from '../domains/settings/setting-runtime-reapply-registry.js';

type RejectionGateTarget = Pick<HybridSearchEngine, 'setRejectionGate'>;

let rejectionGateTarget: RejectionGateTarget | null = null;

export function registerSearchRejectionGateTarget(target: RejectionGateTarget | null): void {
  rejectionGateTarget = target;
}

function applySearchRejectionGate(): void {
  rejectionGateTarget?.setRejectionGate(createRelevanceGate());
}

function applySupersedeCandidateScanSchedule(): void {
  const enabled = resolveBoolean('SUPERSEDE_CANDIDATE_SCAN_ENABLED', { defaultValue: false });
  const scheduler = getBatchScheduler();
  scheduler.updateConfig({ supersedeCandidateScanEnabled: enabled });
  if (enabled) {
    scheduler.restartJob('supersede_candidate_scan');
  } else {
    scheduler.stopJob('supersede_candidate_scan');
  }
}

export function wireSettingRuntimeReapply(hybridSearchEngine: HybridSearchEngine): void {
  registerSearchRejectionGateTarget(hybridSearchEngine);
  registerSettingRuntimeReapply('SEARCH_REJECTION_GATE', applySearchRejectionGate);
  registerSettingRuntimeReapply('SUPERSEDE_CANDIDATE_SCAN_ENABLED', applySupersedeCandidateScanSchedule);
}

export function unwireSettingRuntimeReapply(): void {
  registerSearchRejectionGateTarget(null);
}
