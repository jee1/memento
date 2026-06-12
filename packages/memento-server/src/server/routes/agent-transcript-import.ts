import {
  AgentIntegrationError,
  type AgentCaptureStatus,
  type AgentIntegrationReasonCode,
  type AgentObservation,
  type AgentSession,
  type CaptureResult,
  type PersistedAgentEventInput,
} from '@memento/core';

interface TranscriptRepository {
  runInTransaction<T>(operation: () => T): T;
  getSession(id: string): AgentSession | null;
  findObservationByIdempotencyKey(
    adapterName: string,
    eventId: string,
  ): AgentObservation | null;
}

interface TranscriptLifecycleService {
  capture(event: PersistedAgentEventInput): CaptureResult;
}

export interface AgentTranscriptImporterDependencies {
  prepareEvent(input: unknown): PersistedAgentEventInput;
  lifecycleService: TranscriptLifecycleService;
  repository: TranscriptRepository;
}

export interface AgentTranscriptImportInput {
  transcript: unknown;
  dryRun?: boolean;
}

export interface AgentTranscriptImportLineResult {
  line: number;
  eventId: string;
  status: AgentCaptureStatus;
  reasonCode: string;
  observationId?: string;
  lateArrival: boolean;
}

export interface AgentTranscriptImportResult {
  dryRun: boolean;
  sessionId: string;
  total: number;
  accepted: number;
  duplicates: number;
  redacted: number;
  dropped: number;
  lines: AgentTranscriptImportLineResult[];
}

export class AgentTranscriptImportError extends AgentIntegrationError {
  constructor(
    message: string,
    reasonCode: AgentIntegrationReasonCode,
    httpStatus: number,
    readonly line?: number,
    retryable = false,
  ) {
    super(message, reasonCode, httpStatus, retryable);
    this.name = 'AgentTranscriptImportError';
  }
}

interface PreparedLine {
  line: number;
  event: PersistedAgentEventInput;
  duplicate: boolean;
}

interface SessionIdentity {
  adapterName: string;
  adapterVersion: string;
  contractVersion: number;
  ownerId: string | null;
  projectId: string | null;
  processId: string | null;
}

function safeError(
  message: string,
  reasonCode: AgentIntegrationReasonCode,
  httpStatus: number,
  line?: number,
  retryable = false,
): AgentTranscriptImportError {
  return new AgentTranscriptImportError(
    message,
    reasonCode,
    httpStatus,
    line,
    retryable,
  );
}

function identityOf(event: PersistedAgentEventInput): SessionIdentity {
  return {
    adapterName: event.adapterName,
    adapterVersion: event.adapterVersion,
    contractVersion: event.contractVersion,
    ownerId: event.scope.ownerId ?? null,
    projectId: event.scope.projectId ?? null,
    processId: event.scope.processId ?? null,
  };
}

function identityOfSession(session: AgentSession): SessionIdentity {
  return {
    adapterName: session.adapterName,
    adapterVersion: session.adapterVersion,
    contractVersion: session.contractVersion,
    ownerId: session.ownerId,
    projectId: session.projectId,
    processId: session.processId,
  };
}

function sameIdentity(left: SessionIdentity, right: SessionIdentity): boolean {
  return left.adapterName === right.adapterName
    && left.adapterVersion === right.adapterVersion
    && left.contractVersion === right.contractVersion
    && left.ownerId === right.ownerId
    && left.projectId === right.projectId
    && left.processId === right.processId;
}

function plannedLineResult(line: PreparedLine): AgentTranscriptImportLineResult {
  return {
    line: line.line,
    eventId: line.event.eventId,
    status: line.duplicate ? 'DUPLICATE' : line.event.captureStatus,
    reasonCode: line.duplicate ? 'NONE' : line.event.dropReason ?? 'NONE',
    lateArrival: false,
  };
}

export class AgentTranscriptImporter {
  constructor(private readonly dependencies: AgentTranscriptImporterDependencies) {}

  import(input: AgentTranscriptImportInput): AgentTranscriptImportResult {
    const dryRun = input.dryRun ?? true;
    if (typeof dryRun !== 'boolean') {
      throw safeError('Transcript dry-run flag is invalid', 'INVALID_ENVELOPE', 400);
    }

    const prepared = this.prepare(input.transcript);
    const plannedLines = prepared.map(plannedLineResult);
    if (dryRun) {
      return this.result(true, prepared, plannedLines);
    }

    const committedLines = this.commit(prepared);
    return this.result(false, prepared, committedLines);
  }

  private prepare(transcript: unknown): PreparedLine[] {
    if (typeof transcript !== 'string') {
      throw safeError('Transcript must be a JSONL string', 'INVALID_ENVELOPE', 400);
    }

    const parsed = transcript
      .split(/\r?\n/u)
      .map((source, index) => ({ source, line: index + 1 }))
      .filter(item => item.source.trim() !== '')
      .map(({ source, line }) => {
        try {
          return { value: JSON.parse(source) as unknown, line };
        } catch {
          throw safeError('Transcript contains malformed JSON', 'INVALID_PAYLOAD', 400, line);
        }
      });

    if (parsed.length === 0) {
      throw safeError('Transcript contains no events', 'INVALID_ENVELOPE', 400);
    }

    const prepared = parsed.map(({ value, line }) => {
      try {
        return {
          line,
          event: this.dependencies.prepareEvent(value),
          duplicate: false,
        };
      } catch (error) {
        if (error instanceof AgentIntegrationError) {
          throw safeError(
            'Transcript event validation failed',
            error.reasonCode,
            error.httpStatus,
            line,
            error.retryable,
          );
        }
        throw safeError('Transcript event validation failed', 'INVALID_PAYLOAD', 400, line);
      }
    });

    this.validate(prepared);
    return prepared;
  }

