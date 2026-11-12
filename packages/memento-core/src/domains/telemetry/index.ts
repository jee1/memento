export { TelemetryService } from './services/telemetry-service.js';

export type {
  EventType,
  Outcome,
  TelemetryPeriod,
  TelemetryEventInput,
  TelemetryEventRow,
  TelemetryEventQueryFilters,
} from './types/telemetry.types.js';

export { AuditHashChainService } from './services/audit-hash-chain-service.js';
export type {
  AuditAction,
  AuditLogInput,
  AuditLogRecord,
  AuditMode,
  AuditTransport,
} from './services/audit-hash-chain-service.js';

export {
  recallOutcomeStageExtra,
  rejectionGateTelemetryExtra,
} from './search-quality/index.js';

export {
  captureRejectionGateBaselineIfChanged,
  checkRejectionGateDrift,
  recordRejectionGateDriftVerdict,
} from './gate-drift/index.js';
export type {
  ActiveItemCounter,
  RejectionGateBaseline,
  RejectionGateDriftSummary,
  RejectionGateDriftVerdict,
} from './gate-drift/index.js';
