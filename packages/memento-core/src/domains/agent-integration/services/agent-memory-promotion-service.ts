import { createHash, randomUUID } from 'node:crypto';
import type { AgentIntegrationRepository } from '../repositories/agent-integration-repository.js';
import type {
  AgentMemoryPromotionCandidate,
  AgentMemoryPromotionCategory,
  AgentMemoryPromotionTargetType,
  AgentObservation,
} from '../types.js';

interface ExtractedPromotion {
  targetType: AgentMemoryPromotionTargetType;
  category: AgentMemoryPromotionCategory;
  content: string;
  confidence: number;
  observationId: string;
}

interface AggregatedPromotion extends Omit<ExtractedPromotion, 'observationId'> {
  observationIds: string[];
}

export type AgentMemoryPromotionTelemetryEvent =
  | {
      action: 'extracted';
      sessionId: string;
      candidateCount: number;
      existingCount: number;
    }
  | {
      action: 'approved';
      candidateId: string;
      memoryId: string;
      mergeSuggested: boolean;
    }
  | {
      action: 'rejected';
      candidateId: string;
      reason: string;
    }
  | {
      action: 'usage';
      memoryId: string;
      usageOutcome: 'used' | 'unused' | 'negative';
    };

export interface AgentMemoryPromotionServiceOptions {
  now?: () => Date;
  recordTelemetry?: (event: AgentMemoryPromotionTelemetryEvent) => void;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeContent(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

function extractFromPayload(
  payload: Record<string, unknown>,
  observationId: string,
): ExtractedPromotion[] {
  const extracted: ExtractedPromotion[] = [];
  const decision = readString(payload.decision);
  if (decision) {
    extracted.push({
      targetType: 'semantic',
      category: 'decision',
      content: decision,
      confidence: 0.85,
      observationId,
    });
  }

  const error = readString(payload.error);
  const resolution = readString(payload.resolution) ?? readString(payload.fix);
  if (error && resolution) {
    extracted.push({
      targetType: 'semantic',
      category: 'error_resolution',
      content: `Error: ${error}\nResolution: ${resolution}`,
      confidence: 0.9,
      observationId,
    });
  }

  const procedure = readString(payload.procedure);
  const steps = Array.isArray(payload.steps)
    ? payload.steps.map(readString).filter((step): step is string => step !== null)
    : [];
  if (steps.length >= 2) {
    extracted.push({
      targetType: 'procedural',
      category: 'procedure',
      content: [
        procedure ?? 'Reusable procedure',
        ...steps.map((step, index) => `${index + 1}. ${step}`),
      ].join('\n'),
      confidence: 0.9,
      observationId,
    });
  }
  return extracted;
}

function extractFromObservation(observation: AgentObservation): ExtractedPromotion[] {
  if (!observation.payloadJson || !['ACCEPTED', 'REDACTED'].includes(observation.status)) {
    return [];
  }
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(observation.payloadJson) as Record<string, unknown>;
  } catch {
    return [];
  }
  const records = [payload, payload.output, payload.extensions]
    .filter((value): value is Record<string, unknown> =>
      typeof value === 'object' && value !== null && !Array.isArray(value));
  return records.flatMap(record => extractFromPayload(record, observation.id));
}

function fingerprintPromotion(
  summaryMemoryId: string,
  promotion: AggregatedPromotion,
): string {
  return createHash('sha256').update(JSON.stringify([
    summaryMemoryId,
    promotion.targetType,
    promotion.category,
    normalizeContent(promotion.content),
  ])).digest('hex');
}

function aggregatePromotions(promotions: ExtractedPromotion[]): AggregatedPromotion[] {
  const aggregated = new Map<string, AggregatedPromotion>();
  for (const promotion of promotions) {
    const key = JSON.stringify([
      promotion.targetType,
      promotion.category,
      normalizeContent(promotion.content),
    ]);
    const existing = aggregated.get(key);
    if (existing) {
      aggregated.set(key, {
        ...existing,
        confidence: Math.min(0.95, existing.confidence + 0.05),
        observationIds: [...existing.observationIds, promotion.observationId],
      });
      continue;
    }
    aggregated.set(key, {
      targetType: promotion.targetType,
      category: promotion.category,
      content: promotion.content,
      confidence: promotion.confidence,
      observationIds: [promotion.observationId],
    });
  }
  return [...aggregated.values()];
}

export class AgentMemoryPromotionService {
  private readonly now: () => Date;
  private readonly recordTelemetry: (event: AgentMemoryPromotionTelemetryEvent) => void;

