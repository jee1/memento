import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HybridSearchEngine } from '../../search/algorithms/hybrid-search-engine.js';
import { SqliteHybridAgentContextSource } from './sqlite-hybrid-agent-context-source.js';

describe('SqliteHybridAgentContextSource', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE memory_item (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        content TEXT NOT NULL,
        importance REAL NOT NULL,
        privacy_scope TEXT NOT NULL,
        owner_id TEXT,
        project_id TEXT,
        process_id TEXT,
        session_id TEXT,
        confidence REAL,
        created_at TEXT NOT NULL,
        tags TEXT
      );
      INSERT INTO memory_item VALUES
        (
          'memory-a', 'semantic', 'stored content', 0.8, 'private',
          'owner-a', 'project-a', 'process-a', 'session-a', 0.75,
          '2026-06-06T00:00:00.000Z', '["auth"]'
        );
    `);
  });

  afterEach(() => {
    db.close();
  });

  it('maps hybrid hits to scope-aware candidates using authoritative database metadata', async () => {
    const search = vi.fn().mockResolvedValue({
      items: [{
        id: 'memory-a',
        content: 'search content',
        type: 'semantic',
        importance: 0.8,
        created_at: '2026-06-06T00:00:00.000Z',
        pinned: false,
        textScore: 0.7,
        vectorScore: 0.9,
        finalScore: 0.85,
        recall_reason: 'hybrid',
      }],
      total_count: 1,
      query_time: 4,
      fallback_used: false,
    });
    const source = new SqliteHybridAgentContextSource({
      db,
      hybridSearchEngine: { search } as unknown as HybridSearchEngine,
    });

    const result = await source.recall({
      query: 'authentication',
      scope: {
        ownerId: 'owner-a',
        projectId: 'project-a',
        processId: 'process-a',
        sessionId: 'session-a',
      },
      limit: 10,
    });

    expect(search).toHaveBeenCalledWith(db, expect.objectContaining({
      query: 'authentication',
      limit: 10,
    }));
    expect(result.items).toEqual([{
      id: 'memory-a',
      content: 'stored content',
      type: 'semantic',
      relevance: 0.85,
      importance: 0.8,
      createdAt: '2026-06-06T00:00:00.000Z',
      provenanceConfidence: 0.75,
      privacyScope: 'private',
      ownerId: 'owner-a',
      projectId: 'project-a',
      processId: 'process-a',
      sessionId: 'session-a',
      topics: ['auth'],
    }]);
  });

  it('marks hybrid fallback as degraded without discarding available items', async () => {
    const search = vi.fn().mockResolvedValue({
      items: [{
        id: 'memory-a',
        content: 'search content',
        type: 'semantic',
        importance: 0.8,
        created_at: '2026-06-06T00:00:00.000Z',
        pinned: false,
        textScore: 0.7,
        vectorScore: 0,
        finalScore: 0.7,
        recall_reason: 'text fallback',
      }],
      total_count: 1,
      query_time: 4,
      fallback_used: true,
    });
    const source = new SqliteHybridAgentContextSource({
      db,
      hybridSearchEngine: { search } as unknown as HybridSearchEngine,
    });

    const result = await source.recall({
      query: 'authentication',
      scope: { ownerId: 'owner-a', projectId: 'project-a' },
      limit: 10,
    });

    expect(result.items).toHaveLength(1);
    expect(result.degradedReason).toEqual({
      code: 'search_fallback',
      message: 'hybrid search used a fallback path',
    });
  });
});
