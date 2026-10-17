import type { RelevanceGateOutcome } from '../../search/ports/relevance-gate-port.js';
import { SEARCH_QUALITY_EXTRA_KEYS } from './extra-keys.js';

export function rejectionGateTelemetryExtra(
  gate: Pick<RelevanceGateOutcome, 'verdict' | 'top_score'> | undefined,
): Record<string, string | number | null> {
  if (gate === undefined) return {};
  return {
    [SEARCH_QUALITY_EXTRA_KEYS.rejection_gate_verdict]: gate.verdict,
    [SEARCH_QUALITY_EXTRA_KEYS.rejection_gate_top_score]: gate.top_score,
  };
}