  constructor(
    private readonly repository: AgentIntegrationRepository,
    options: AgentMemoryPromotionServiceOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.recordTelemetry = options.recordTelemetry ?? (() => undefined);
  }

  extractCandidates(sessionId: string): { created: number; existing: number } {
    const session = this.repository.getSession(sessionId);
    if (!session) throw new Error(`Agent session not found: ${sessionId}`);
    if (!session.summaryMemoryId) {
      throw new Error(`Agent session summary is required before promotion: ${sessionId}`);
    }
    const promotions = aggregatePromotions(
      this.repository.listAllObservations(sessionId).flatMap(extractFromObservation),
    );
    let created = 0;
    let existing = 0;
    const createdAt = this.now().toISOString();
    for (const promotion of promotions) {
      const fingerprint = fingerprintPromotion(session.summaryMemoryId, promotion);
      if (this.repository.findPromotionCandidateByFingerprint(fingerprint)) {
        existing += 1;
        continue;
      }
      const mergeTargetMemoryId = this.repository.findScopedMemoryByContent({
        targetType: promotion.targetType,
        content: promotion.content,
        ownerId: session.ownerId,
        projectId: session.projectId,
        processId: session.processId,
      });
      this.repository.createPromotionCandidate({
        id: randomUUID(),
        fingerprint,
        sessionId,
        summaryMemoryId: session.summaryMemoryId,
        targetType: promotion.targetType,
        category: promotion.category,
        content: promotion.content,
        confidence: promotion.confidence,
        evidenceObservationIds: promotion.observationIds,
        mergeTargetMemoryId,
        createdAt,
      });
      created += 1;
    }
    this.safeRecordTelemetry({
      action: 'extracted',
      sessionId,
      candidateCount: created,
      existingCount: existing,
    });
    return { created, existing };
  }

  listCandidates(query: {
    sessionId?: string;
    status?: AgentMemoryPromotionCandidate['status'];
  } = {}): AgentMemoryPromotionCandidate[] {
    return this.repository.listPromotionCandidates(query);
  }

  approveCandidate(candidateId: string): AgentMemoryPromotionCandidate {
    const existing = this.repository.listPromotionCandidates()
      .find(candidate => candidate.id === candidateId);
    if (!existing) throw new Error(`Agent memory promotion candidate not found: ${candidateId}`);
    const approved = this.repository.approvePromotionCandidate(
      candidateId,
      existing.memoryId ?? existing.mergeTargetMemoryId ?? randomUUID(),
      this.now().toISOString(),
    );
    if (existing.status === 'pending' && approved.memoryId) {
      this.safeRecordTelemetry({
        action: 'approved',
        candidateId,
        memoryId: approved.memoryId,
        mergeSuggested: approved.mergeTargetMemoryId !== null,
      });
    }
    return approved;
  }

  rejectCandidate(candidateId: string, reason: string): AgentMemoryPromotionCandidate {
    const existing = this.repository.listPromotionCandidates()
      .find(candidate => candidate.id === candidateId);
    if (!existing) throw new Error(`Agent memory promotion candidate not found: ${candidateId}`);
    const rejected = this.repository.rejectPromotionCandidate(
      candidateId,
      reason,
      this.now().toISOString(),
    );
    if (existing.status === 'pending') {
      this.safeRecordTelemetry({ action: 'rejected', candidateId, reason });
    }
    return rejected;
  }

  recordUsage(memoryId: string, usageOutcome: 'used' | 'unused' | 'negative'): void {
    this.safeRecordTelemetry({ action: 'usage', memoryId, usageOutcome });
  }

  private safeRecordTelemetry(event: AgentMemoryPromotionTelemetryEvent): void {
    try {
      this.recordTelemetry(event);
    } catch {
      // Telemetry must not change candidate review or persistence semantics.
    }
  }
}
