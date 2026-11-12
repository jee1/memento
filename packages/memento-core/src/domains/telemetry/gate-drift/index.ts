export type { ActiveItemCounter } from './gate-drift-monitor.js';
export {
  captureRejectionGateBaselineIfChanged,
  checkRejectionGateDrift,
  recordRejectionGateDriftVerdict,
} from './gate-drift-monitor.js';
export type {
  RejectionGateBaseline,
  RejectionGateDriftSummary,
  RejectionGateDriftVerdict,
} from './types.js';
