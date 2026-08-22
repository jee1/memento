/**
 * Procedural Diff Tool 테스트 (Issue #57 Phase 2)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { ProceduralDiffTool } from '../procedural-diff-tool.js';
import { DatabaseUtils } from '../../../../shared/utils/database.js';

function createSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE memory_item (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      workflow_name TEXT,
      skill_name TEXT,
      task_goal TEXT,
      trigger_conditions TEXT,
      steps TEXT,
          project_id TEXT,
          is_deleted BOOLEAN DEFAULT FALSE NOT NULL,
          deleted_at TEXT
    )
  `);
  db.exec(`
    INSERT INTO memory_item (id, type, content, workflow_name, skill_name, task_goal, trigger_conditions, steps) VALUES ('proc-left', 'procedural', 'Left', 'wf-a', 'skill-x', 'goal1', '{"a":1}', '["step1","step2"]'),
      ('proc-right', 'procedural', 'Right', 'wf-b', 'skill-x', 'goal2', '{"a":2}', '["step1","step2-changed"]')
  `);
}

describe('ProceduralDiffTool', () => {
  let db: Database.Database;
  let tool: ProceduralDiffTool;

  beforeEach(() => {
    db = new Database(':memory:');
    createSchema(db);
    tool = new ProceduralDiffTool();
  });

  afterEach(() => {
    if (db) db.close();
  });

  it('Given: left_id, right_id와 context, When: handle 호출하면, Then: ProceduralDiffResult 형태 content 반환', async () => {
    const result = await tool.handle(
      { left_id: 'proc-left', right_id: 'proc-right' },
      { db, services: {} }
    );
    expect(result.content).toHaveLength(1);
    const data = JSON.parse(result.content[0].text);
    expect(data.left_id).toBe('proc-left');
    expect(data.right_id).toBe('proc-right');
    expect(data.workflow_name).toEqual({ left: 'wf-a', right: 'wf-b', equal: false });
    expect(data.skill_name.equal).toBe(true);
    expect(Array.isArray(data.steps)).toBe(true);
  });

  it('Given: 잘못된 id, When: handle 호출하면, Then: 에러 결과 (not_found_or_not_procedural)', async () => {
    const result = await tool.handle(
      { left_id: 'nonexistent', right_id: 'proc-right' },
      { db, services: {} }
    );
    expect(result.error).toBe('not_found_or_not_procedural');
  });
});
