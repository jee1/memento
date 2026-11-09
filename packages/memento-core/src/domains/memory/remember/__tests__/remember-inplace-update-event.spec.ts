import { createHash } from 'crypto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { handleMemoryItem, type MemoryItemContext } from '../remember-tool-memory-item.js';
import type { RememberToolHost } from '../remember-tool-host.js';
import type { ToolContext } from '../../../../tools/types.js';
import * as configModule from '../../../../shared/config/index.js';
import * as vectorSearchModule from '../../../search/algorithms/vector-search-engine.js';
import { TelemetryRepository } from '../../../telemetry/repositories/telemetry-repository.js';
import { TelemetryService } from '../../../telemetry/services/telemetry-service.js';
import type { TelemetryEventInput } from '../../../telemetry/types/telemetry.types.js';

const BEFORE_BODY = 'inplace-before-body-9f3a';
const AFTER_BODY = 'inplace-after-body-9f3a';

function sha256Utf8(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function initializeTestDatabase(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_item (
      id TEXT PRIMARY KEY,
      type TEXT CHECK (type IN ('working','episodic','semantic','procedural')) NOT NULL,
      content TEXT NOT NULL,
      importance REAL CHECK (importance >= 0 AND importance <= 1) DEFAULT 0.5,
      privacy_scope TEXT CHECK (privacy_scope IN ('private','team','public')) DEFAULT 'private',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      last_accessed TIMESTAMP,
      pinned BOOLEAN DEFAULT FALSE,
      tags TEXT,
      source TEXT,
      origin_source TEXT,
      task_goal TEXT,
      steps TEXT,
      reflection_notes TEXT,
      workflow_name TEXT,
      skill_name TEXT,
      trigger_conditions TEXT,
      recall_count INTEGER NOT NULL DEFAULT 0,
      last_accessed_at TIMESTAMP,
      consolidation_score REAL,
      g_value REAL,
      version INTEGER NULL,
      version_series_id TEXT NULL,
      owner_id TEXT NULL,
      process_id TEXT NULL,
      session_id TEXT NULL,
      num_times INTEGER NOT NULL DEFAULT 1,
      last_mentioned_at TIMESTAMP,
      source_session_id TEXT,
      confidence REAL,
      project_id TEXT NULL,
      work_record TEXT,
      is_deleted BOOLEAN DEFAULT FALSE NOT NULL,
      deleted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS memory_link (
      source_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      relation_type TEXT NOT NULL,
      PRIMARY KEY (source_id, target_id, relation_type)
    );

    CREATE TABLE IF NOT EXISTS telemetry_events (
      id          TEXT PRIMARY KEY,
      event_type  TEXT NOT NULL,
      request_id  TEXT NOT NULL,
      owner_id    TEXT,
      latency_ms  INTEGER,
      outcome     TEXT NOT NULL,
      error_code  TEXT,
      extra_data  TEXT,
      created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    CREATE TABLE IF NOT EXISTS telemetry_daily_metrics (
      id              TEXT PRIMARY KEY,
      date            TEXT NOT NULL,
      event_type      TEXT NOT NULL,
      owner_id        TEXT NOT NULL DEFAULT '',
      event_count     INTEGER NOT NULL DEFAULT 0,
      avg_latency_ms  REAL,
      error_count     INTEGER NOT NULL DEFAULT 0,
      updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      UNIQUE(date, event_type, owner_id)
    );
  `);
}

function insertMemory(db: Database.Database, id: string, content: string): void {
  db.prepare(`
    INSERT INTO memory_item (id, type, content, importance, owner_id, project_id, recall_count, num_times)
    VALUES (?, 'episodic', ?, 0.5, 'owner-a', 'proj-a', 0, 1)
  `).run(id, content);
}

function createHost(): RememberToolHost {
  return {
    logInfo: vi.fn(),
    logWarning: vi.fn(),
    logError: vi.fn(),
    createSuccessResult: (data: unknown) => ({
      content: [{ type: 'text', text: JSON.stringify(data) }],
    }),
    createErrorResult: (error, message, data) => ({
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: false,
          error: { code: error, message: message ?? error },
          ...(data ? { data } : {}),
        }),
      }],
      error,
      ...(message ? { message } : {}),
    }),
  };
}

function baseCtx(): MemoryItemContext {
  return {
    type: 'episodic',
    ownerId: 'owner-a',
    processId: null,
    sessionId: null,
    numTimes: 1,
    sourceSessionId: null,
    confidenceVal: null,
    origin_source: '{}',
    startTime: Date.now(),
    project_id_param: 'proj-a',
    last_mentioned_at_param: null,
  };
}

class FailInPlaceInsert extends TelemetryRepository {
  override insertEventSync(event: TelemetryEventInput): void {
    if (event.eventType === 'memory.write.inplace_updated') {
      throw new Error('insert failed');
    }
    super.insertEventSync(event);
  }
}

async function flushTelemetry(): Promise<void> {
  await new Promise<void>(resolve => setImmediate(resolve));
  await new Promise<void>(resolve => setImmediate(resolve));
}

type InPlaceRow = { extra_data: string; created_at: string };

function inplaceRows(db: Database.Database): InPlaceRow[] {
  return db.prepare(
    `SELECT extra_data, created_at FROM telemetry_events WHERE event_type = 'memory.write.inplace_updated'`,
  ).all() as InPlaceRow[];
}

describe('remember in-place update telemetry (#1676)', () => {
  let db: Database.Database;
  let context: ToolContext;
  let host: RememberToolHost;

  beforeEach(() => {
    db = new Database(':memory:');
    initializeTestDatabase(db);

    const searchMock = vi.fn().mockResolvedValue([]);
    const generateEmbeddingMock = vi.fn().mockResolvedValue({ embedding: [0.1, 0.2, 0.3] });
    vi.spyOn(vectorSearchModule, 'getVectorSearchEngine').mockReturnValue({
      initialize: vi.fn(),
      search: searchMock,
    } as unknown as vectorSearchModule.VectorSearchEngine);
    vi.spyOn(configModule, 'mementoConfig', 'get').mockReturnValue({
      ...configModule.mementoConfig,
      rememberDedupMode: 'off',
      rememberDedupThreshold: 0.85,
      rememberDedupLexicalFloor: 0.3,
      rememberDedupMergeLexicalFloor: 0.7,
    });

    context = {
      db,
      services: {
        embeddingService: {
          isAvailable: () => true,
          getUnifiedEmbeddingService: () => ({
            generateEmbedding: generateEmbeddingMock,
            getCurrentProviderName: vi.fn().mockReturnValue('mock'),
          }),
        } as ToolContext['services']['embeddingService'],
        vectorSearchEngine: {
          initialize: vi.fn(),
          search: searchMock,
        } as unknown as ToolContext['services']['vectorSearchEngine'],
        telemetryService: new TelemetryService(new TelemetryRepository(db)),
      },
    };
    host = createHost();
  });

  afterEach(() => {
    db.close();
    vi.restoreAllMocks();
  });

  function parsePayload(result: Awaited<ReturnType<typeof handleMemoryItem>>) {
    return JSON.parse(result.content[0].text) as { memory_id: string; updated?: boolean };
  }

  async function replace(memoryId: string, content: string) {
    return handleMemoryItem(
      { type: 'episodic', content, memory_id: memoryId, update_mode: 'replace' },
      context,
      baseCtx(),
      host,
    );
  }

  it('본문이 다른 replace 는 inplace_updated 한 건만 남기고 본문은 extra_data 에 넣지 않는다', async () => {
    insertMemory(db, 'mem_ip_1', BEFORE_BODY);

    const data = parsePayload(await replace('mem_ip_1', AFTER_BODY));
    expect(data.updated).toBe(true);
    expect(data.memory_id).toBe('mem_ip_1');

    await flushTelemetry();
    const rows = inplaceRows(db);
    expect(rows).toHaveLength(1);
    expect(rows[0].created_at.length).toBeGreaterThan(0);

    const beforeSha = sha256Utf8(BEFORE_BODY);
    const afterSha = sha256Utf8(AFTER_BODY);
    expect(beforeSha).not.toBe(afterSha);
    expect(JSON.parse(rows[0].extra_data)).toEqual({
      memory_id: 'mem_ip_1',
      update_mode: 'replace',
      before_content_sha256: beforeSha,
      after_content_sha256: afterSha,
    });
    expect(rows[0].extra_data).not.toContain(BEFORE_BODY);
    expect(rows[0].extra_data).not.toContain(AFTER_BODY);
  });

  it('본문이 같은 replace 는 inplace_updated 를 남기지 않는다', async () => {
    insertMemory(db, 'mem_ip_same', BEFORE_BODY);

    const data = parsePayload(await replace('mem_ip_same', BEFORE_BODY));
    expect(data.updated).toBe(true);

    await flushTelemetry();
    expect(inplaceRows(db)).toHaveLength(0);
  });

  it('새 기억 저장은 inplace_updated 를 남기지 않는다', async () => {
    const result = await handleMemoryItem(
      { type: 'episodic', content: 'brand-new-body-9f3a' },
      context,
      baseCtx(),
      host,
    );
    const data = parsePayload(result);
    expect(data.updated).toBeUndefined();
    expect(data.memory_id).toMatch(/^mem_/);

    await flushTelemetry();
    expect(inplaceRows(db)).toHaveLength(0);
  });

  it('record 가 던져도 제자리 갱신은 성공한다', async () => {
    insertMemory(db, 'mem_ip_throw', BEFORE_BODY);
    const telemetry = context.services.telemetryService!;
    const realRecord = telemetry.record.bind(telemetry);
    vi.spyOn(telemetry, 'record').mockImplementation(partial => {
      if (partial.eventType === 'memory.write.inplace_updated') {
        throw new Error('telemetry down');
      }
      realRecord(partial);
    });

    const data = parsePayload(await replace('mem_ip_throw', AFTER_BODY));
    expect(data.updated).toBe(true);

    const row = db.prepare('SELECT content FROM memory_item WHERE id = ?').get('mem_ip_throw') as { content: string };
    expect(row.content).toBe(AFTER_BODY);

    await flushTelemetry();
    expect(inplaceRows(db)).toHaveLength(0);
  });

  it('insert 가 실패해도 제자리 갱신은 성공한다', async () => {
    insertMemory(db, 'mem_ip_insert', BEFORE_BODY);
    context.services.telemetryService = new TelemetryService(new FailInPlaceInsert(db));

    const data = parsePayload(await replace('mem_ip_insert', AFTER_BODY));
    expect(data.updated).toBe(true);

    const row = db.prepare('SELECT content FROM memory_item WHERE id = ?').get('mem_ip_insert') as { content: string };
    expect(row.content).toBe(AFTER_BODY);

    await flushTelemetry();
    expect(inplaceRows(db)).toHaveLength(0);
    const completed = db.prepare(
      `SELECT COUNT(*) AS c FROM telemetry_events WHERE event_type = 'memory.write.completed'`,
    ).get() as { c: number };
    expect(completed.c).toBe(1);
  });
});
