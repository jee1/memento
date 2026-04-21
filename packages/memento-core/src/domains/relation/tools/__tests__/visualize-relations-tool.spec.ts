/**
 * Visualize Relations Tool 단위 테스트
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { VisualizeRelationsTool } from '../visualize-relations-tool.js';
import { DatabaseUtils } from '../../../../shared/utils/database.js';
import { RelationEngineSchemaMigration } from '../../../../infrastructure/database/database/migration/migrations/005-relation-engine-schema.js';
import type { RelationGraph } from '../../services/relation-graph.js';
import { createRelationGraph } from '../../../../infrastructure/relation-graph-factory.js';
import type { ToolContext } from '../../../../tools/types.js';

function createBaseSchema(db: Database.Database): void {
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
      view_count INTEGER DEFAULT 0,
      cite_count INTEGER DEFAULT 0,
      edit_count INTEGER DEFAULT 0
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS memento_schema_version (
      version INTEGER PRIMARY KEY,
      applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

function createTestMemory(
  db: Database.Database,
  id: string,
  content: string,
  type: string = 'episodic'
): void {
  DatabaseUtils.run(db, `
    INSERT INTO memory_item (id, type, content)
    VALUES (?, ?, ?)
  `, [id, type, content]);
}

describe('VisualizeRelationsTool', () => {
  let db: Database.Database;
  let tool: VisualizeRelationsTool;
  let context: ToolContext;
  let relationGraph: RelationGraph;

  beforeEach(() => {
    db = new Database(':memory:');
    createBaseSchema(db);

    const migration = new RelationEngineSchemaMigration();
    migration.up(db);

    relationGraph = createRelationGraph(db);

    context = {
      db,
      services: {
        relationGraph,
      },
    };

    tool = new VisualizeRelationsTool();
  });

  afterEach(() => {
    if (db) {
      db.close();
    }
  });

  it('format이 dot이면 visualization에 digraph가 포함되어야 함', async () => {
    createTestMemory(db, 'mem1', 'Test memory 1');
    createTestMemory(db, 'mem2', 'Test memory 2');
    await relationGraph.addRelation('mem1', 'mem2', 'REFERENCES', { confidence: 0.91 });

    const result = await tool.handle(
      {
        memory_id: 'mem1',
        format: 'dot',
      },
      context
    );

    expect(result.content).toBeDefined();
    const data = JSON.parse(result.content![0].text);
    expect(data.format).toBe('dot');
    expect(data.visualization).toContain('digraph');
    expect(data.visualization).toContain('mem1');
    expect(data.visualization).toContain('mem2');
    expect(data.visualization).toContain('REFERENCES');
  });


  it('relationGraph가 없으면 구성 오류를 반환해야 함', async () => {
    createTestMemory(db, 'mem1', 'Test memory 1');

    const result = await tool.handle(
      {
        memory_id: 'mem1',
        format: 'dot',
      },
      {
        db,
        services: {},
      }
    );

    const data = JSON.parse(result.content![0].text);
    expect(data.success).toBe(false);
    expect(data.error).toBe('RELATION_GRAPH_UNAVAILABLE');
    expect(data.message).toContain('관계 그래프 서비스');
  });

  it('관계가 없을 때 dot 형식은 빈 그래프 주석을 포함할 수 있음', async () => {
    createTestMemory(db, 'mem1', 'Test memory 1');

    const result = await tool.handle(
      {
        memory_id: 'mem1',
        format: 'dot',
      },
      context
    );

    const data = JSON.parse(result.content![0].text);
    expect(data.visualization).toContain('digraph');
    expect(data.visualization).toMatch(/no relations/);
  });
});
