import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { setupTestDatabase } from '../../../../../test/helpers/test-database.js';
import { enrichRecallItemsWithMemoryMetadata } from '../recall-tool-metadata-enrich.js';
import type { RecallSearchItem } from '../recall-tool-types.js';

describe('enrichRecallItemsWithMemoryMetadata', () => {
  let db: Database.Database;

  beforeEach(async () => {
    db = await setupTestDatabase();
    db.prepare(`
      INSERT INTO memory_item (
        id, type, content, importance, created_at,
        privacy_scope, source, origin_source,
        task_goal, steps, workflow_name, skill_name,
        trigger_conditions, version, version_series_id
      ) VALUES
        ('enrich-a', 'procedural', 'content a', 0.8, CURRENT_TIMESTAMP,
         'team', 'agent:cursor-agent', '{"kind":"chat"}',
         'goal-a', '["step-a"]', 'wf-a', 'sk-a',
         '{"tool_name":"remember"}', 2, 'series-a'),
        ('enrich-b', 'procedural', 'content b', 0.7, CURRENT_TIMESTAMP,
         'private', NULL, NULL,
         NULL, NULL, NULL, NULL,
         NULL, NULL, NULL)
    `).run();
  });

  afterEach(() => {
    db.close();
  });

  it('T1-a: 세 필드가 없는 항목을 넣으면 행별로 정확한 값이 채워진다', () => {
    const items: RecallSearchItem[] = [
      {
        id: 'enrich-a',
        content: 'content a',
        type: 'procedural',
        importance: 0.8,
        created_at: new Date().toISOString(),
      },
      {
        id: 'enrich-b',
        content: 'content b',
        type: 'procedural',
        importance: 0.7,
        created_at: new Date().toISOString(),
      },
    ];

    const enriched = enrichRecallItemsWithMemoryMetadata(db, items);

    expect(enriched).toHaveLength(2);

    const a = enriched[0];
    expect(a.privacy_scope).toBe('team');
    expect(a.source).toBe('agent:cursor-agent');
    expect(a.origin_source).toBe('{"kind":"chat"}');
    expect(a.workflow_name).toBe('wf-a');
    expect(a.skill_name).toBe('sk-a');
    expect(a.trigger_conditions).toBe('{"tool_name":"remember"}');
    expect(a.version).toBe(2);
    expect(a.version_series_id).toBe('series-a');

    const b = enriched[1];
    expect(b.privacy_scope).toBe('private');
    expect(b.source).toBeNull();
    expect(b.workflow_name).toBeNull();
    expect(b.trigger_conditions).toBeNull();

    expect(a.privacy_scope).not.toBe(b.privacy_scope);
    expect(a.workflow_name).not.toBe(b.workflow_name);
  });

  it('T1-b: DB 가 NULL 인 필드는 null 로 채워진다', () => {
    const items: RecallSearchItem[] = [
      {
        id: 'enrich-b',
        content: 'content b',
        type: 'procedural',
        importance: 0.7,
        created_at: new Date().toISOString(),
      },
    ];

    const enriched = enrichRecallItemsWithMemoryMetadata(db, items);
    const item = enriched[0];

    expect(item).toHaveProperty('source');
    expect(item.source).toBeNull();
    expect(item).toHaveProperty('workflow_name');
    expect(item.workflow_name).toBeNull();
    expect(item).toHaveProperty('trigger_conditions');
    expect(item.trigger_conditions).toBeNull();
    expect(item.workflow_name).not.toBeUndefined();
  });

  it('T1-c: 항목이 이미 값을 갖고 있으면 덮어쓰지 않는다', () => {
    const items: RecallSearchItem[] = [
      {
        id: 'enrich-a',
        content: 'content a',
        type: 'procedural',
        importance: 0.8,
        created_at: new Date().toISOString(),
        trigger_conditions: '{"tool_name":"recall"}',
      },
    ];

    const enriched = enrichRecallItemsWithMemoryMetadata(db, items);

    expect(enriched).toHaveLength(1);
    expect(enriched[0].trigger_conditions).toBe('{"tool_name":"recall"}');
  });

  it('T1-d: DB 에 없는 id 를 가진 항목은 변경 없이 통과한다', () => {
    const items: RecallSearchItem[] = [
      {
        id: 'missing-id',
        content: 'ghost',
        type: 'episodic',
        importance: 0.5,
        created_at: new Date().toISOString(),
      },
    ];

    const enriched = enrichRecallItemsWithMemoryMetadata(db, items);

    expect(enriched).toHaveLength(1);
    expect(enriched[0].privacy_scope).toBeUndefined();
    expect(enriched[0].trigger_conditions).toBeUndefined();
  });
});
