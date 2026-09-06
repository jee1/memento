/**
 * ReflexionReflectionRecorder — must not promote params.content to task_goal (#856)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { ReflexionReflectionRecorder } from './reflexion-reflection-recorder.js';
import type { ReflexionProceduralMemoryService } from './reflexion-procedural-memory-service.js';
import { ErrorType } from '../domains/monitoring/services/failure-detector.js';
import type { FailureEvent } from '../domains/monitoring/services/failure-detector.js';
import { DatabaseUtils } from '../shared/utils/database.js';

describe('ReflexionReflectionRecorder task_goal (#856)', () => {
  let db: Database.Database;
  let convert: ReturnType<typeof vi.fn>;
  let recorder: ReflexionReflectionRecorder;
  let runSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE memory_item (
        id TEXT PRIMARY KEY,
        type TEXT,
        content TEXT,
        task_goal TEXT,
        steps TEXT,
        reflection_notes TEXT,
        importance REAL,
        privacy_scope TEXT,
        created_at TEXT
      );
    `);
    convert = vi.fn().mockResolvedValue(undefined);
    const proceduralMemoryService = {
      convert
    } as unknown as ReflexionProceduralMemoryService;
    recorder = new ReflexionReflectionRecorder(db, proceduralMemoryService, 60_000);
    runSpy = vi.spyOn(DatabaseUtils, 'run');
  });

  afterEach(() => {
    runSpy.mockRestore();
    db.close();
  });

  function makeEvent(overrides: Partial<FailureEvent> = {}): FailureEvent {
    return {
      id: `failure_remember_tool_error_${Date.now()}`,
      tool_name: 'remember',
      error_type: ErrorType.TOOL_ERROR,
      error_message: 'Database connection failed',
      error_message_hash: 'abc',
      timestamp: new Date().toISOString(),
      context: {
        params: {
          content: 'Docker "permission denied ... unix:///var/run/docker.sock" and getent group docker shows ...'
        }
      },
      priority: 5,
      ...overrides
    };
  }

  it('does not use params.content as task_goal (recordWithoutTaskGoal path)', async () => {
    const recorded = await recorder.record(makeEvent());

    expect(recorded).toBe(true);
    const insertCalls = runSpy.mock.calls.filter(
      (call) => typeof call[1] === 'string' && (call[1] as string).includes('INSERT INTO memory_item')
    );
    expect(insertCalls.length).toBeGreaterThan(0);
    const sql = insertCalls[0]![1] as string;
    // without-task-goal INSERT has no task_goal column
    expect(sql).toContain('reflection_notes, importance, privacy_scope, created_at');
    expect(sql).not.toContain('task_goal, steps');
    const row = db.prepare(`SELECT task_goal, content FROM memory_item LIMIT 1`).get() as
      | { task_goal: string | null; content: string }
      | undefined;
    expect(row?.task_goal == null || row?.task_goal === '').toBe(true);
    expect(row?.content).toContain('Reflexion:');
    expect(row?.content).not.toContain('Docker');
  });

  it('uses explicit original_task / task_goal when present', async () => {
    const recorded = await recorder.record(
      makeEvent({
        original_task: '배포 롤백',
        context: { params: { task_goal: '배포 롤백', content: 'ignored content' } }
      })
    );

    expect(recorded).toBe(true);
    const insertCalls = runSpy.mock.calls.filter(
      (call) => typeof call[1] === 'string' && (call[1] as string).includes('INSERT INTO memory_item')
    );
    expect(insertCalls.length).toBeGreaterThan(0);
    const sql = insertCalls[0]![1] as string;
    expect(sql).toContain('task_goal');
    const params = insertCalls[0]![2] as unknown[];
    expect(params).toContain('배포 롤백');
  });
});
