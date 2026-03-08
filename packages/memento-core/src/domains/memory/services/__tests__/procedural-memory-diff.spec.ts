/**
 * Procedural Memory Diff 테스트 (Issue #57 Phase 2)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { DatabaseUtils } from '../../../../shared/utils/database.js';
import { computeProceduralDiff } from '../procedural-memory-diff.js';

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
      steps TEXT
    )
  `);
  db.exec(`
    INSERT INTO memory_item (id, type, content, workflow_name, skill_name, task_goal, trigger_conditions, steps)
    VALUES
      ('proc-left', 'procedural', 'Left', 'wf-a', 'skill-x', 'goal1', '{"a":1}', '["step1","step2"]'),
      ('proc-right', 'procedural', 'Right', 'wf-b', 'skill-x', 'goal2', '{"a":2}', '["step1","step2-changed","step3"]'),
      ('episodic-1', 'episodic', 'E', NULL, NULL, NULL, NULL, NULL)
  `);
}

describe('procedural-memory-diff', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    createSchema(db);
  });

  afterEach(() => {
    if (db) db.close();
  });

  it('Given: 두 procedural id, When: computeProceduralDiff 호출하면, Then: ProceduralDiffResult 반환', () => {
    const result = computeProceduralDiff(db, 'proc-left', 'proc-right');
    expect(result).not.toBeNull();
    expect(result!.left_id).toBe('proc-left');
    expect(result!.right_id).toBe('proc-right');
    expect(result!.workflow_name.left).toBe('wf-a');
    expect(result!.workflow_name.right).toBe('wf-b');
    expect(result!.workflow_name.equal).toBe(false);
    expect(result!.skill_name.equal).toBe(true);
    expect(result!.skill_name.right).toBe('skill-x');
    expect(result!.steps.length).toBe(3);
    expect(result!.steps[0].change).toBe('same');
    expect(result!.steps[1].change).toBe('modified');
    expect(result!.steps[2].change).toBe('added');
  });

  it('Given: 존재하지 않는 left_id, When: computeProceduralDiff 호출하면, Then: null 반환', () => {
    const result = computeProceduralDiff(db, 'nonexistent', 'proc-right');
    expect(result).toBeNull();
  });

  it('Given: 한쪽이 episodic, When: computeProceduralDiff 호출하면, Then: null 반환', () => {
    const result = computeProceduralDiff(db, 'proc-left', 'episodic-1');
    expect(result).toBeNull();
  });
});
