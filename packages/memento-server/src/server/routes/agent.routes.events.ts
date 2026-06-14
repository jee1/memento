import { AgentIntegrationError } from '@memento/core';
import type { PersistedAgentEventInput } from '@memento/core';
import {
  applySizePolicy,
  asAgentEvent,
  canonicalize,
  normalizeAgentEvent,
  redactAgentEvent,
  validateAgentEvent,
} from '@memento/agent-integration';
import type { CaptureReason } from '@memento/agent-integration';
import { statusForValidationReason } from './agent.routes.utils.js';

export function prepareEvent(input: unknown): PersistedAgentEventInput {
  let normalized;
  try {
    normalized = normalizeAgentEvent(asAgentEvent(input));
  } catch {
    throw new AgentIntegrationError(
      'Agent event normalization failed',
      'INVALID_PAYLOAD',
      400,
    );
  }
  const validation = validateAgentEvent(normalized);
  if (!validation.valid) {
    const reason = validation.reason ?? 'INVALID_ENVELOPE';
    throw new AgentIntegrationError(
      'Agent event validation failed',
      reason,
      statusForValidationReason(reason as CaptureReason),
    );
  }
  const redaction = redactAgentEvent(normalized);
  if (redaction.action === 'DROPPED') {
    const droppedHash = canonicalize({ reason: redaction.reason });
    return {
      contractVersion: normalized.contract_version,
      eventId: normalized.event_id,
      eventType: normalized.event_type,
      occurredAt: normalized.occurred_at,
      adapterName: normalized.adapter_name,
      adapterVersion: normalized.adapter_version,
      sessionId: normalized.session_id,
      sequenceNo: normalized.sequence_no,
      scope: {
        ownerId: normalized.scope.owner_id,
        projectId: normalized.scope.project_id,
        processId: normalized.scope.process_id,
      },
      payloadJson: null,
      payloadSha256: droppedHash.sha256,
      redactionMetadataJson: JSON.stringify(redaction.metadata),
      captureStatus: 'DROPPED',
      dropReason: redaction.reason,
    };
  }
  const sized = applySizePolicy(redaction.event);
  if (sized.action === 'DROPPED') {
    const droppedHash = canonicalize({ reason: sized.reason });
    return {
      contractVersion: normalized.contract_version,
      eventId: normalized.event_id,
      eventType: normalized.event_type,
      occurredAt: normalized.occurred_at,
      adapterName: normalized.adapter_name,
      adapterVersion: normalized.adapter_version,
      sessionId: normalized.session_id,
      sequenceNo: normalized.sequence_no,
      scope: {
        ownerId: normalized.scope.owner_id,
        projectId: normalized.scope.project_id,
        processId: normalized.scope.process_id,
      },
      payloadJson: null,
      payloadSha256: droppedHash.sha256,
      redactionMetadataJson: JSON.stringify(redaction.metadata),
      captureStatus: 'DROPPED',
      dropReason: sized.reason,
    };
  }
  const payload = sized.event.payload as unknown as Record<string, unknown>;
  const canonicalPayload = canonicalize(payload);

  return {
    contractVersion: sized.event.contract_version,
    eventId: sized.event.event_id,
    eventType: sized.event.event_type,
    occurredAt: sized.event.occurred_at,
    adapterName: sized.event.adapter_name,
    adapterVersion: sized.event.adapter_version,
    sessionId: sized.event.session_id,
    sequenceNo: sized.event.sequence_no,
    scope: {
      ownerId: sized.event.scope.owner_id,
      projectId: sized.event.scope.project_id,
      processId: sized.event.scope.process_id,
    },
    payloadJson: canonicalPayload.json,
    payloadSha256: canonicalPayload.sha256,
    redactionMetadataJson: JSON.stringify(redaction.metadata),
    captureStatus: redaction.action === 'REDACTED' ? 'REDACTED' : 'ACCEPTED',
    toolName: typeof payload.tool_name === 'string' ? payload.tool_name : undefined,
    outcome: typeof payload.outcome === 'string' ? payload.outcome : undefined,
  };
}
