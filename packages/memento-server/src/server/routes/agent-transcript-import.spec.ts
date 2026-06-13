import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AgentIntegrationError,
  AgentIntegrationSchemaMigration,
  AgentLifecycleService,
  SqliteAgentIntegrationRepository,
  type PersistedAgentEventInput,
} from '@memento/core';
import {
  AgentTranscriptImportError,
  AgentTranscriptImporter,
} from './agent-transcript-import.js';

function rawEvent(overrides: Record<string, unknown> = {}) {
  return {
    event_id: 'evt-start',
    event_type: 'SESSION_START',
    session_id: 'session-1',
    sequence_no: 0,
    payload_sha256: 'a'.repeat(64),
    ...overrides,
  };
}

function preparedEvent(input: unknown): PersistedAgentEventInput {
  const event = input as ReturnType<typeof rawEvent>;
  if (event.event_type === 'INVALID') {
    throw new AgentIntegrationError('secret payload must not escape', 'INVALID_PAYLOAD', 400);
  }
  return {
    contractVersion: 1,
    eventId: String(event.event_id),
    eventType: event.event_type as PersistedAgentEventInput['eventType'],
    occurredAt: '2026-06-07T00:00:00.000Z',
    adapterName: 'codex',
    adapterVersion: '1.0.0',
    sessionId: String(event.session_id),
    sequenceNo: Number(event.sequence_no),
    scope: {
      ownerId: 'owner-1',
      projectId: 'project-1',
      processId: 'issue-460',
    },
    payloadJson: '{}',
    payloadSha256: String(event.payload_sha256),
    redactionMetadataJson: '{}',
    captureStatus: 'ACCEPTED',
  };
}

function jsonl(...events: unknown[]): string {
  return events.map(event => JSON.stringify(event)).join('\n');
}

