import type {
  AgentContextInjectionBundle,
  AgentMemoryPromotionCandidate,
  AgentObservation,
  AgentSession,
  MemoryProvenance,
} from '@memento/core';
import type { InjectionBundle } from '@memento/agent-integration';

export function sessionDto(session: AgentSession) {
  return {
    id: session.id,
    adapter_name: session.adapterName,
    adapter_version: session.adapterVersion,
    contract_version: session.contractVersion,
    owner_id: session.ownerId,
    project_id: session.projectId,
    process_id: session.processId,
    status: session.status,
    started_at: session.startedAt,
    ended_at: session.endedAt,
    last_event_at: session.lastEventAt,
    max_sequence_no: session.maxSequenceNo,
    summary_memory_id: session.summaryMemoryId,
    degraded_reason: session.degradedReason,
    created_at: session.createdAt,
    updated_at: session.updatedAt,
  };
}

export function observationDto(observation: AgentObservation) {
  let redactionCount = 0;
  try {
    const metadata = JSON.parse(observation.redactionMetadataJson) as unknown;
    if (Array.isArray(metadata)) {
      redactionCount = metadata.reduce((total, item) => {
        if (
          typeof item === 'object'
          && item !== null
          && 'count' in item
          && typeof item.count === 'number'
        ) {
          return total + item.count;
        }
        return total;
      }, 0);
    }
  } catch {
    redactionCount = 0;
  }
  const eventCategory = observation.eventType === 'USER_PROMPT'
    ? 'prompt'
    : observation.eventType === 'TOOL_RESULT'
      ? observation.outcome === 'failed' || observation.outcome === 'error'
        ? 'error'
        : 'result'
      : 'lifecycle';
  return {
    id: observation.id,
    event_id: observation.eventId,
    event_type: observation.eventType,
    session_id: observation.sessionId,
    sequence_no: observation.sequenceNo,
    tool_name: observation.toolName,
    outcome: observation.outcome,
    status: observation.status,
    drop_reason: observation.dropReason,
    late_arrival: observation.lateArrival,
    occurred_at: observation.occurredAt,
    received_at: observation.receivedAt,
    expires_at: observation.expiresAt,
    event_category: eventCategory,
    redaction_count: redactionCount,
    has_payload: observation.payloadJson !== null,
  };
}

export function exportObservationDto(observation: AgentObservation) {
  return {
    ...observationDto(observation),
    payload_json: observation.payloadJson,
    payload_sha256: observation.payloadSha256,
    redaction_metadata_json: observation.redactionMetadataJson,
  };
}

export function provenanceDto(provenance: MemoryProvenance) {
  return {
    id: provenance.id,
    memory_id: provenance.memoryId,
    session_id: provenance.sessionId,
    observation_id: provenance.observationId,
    derivation_type: provenance.derivationType,
    source_deleted: provenance.sourceDeleted,
    created_at: provenance.createdAt,
  };
}

export function injectionDto(bundle: AgentContextInjectionBundle): InjectionBundle {
  return {
    bundle_version: bundle.bundleVersion,
    injection_id: bundle.injectionId,
    trigger: bundle.trigger,
    status: bundle.status,
    generated_at: bundle.generatedAt,
    query: bundle.query,
    context_text: bundle.contextText,
    items: bundle.selected.map(item => ({
      memory_id: item.id,
      content: item.content,
      memory_type: item.type,
      score: item.score,
      scope_level: item.scopeLevel,
      token_estimate: item.tokenEstimate,
      selection_reason: item.selectionReason,
    })),
    exclusions: bundle.excluded.map(item => ({
      memory_id: item.id,
      reason: item.reason,
      score: item.score,
      token_estimate: item.tokenEstimate,
      ...(item.duplicateOf ? { duplicate_of: item.duplicateOf } : {}),
    })),
    token_usage: bundle.tokenUsage,
    degraded_reasons: bundle.degradedReasons,
    ...(bundle.failureReason ? { failure_reason: bundle.failureReason } : {}),
  };
}

export function promotionCandidateDto(candidate: AgentMemoryPromotionCandidate) {
  return {
    id: candidate.id,
    session_id: candidate.sessionId,
    summary_memory_id: candidate.summaryMemoryId,
    target_type: candidate.targetType,
    category: candidate.category,
    content: candidate.content,
    confidence: candidate.confidence,
    evidence_observation_ids: candidate.evidenceObservationIds,
    merge_target_memory_id: candidate.mergeTargetMemoryId,
    status: candidate.status,
    memory_id: candidate.memoryId,
    rejection_reason: candidate.rejectionReason,
    created_at: candidate.createdAt,
    updated_at: candidate.updatedAt,
    reviewed_at: candidate.reviewedAt,
  };
}