  private validate(lines: PreparedLine[]): void {
    const sessionId = lines[0]!.event.sessionId;
    const expectedIdentity = identityOf(lines[0]!.event);
    const existingSession = this.dependencies.repository.getSession(sessionId);
    const seen = new Map<string, { payloadSha256: string; line: number }>();
    let started = existingSession !== null;
    let terminal = existingSession?.status === 'COMPLETED'
      || existingSession?.status === 'DEGRADED'
      || existingSession?.status === 'ABANDONED';
    let previousSequence = existingSession?.maxSequenceNo ?? -1;

    if (
      existingSession
      && !sameIdentity(expectedIdentity, identityOfSession(existingSession))
    ) {
      throw safeError(
        'Transcript session identity does not match the stored session',
        'INVALID_SESSION_STATE',
        409,
        lines[0]!.line,
      );
    }

    for (const line of lines) {
      const { event } = line;
      if (event.sessionId !== sessionId || !sameIdentity(identityOf(event), expectedIdentity)) {
        throw safeError(
          'Transcript events must share one session identity',
          'INVALID_SESSION_STATE',
          409,
          line.line,
        );
      }

      const key = `${event.adapterName}\u0000${event.eventId}`;
      const earlier = seen.get(key);
      if (earlier) {
        if (earlier.payloadSha256 !== event.payloadSha256) {
          throw safeError(
            'Transcript contains an idempotency conflict',
            'IDEMPOTENCY_CONFLICT',
            409,
            line.line,
          );
        }
        line.duplicate = true;
        continue;
      }
      seen.set(key, { payloadSha256: event.payloadSha256, line: line.line });

      const stored = this.dependencies.repository.findObservationByIdempotencyKey(
        event.adapterName,
        event.eventId,
      );
      if (stored) {
        if (stored.payloadSha256 !== event.payloadSha256) {
          throw safeError(
            'Transcript conflicts with an existing event',
            'IDEMPOTENCY_CONFLICT',
            409,
            line.line,
          );
        }
        line.duplicate = true;
        continue;
      }

      if (!started) {
        if (event.eventType !== 'SESSION_START') {
          throw safeError(
            'Transcript session has not been started',
            'SESSION_NOT_STARTED',
            404,
            line.line,
          );
        }
        started = true;
      } else if (event.eventType === 'SESSION_START') {
        throw safeError(
          'Transcript contains an invalid session start',
          'INVALID_SESSION_STATE',
          409,
          line.line,
        );
      }

      if (terminal) {
        throw safeError(
          'Transcript contains an event after session termination',
          'INVALID_SESSION_STATE',
          409,
          line.line,
        );
      }
      if (event.sequenceNo < previousSequence) {
        throw safeError(
          'Transcript event sequence is out of order',
          'INVALID_SESSION_STATE',
          409,
          line.line,
        );
      }

      previousSequence = event.sequenceNo;
      terminal = event.eventType === 'STOP';
    }
  }

  private commit(lines: PreparedLine[]): AgentTranscriptImportLineResult[] {
    try {
      return this.dependencies.repository.runInTransaction(() =>
        lines.map((line) => {
          if (line.duplicate) return plannedLineResult(line);
          try {
            const captured = this.dependencies.lifecycleService.capture(line.event);
            return {
              line: line.line,
              eventId: captured.eventId,
              status: captured.status,
              reasonCode: captured.reasonCode,
              observationId: captured.observationId,
              lateArrival: captured.lateArrival,
            };
          } catch (error) {
            if (error instanceof AgentIntegrationError) {
              throw safeError(
                'Transcript commit failed',
                error.reasonCode,
                error.httpStatus,
                line.line,
                error.retryable,
              );
            }
            throw safeError('Transcript commit failed', 'INTERNAL_ERROR', 500, line.line);
          }
        }),
      );
    } catch (error) {
      if (error instanceof AgentTranscriptImportError) throw error;
      throw safeError('Transcript commit failed', 'INTERNAL_ERROR', 500);
    }
  }

  private result(
    dryRun: boolean,
    prepared: PreparedLine[],
    lines: AgentTranscriptImportLineResult[],
  ): AgentTranscriptImportResult {
    return {
      dryRun,
      sessionId: prepared[0]!.event.sessionId,
      total: prepared.length,
      accepted: lines.filter(line =>
        line.status !== 'DUPLICATE'
        && line.status !== 'DROPPED'
        && line.status !== 'INVALID').length,
      duplicates: lines.filter(line => line.status === 'DUPLICATE').length,
      redacted: lines.filter(line => line.status === 'REDACTED').length,
      dropped: lines.filter(line => line.status === 'DROPPED').length,
      lines,
    };
  }
}
