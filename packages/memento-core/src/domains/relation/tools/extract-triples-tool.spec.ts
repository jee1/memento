import { describe, it, expect, vi } from 'vitest';
import Database from 'better-sqlite3';
import type { ToolContext } from '../../../tools/types.js';
import {
  ExtractTriplesTool,
  normalizeChunkOverlapForPipeline,
  resolveExtractTriplesOwner,
} from './extract-triples-tool.js';

vi.mock('../services/triple-extraction/triple-extraction-service.js', () => ({
  TripleExtractionService: vi.fn().mockImplementation(() => ({
    extractTriples: vi.fn().mockResolvedValue({
      triples: [{ subject: 'x', predicate: 'y', object: 'z' }],
      extractionInfo: { steps: { canonicalization: true, entityLinking: true } },
    }),
  })),
}));

vi.mock('../services/triple-extraction/triple-pipeline-orchestrator.js', () => ({
  TriplePipelineOrchestrator: vi.fn().mockImplementation(() => ({
    run: vi.fn().mockResolvedValue({
      triples: [
        { subject: 'Alice', predicate: 'knows', object: 'Bob' },
        { subject: 'Alice', predicate: 'likes', object: 'Tea' },
      ],
      chunkErrors: [{ chunkIndex: 0, reason: 'llm_parse_fail', message: 'x' }],
      chunksProcessed: 2,
    }),
  })),
}));

function createMemoryDbWithKgTriple(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE kg_triple (
      id TEXT PRIMARY KEY,
      subject TEXT NOT NULL,
      predicate TEXT NOT NULL,
      object TEXT NOT NULL,
      owner_id TEXT NULL,
      process_id TEXT NULL,
      session_id TEXT NULL,
      representative_memory_id TEXT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(subject, predicate, object)
    );
  `);
  return db;
}

describe('normalizeChunkOverlapForPipeline', () => {
  it('returns overlap when overlap < chunkSize', () => {
    expect(normalizeChunkOverlapForPipeline(8000, 200)).toBe(200);
  });

  it('reduces overlap when overlap >= chunkSize', () => {
    expect(normalizeChunkOverlapForPipeline(100, 200)).toBe(99);
  });
});

describe('resolveExtractTriplesOwner', () => {
  it('returns agentId when set', () => {
    expect(
      resolveExtractTriplesOwner({
        db: {} as ToolContext['db'],
        services: {},
        agentId: 'agent_1',
      }),
    ).toBe('agent_1');
  });

  it('returns null when agentId missing', () => {
    expect(
      resolveExtractTriplesOwner({
        db: {} as ToolContext['db'],
        services: {},
      }),
    ).toBeNull();
  });
});

describe('ExtractTriplesTool', () => {
  const tool = new ExtractTriplesTool();

  it('returns INVALID_INPUT when neither content nor messages', async () => {
    const res = await tool.handle({}, { db: {} as ToolContext['db'], services: {} });
    const text = res.content[0]?.type === 'text' ? res.content[0].text : '';
    const body = JSON.parse(text) as { error?: string };
    expect(body.error).toBe('INVALID_INPUT');
  });

  it('returns INVALID_INPUT when both content and messages are provided', async () => {
    const res = await tool.handle(
      {
        content: 'hello',
        messages: [{ role: 'user', content: 'hi' }],
      },
      { db: {} as ToolContext['db'], services: {} },
    );
    const text = res.content[0]?.type === 'text' ? res.content[0].text : '';
    const body = JSON.parse(text) as { error?: string };
    expect(body.error).toBe('INVALID_INPUT');
  });

  it('persists triples to kg_triple when persist is true', async () => {
    const db = createMemoryDbWithKgTriple();
    const res = await tool.handle(
      {
        content: 'Some text for extraction.',
        persist: true,
        process_id: 'p1',
        session_id: 's1',
      },
      {
        db,
        services: {},
        agentId: 'owner_x',
        processId: 'ctx_p',
        sessionId: 'ctx_s',
      },
    );
    const text = res.content[0]?.type === 'text' ? res.content[0].text : '';
    const body = JSON.parse(text) as {
      success?: boolean;
      persisted_count?: number;
      triples?: { subject: string; predicate: string; object: string }[];
    };
    expect(body.success).toBe(true);
    expect(body.persisted_count).toBe(2);
    expect(body.triples).toHaveLength(2);

    const row = db
      .prepare(
        'SELECT owner_id, process_id, session_id FROM kg_triple WHERE subject = ? AND predicate = ?',
      )
      .get('Alice', 'knows') as { owner_id: string | null; process_id: string | null; session_id: string | null };
    expect(row.owner_id).toBe('owner_x');
    expect(row.process_id).toBe('p1');
    expect(row.session_id).toBe('s1');

    db.close();
  });

  it('returns success without persist when persist is false', async () => {
    const res = await tool.handle(
      { content: 'only in-memory run' },
      { db: {} as ToolContext['db'], services: {} },
    );
    const text = res.content[0]?.type === 'text' ? res.content[0].text : '';
    const body = JSON.parse(text) as { success?: boolean; persisted_count?: number };
    expect(body.success).toBe(true);
    expect(body.persisted_count).toBeUndefined();
  });
});