describe('AgentTranscriptImporter', () => {
  let db: Database.Database;
  let repository: SqliteAgentIntegrationRepository;
  let lifecycleService: AgentLifecycleService;

  beforeEach(async () => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec('CREATE TABLE memory_item (id TEXT PRIMARY KEY)');
    await new AgentIntegrationSchemaMigration().up(db);
    repository = new SqliteAgentIntegrationRepository(db);
    lifecycleService = new AgentLifecycleService(repository, {
      now: () => new Date('2026-06-07T00:00:10.000Z'),
    });
  });

  afterEach(() => {
    db.close();
  });

  function importer(
    service: Pick<AgentLifecycleService, 'capture'> = lifecycleService,
    prepare = preparedEvent,
  ) {
    return new AgentTranscriptImporter({
      prepareEvent: prepare,
      lifecycleService: service,
      repository,
    });
  }

  it('defaults to dry-run and performs no writes', () => {
    const result = importer().import({
      transcript: jsonl(
        rawEvent(),
        rawEvent({
          event_id: 'evt-prompt',
          event_type: 'USER_PROMPT',
          sequence_no: 1,
          payload_sha256: 'b'.repeat(64),
        }),
      ),
    });

    expect(result).toMatchObject({
      dryRun: true,
      sessionId: 'session-1',
      total: 2,
      accepted: 2,
      duplicates: 0,
    });
    expect(repository.getSession('session-1')).toBeNull();
    expect(repository.countObservations('session-1')).toBe(0);
  });

  it('validates every line before invoking capture', () => {
    const capture = vi.fn(lifecycleService.capture.bind(lifecycleService));
    const transcript = [
      JSON.stringify(rawEvent()),
      JSON.stringify(rawEvent({
        event_id: 'evt-invalid',
        event_type: 'INVALID',
        sequence_no: 1,
        secret: 'do-not-reflect',
      })),
    ].join('\n');

    expect(() => importer({ capture }).import({
      transcript,
      dryRun: false,
    })).toThrowError(expect.objectContaining({
      reasonCode: 'INVALID_PAYLOAD',
      line: 2,
    }));
    expect(capture).not.toHaveBeenCalled();
    expect(repository.getSession('session-1')).toBeNull();
  });

  it('rejects malformed JSON without reflecting the source line', () => {
    const secret = 'private-key-material-do-not-reflect';

    expect(() => importer().import({
      transcript: `${JSON.stringify(rawEvent())}\n{"secret":"${secret}"`,
    })).toThrowError(expect.objectContaining({
      reasonCode: 'INVALID_PAYLOAD',
      line: 2,
    }));

    try {
      importer().import({ transcript: `{"secret":"${secret}"` });
    } catch (error) {
      expect(String(error)).not.toContain(secret);
      expect(error).toBeInstanceOf(AgentTranscriptImportError);
    }
  });

  it('detects transcript duplicates and conflicts before writes', () => {
    const duplicate = rawEvent();
    const duplicateResult = importer().import({
      transcript: jsonl(duplicate, duplicate),
    });

    expect(duplicateResult).toMatchObject({
      accepted: 1,
      duplicates: 1,
    });
    expect(duplicateResult.lines[1]).toMatchObject({
      line: 2,
      eventId: 'evt-start',
      status: 'DUPLICATE',
    });

    expect(() => importer().import({
      transcript: jsonl(
        duplicate,
        rawEvent({ payload_sha256: 'b'.repeat(64) }),
      ),
      dryRun: false,
    })).toThrowError(expect.objectContaining({
      reasonCode: 'IDEMPOTENCY_CONFLICT',
      line: 2,
    }));
    expect(repository.getSession('session-1')).toBeNull();
  });

  it('detects database duplicates and conflicts before commit', () => {
    lifecycleService.capture(preparedEvent(rawEvent()));

    const duplicateResult = importer().import({
      transcript: jsonl(rawEvent()),
    });
    expect(duplicateResult).toMatchObject({
      accepted: 0,
      duplicates: 1,
    });

    expect(() => importer().import({
      transcript: jsonl(rawEvent({ payload_sha256: 'b'.repeat(64) })),
      dryRun: false,
    })).toThrowError(expect.objectContaining({
      reasonCode: 'IDEMPOTENCY_CONFLICT',
      line: 1,
    }));
    expect(repository.countObservations('session-1')).toBe(1);
  });

  it('requires one stable session identity and ordered lifecycle events', () => {
    expect(() => importer().import({
      transcript: jsonl(
        rawEvent(),
        rawEvent({
          event_id: 'evt-other',
          event_type: 'USER_PROMPT',
          session_id: 'session-2',
          sequence_no: 1,
          payload_sha256: 'b'.repeat(64),
        }),
      ),
    })).toThrowError(expect.objectContaining({
      reasonCode: 'INVALID_SESSION_STATE',
      line: 2,
    }));

    expect(() => importer().import({
      transcript: jsonl(
        rawEvent({
          event_id: 'evt-prompt',
          event_type: 'USER_PROMPT',
          sequence_no: 1,
        }),
      ),
    })).toThrowError(expect.objectContaining({
      reasonCode: 'SESSION_NOT_STARTED',
      line: 1,
    }));

    expect(() => importer().import({
      transcript: jsonl(
        rawEvent(),
        rawEvent({
          event_id: 'evt-stop',
          event_type: 'STOP',
          sequence_no: 2,
          payload_sha256: 'b'.repeat(64),
        }),
        rawEvent({
          event_id: 'evt-after-stop',
          event_type: 'TOOL_RESULT',
          sequence_no: 3,
          payload_sha256: 'c'.repeat(64),
        }),
      ),
    })).toThrowError(expect.objectContaining({
      reasonCode: 'INVALID_SESSION_STATE',
      line: 3,
    }));
  });

  it('commits all prepared events in one repository transaction', () => {
    const result = importer().import({
      transcript: jsonl(
        rawEvent(),
        rawEvent({
          event_id: 'evt-prompt',
          event_type: 'USER_PROMPT',
          sequence_no: 1,
          payload_sha256: 'b'.repeat(64),
        }),
      ),
      dryRun: false,
    });

    expect(result).toMatchObject({
      dryRun: false,
      accepted: 2,
      duplicates: 0,
    });
    expect(repository.getSession('session-1')).toMatchObject({
      maxSequenceNo: 1,
    });
    expect(repository.countObservations('session-1')).toBe(2);
  });

  it('rolls back every write when capture fails during commit', () => {
    let calls = 0;
    const capture = vi.fn((event: PersistedAgentEventInput) => {
      calls += 1;
      if (calls === 2) {
        throw new Error('forced commit failure');
      }
      return lifecycleService.capture(event);
    });

    expect(() => importer({ capture }).import({
      transcript: jsonl(
        rawEvent(),
        rawEvent({
          event_id: 'evt-prompt',
          event_type: 'USER_PROMPT',
          sequence_no: 1,
          payload_sha256: 'b'.repeat(64),
        }),
      ),
      dryRun: false,
    })).toThrowError(expect.objectContaining({
      reasonCode: 'INTERNAL_ERROR',
    }));

    expect(repository.getSession('session-1')).toBeNull();
    expect(repository.countObservations('session-1')).toBe(0);
  });
});
