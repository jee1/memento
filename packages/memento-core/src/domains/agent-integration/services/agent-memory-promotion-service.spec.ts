import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AgentIntegrationSchemaMigration } from '../../../infrastructure/database/sqlite/migration/migrations/035-agent-integration-schema.js';
import { AgentMemoryPromotionSchemaMigration } from '../../../infrastructure/database/sqlite/migration/migrations/036-agent-memory-promotion-schema.js';
import { SqliteAgentIntegrationRepository } from '../../../infrastructure/database/repositories/sqlite-agent-integration-repository.js';
import type { PersistedAgentEventInput } from '../types.js';
import {
  AgentMemoryPromotionService,
  type AgentMemoryPromotionTelemetryEvent,
} from './agent-memory-promotion-service.js';
import { AgentSessionSummaryService } from './agent-session-summary-service.js';

const startEvent: PersistedAgentEventInput = {
  contractVersion: 1,
  eventId: 'evt-start',
  eventType: 'SESSION_START',
  occurredAt: '2026-06-07T00:00:00.000Z',
  adapterName: 'codex',
  adapterVersion: '1.0.0',
  sessionId: 'session-465',
  sequenceNo: 0,
  scope: { ownerId: 'owner-1', projectId: 'project-1', processId: 'issue-465' },
  payloadJson: '{"client_version":"1.0.0"}',
  payloadSha256: 'a'.repeat(64),
  redactionMetadataJson: '{}',
  captureStatus: 'ACCEPTED',
};

describe('AgentMemoryPromotionService', () => {
  let db: Database.Database;
  let repository: SqliteAgentIntegrationRepository;
  let telemetry: AgentMemoryPromotionTelemetryEvent[];
  let service: AgentMemoryPromotionService;

  beforeEach(async () => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec(`
      CREATE TABLE memory_item (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        content TEXT NOT NULL,
        importance REAL DEFAULT 0.5,
        privacy_scope TEXT DEFAULT 'private',
        tags TEXT,
        source TEXT,
        origin_source TEXT,
        owner_id TEXT,
        process_id TEXT,
        session_id TEXT,
        project_id TEXT,
        source_session_id TEXT,
        confidence REAL,
        task_goal TEXT,
        steps TEXT,
        created_at TEXT
      );
      CREATE TABLE memory_link (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_id TEXT NOT NULL,
        target_id TEXT NOT NULL,
        relation_type TEXT NOT NULL,
        created_at TEXT,
        UNIQUE(source_id, target_id, relation_type)
      );
    `);
    await new AgentIntegrationSchemaMigration().up(db);
    await new AgentMemoryPromotionSchemaMigration().up(db);
    repository = new SqliteAgentIntegrationRepository(db);
    telemetry = [];
    service = new AgentMemoryPromotionService(repository, {
      now: () => new Date('2026-06-07T00:01:00.000Z'),
      recordTelemetry: event => telemetry.push(event),
    });
    repository.createSession(startEvent, '2026-06-07T00:00:00.100Z');
    repository.createObservation({
      ...startEvent,
      id: 'observation-start',
      lateArrival: false,
      receivedAt: '2026-06-07T00:00:00.100Z',
      expiresAt: null,
    });
  });

  afterEach(() => db.close());

  function addObservation(
    id: string,
    payload: Record<string, unknown>,
    sequenceNo: number,
  ): void {
    repository.createObservation({
      ...startEvent,
      id,
      eventId: `evt-${id}`,
      eventType: 'TOOL_RESULT',
      sequenceNo,
      toolName: 'exec_command',
      outcome: 'success',
      payloadJson: JSON.stringify(payload),
      payloadSha256: id.padEnd(64, '0').slice(0, 64),
      lateArrival: false,
      receivedAt: `2026-06-07T00:00:0${sequenceNo}.100Z`,
      expiresAt: null,
    });
  }

  function finishAndSummarize(): string {
    repository.updateSession(
      startEvent.sessionId,
      { status: 'COMPLETED', endedAt: '2026-06-07T00:00:10.000Z' },
      '2026-06-07T00:00:10.000Z',
    );
    return new AgentSessionSummaryService(repository, {
      now: () => new Date('2026-06-07T00:00:11.000Z'),
    }).summarize(startEvent.sessionId).memoryId!;
  }

  it('extracts review-only decision, error-resolution, and procedure candidates with confidence', () => {
    addObservation('observation-decision', {
      decision: 'Use bounded exponential retry for transient API failures.',
    }, 1);
    addObservation('observation-resolution', {
      error: 'SQLite busy errors during concurrent writes',
      resolution: 'Set a bounded busy timeout and retry only SQLITE_BUSY.',
    }, 2);
    addObservation('observation-procedure', {
      procedure: 'Release verification',
      steps: ['Run targeted tests', 'Run lint and type-check', 'Inspect security scan'],
    }, 3);
    const summaryMemoryId = finishAndSummarize();

    const result = service.extractCandidates(startEvent.sessionId);
    const candidates = service.listCandidates({ sessionId: startEvent.sessionId });

    expect(result).toEqual({ created: 3, existing: 0 });
    expect(candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        category: 'decision',
        targetType: 'semantic',
        status: 'pending',
        confidence: 0.85,
        summaryMemoryId,
      }),
      expect.objectContaining({
        category: 'error_resolution',
        targetType: 'semantic',
        status: 'pending',
        confidence: 0.9,
      }),
      expect.objectContaining({
        category: 'procedure',
        targetType: 'procedural',
        status: 'pending',
        confidence: 0.9,
      }),
    ]));
    expect(db.prepare('SELECT COUNT(*) AS count FROM memory_item').get()).toEqual({ count: 1 });
    expect(telemetry).toContainEqual(expect.objectContaining({
      action: 'extracted',
      candidateCount: 3,
    }));
  });

  it('is idempotent for the same evidence and suggests merging exact scoped duplicates', () => {
    addObservation('observation-decision', {
      decision: 'Use bounded exponential retry for transient API failures.',
    }, 1);
    finishAndSummarize();
    db.prepare(`
      INSERT INTO memory_item (
        id, type, content, privacy_scope, owner_id, project_id, process_id, created_at
      ) VALUES (?, 'semantic', ?, 'private', 'owner-1', 'project-1', 'issue-465', ?)
    `).run(
      'existing-semantic',
      'Use bounded exponential retry for transient API failures.',
      '2026-06-06T00:00:00.000Z',
    );

    expect(service.extractCandidates(startEvent.sessionId)).toEqual({ created: 1, existing: 0 });
    expect(service.extractCandidates(startEvent.sessionId)).toEqual({ created: 0, existing: 1 });
    expect(service.listCandidates({ sessionId: startEvent.sessionId })).toEqual([
      expect.objectContaining({ mergeTargetMemoryId: 'existing-semantic' }),
    ]);
  });

  it('aggregates repeated evidence into one candidate with all source observations', () => {
    addObservation('observation-decision-1', {
      decision: 'Use bounded exponential retry for transient API failures.',
    }, 1);
    addObservation('observation-decision-2', {
      decision: 'Use bounded exponential retry for transient API failures.',
    }, 2);
    finishAndSummarize();

    expect(service.extractCandidates(startEvent.sessionId)).toEqual({ created: 1, existing: 0 });
    expect(service.listCandidates({ sessionId: startEvent.sessionId })).toEqual([
      expect.objectContaining({
        category: 'decision',
        confidence: 0.9,
        evidenceObservationIds: [
          'observation-decision-1',
          'observation-decision-2',
        ],
      }),
    ]);
  });

  it('reuses an approved merge target instead of creating a duplicate memory', () => {
    addObservation('observation-decision', {
      decision: 'Use bounded exponential retry for transient API failures.',
    }, 1);
    const summaryMemoryId = finishAndSummarize();
    db.prepare(`
      INSERT INTO memory_item (
        id, type, content, privacy_scope, owner_id, project_id, process_id, created_at
      ) VALUES (?, 'semantic', ?, 'private', 'owner-1', 'project-1', 'issue-465', ?)
    `).run(
      'existing-semantic',
      'Use bounded exponential retry for transient API failures.',
      '2026-06-06T00:00:00.000Z',
    );
    service.extractCandidates(startEvent.sessionId);
    const candidate = service.listCandidates({ sessionId: startEvent.sessionId })[0]!;

    const approved = service.approveCandidate(candidate.id);

    expect(approved).toEqual(expect.objectContaining({
      status: 'approved',
      memoryId: 'existing-semantic',
      mergeTargetMemoryId: 'existing-semantic',
    }));
    expect(db.prepare(`
      SELECT COUNT(*) AS count FROM memory_item WHERE type = 'semantic'
    `).get()).toEqual({ count: 1 });
    expect(db.prepare(`
      SELECT source_id, target_id, relation_type
      FROM memory_link WHERE source_id = ?
    `).get('existing-semantic')).toEqual({
      source_id: 'existing-semantic',
      target_id: summaryMemoryId,
      relation_type: 'derived_from',
    });
    expect(repository.listProvenance({ memoryId: 'existing-semantic' })).toEqual([
      expect.objectContaining({
        observationId: 'observation-decision',
        derivationType: 'promotion',
      }),
    ]);
  });

  it('persists only approved candidates with promotion provenance and derived_from links', () => {
    addObservation('observation-decision', {
      decision: 'Keep capture hooks non-throwing.',
    }, 1);
    const summaryMemoryId = finishAndSummarize();
    service.extractCandidates(startEvent.sessionId);
    const candidate = service.listCandidates({ sessionId: startEvent.sessionId })[0]!;

    const approved = service.approveCandidate(candidate.id);
    const approvedAgain = service.approveCandidate(candidate.id);

    expect(approved.status).toBe('approved');
    expect(approved.memoryId).toBeTruthy();
    expect(approvedAgain).toEqual(approved);
    expect(db.prepare('SELECT type, content FROM memory_item WHERE id = ?')
      .get(approved.memoryId)).toEqual({
      type: 'semantic',
      content: 'Keep capture hooks non-throwing.',
    });
    expect(db.prepare(`
      SELECT source_id, target_id, relation_type
      FROM memory_link WHERE source_id = ?
    `).get(approved.memoryId)).toEqual({
      source_id: approved.memoryId,
      target_id: summaryMemoryId,
      relation_type: 'derived_from',
    });
    expect(repository.listProvenance({ memoryId: approved.memoryId! })).toEqual([
      expect.objectContaining({
        observationId: 'observation-decision',
        derivationType: 'promotion',
      }),
    ]);
    expect(telemetry).toContainEqual(expect.objectContaining({
      action: 'approved',
      candidateId: candidate.id,
      memoryId: approved.memoryId,
    }));
  });

  it('rejects candidates without making them recallable and records later usage telemetry', () => {
    addObservation('observation-procedure', {
      procedure: 'Unsafe release',
      steps: ['Skip tests', 'Deploy directly'],
    }, 1);
    finishAndSummarize();
    service.extractCandidates(startEvent.sessionId);
    const candidate = service.listCandidates({ sessionId: startEvent.sessionId })[0]!;

    const rejected = service.rejectCandidate(candidate.id, 'unsafe recommendation');
    const rejectedAgain = service.rejectCandidate(candidate.id, 'duplicate review');

    expect(rejected.status).toBe('rejected');
    expect(rejected.memoryId).toBeNull();
    expect(rejectedAgain).toEqual(rejected);
    expect(db.prepare(`
      SELECT COUNT(*) AS count FROM memory_item WHERE type = 'procedural'
    `).get()).toEqual({ count: 0 });
    expect(telemetry).toContainEqual(expect.objectContaining({
      action: 'rejected',
      reason: 'unsafe recommendation',
    }));

    service.recordUsage('approved-memory', 'used');
    expect(telemetry).toContainEqual({
      action: 'usage',
      memoryId: 'approved-memory',
      usageOutcome: 'used',
    });
  });
});
