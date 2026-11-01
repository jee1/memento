import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupTestDatabase } from '../../../../../test/helpers/test-database.js';
import { mementoConfig } from '../../../../shared/config/index.js';
import {
  evaluateProceduralAdoption,
  recordProceduralExecution,
  type ProceduralExecutionInput,
} from '../procedural-execution-evidence.js';

const ENV = { environment: 'ci-linux', toolVersion: '2.4.0' };
const SERIES = 'series-deploy';

describe('procedural execution evidence and adoption gate (#1550)', () => {
  let db: Database.Database;
  const savedConfig = { ...mementoConfig };

  beforeEach(async () => {
    db = await setupTestDatabase();
    Object.assign(mementoConfig, { proceduralExecutionEvidenceEnabled: true });
    db.prepare(`INSERT INTO memory_item
      (id, type, content, steps, version, version_series_id, owner_id, project_id)
      VALUES (?, 'procedural', ?, ?, ?, ?, 'owner-a', 'project-a')`)
      .run('proc-v1', 'deploy', '["build","ship"]', 1, SERIES);
    db.prepare(`INSERT INTO memory_item
      (id, type, content, steps, pinned, source, origin_source, owner_id, project_id)
      VALUES ('cand', 'episodic', '[미검증 절차 후보: 실행·채택 금지] deploy', '["build","test","ship"]', 1,
      'reflexion', ?, 'owner-a', 'project-a')`)
      .run(JSON.stringify({ tool: 'reflexion', reflexion: { state: 'unverified_candidate', event_id: 'e1' } }));
  });

  afterEach(() => {
    Object.assign(mementoConfig, savedConfig);
    db.close();
  });

  function record(memoryId: string, runId: string, input: Partial<ProceduralExecutionInput> = {}) {
    return recordProceduralExecution(db, {
      memoryId, runId, caseId: 'case-1', kind: 'held_out', outcome: 'success', ...ENV, ...input,
    });
  }

  function evaluate(env = ENV) {
    return evaluateProceduralAdoption(db, { candidateMemoryId: 'cand', versionSeriesId: SERIES, ...env });
  }

  function judged(verdict: ReturnType<typeof evaluate>) {
    if (verdict.kind !== 'judged') throw new Error(`expected judged, got ${verdict.reason}`);
    return verdict;
  }

  it('rejects adoption when the candidate fails a case the served version passed in the fixed environment', () => {
    record('proc-v1', 'base-1', { caseId: 'case-1' });
    record('proc-v1', 'base-2', { caseId: 'case-2', kind: 'replay' });
    record('cand', 'cand-1', { caseId: 'case-1', outcome: 'failure' });
    record('cand', 'cand-2', { caseId: 'case-2', kind: 'replay' });

    const verdict = judged(evaluate());
    expect(verdict.passed).toBe(false);
    expect(verdict.reasons).toContain('regression');
    expect(verdict.report.regressions).toEqual(['case-1']);
  });

  it('does not borrow results from another environment for the fixed one', () => {
    record('proc-v1', 'base-1');
    record('cand', 'cand-other-env', { environment: 'macos' });

    const verdict = judged(evaluate());
    expect(verdict.passed).toBe(false);
    expect(verdict.reasons).toContain('missing_case');
    expect(verdict.report.missingCases).toEqual(['case-1']);
    expect(verdict.report.heldOut).toEqual({ cases: 0, passed: 0 });
  });

  it('keeps replay passes apart from held-out results and refuses replay-only evidence', () => {
    record('proc-v1', 'base-1', { kind: 'replay' });
    for (const caseId of ['case-1', 'case-2', 'case-3']) {
      record('cand', `cand-${caseId}`, { caseId, kind: 'replay' });
    }

    const replayOnly = judged(evaluate());
    expect(replayOnly.passed).toBe(false);
    expect(replayOnly.reasons).toEqual(['replay_only']);
    expect(replayOnly.report.replay).toEqual({ cases: 3, passed: 3 });
    expect(replayOnly.report.heldOut).toEqual({ cases: 0, passed: 0 });

    record('cand', 'cand-held-1', { caseId: 'held-1' });
    record('cand', 'cand-held-2', { caseId: 'held-2', outcome: 'failure' });
    const withHeldOut = judged(evaluate());
    expect(withHeldOut.passed).toBe(true);
    expect(withHeldOut.report.replay).toEqual({ cases: 3, passed: 3 });
    expect(withHeldOut.report.heldOut).toEqual({ cases: 2, passed: 1 });
  });

  it('does not attribute an older version success to the newly served version', () => {
    record('proc-v1', 'base-1');
    db.prepare(`INSERT INTO memory_item
      (id, type, content, steps, version, version_series_id, owner_id, project_id)
      VALUES ('proc-v2', 'procedural', 'deploy', '["build","lint","ship"]', 2, ?, 'owner-a', 'project-a')`)
      .run(SERIES);
    record('cand', 'cand-1');

    const verdict = judged(evaluate());
    expect(verdict.report.servedMemoryId).toBe('proc-v2');
    expect(verdict.reasons).toEqual(['no_baseline_success']);
    expect(verdict.report.baselineSuccessCases).toEqual([]);
  });

  it('serves a legacy v1 without a series id under its own id and skips a deleted newer version', () => {
    db.prepare(`INSERT INTO memory_item (id, type, content, steps, owner_id, project_id)
      VALUES ('legacy', 'procedural', 'deploy', '["ship"]', 'owner-a', 'project-a')`).run();
    db.prepare(`INSERT INTO memory_item
      (id, type, content, version, version_series_id, owner_id, project_id, is_deleted)
      VALUES ('proc-v2-deleted', 'procedural', 'deploy', 2, ?, 'owner-a', 'project-a', 1)`).run(SERIES);

    const legacy = evaluateProceduralAdoption(db, { candidateMemoryId: 'cand', versionSeriesId: 'legacy', ...ENV });
    expect(judged(legacy).report.servedMemoryId).toBe('legacy');
    expect(judged(evaluate()).report.servedMemoryId).toBe('proc-v1');
  });

  it('drops evidence recorded against content that was later edited in place', () => {
    record('proc-v1', 'base-1');
    record('cand', 'cand-1');
    db.prepare(`UPDATE memory_item SET steps = '["ship"]' WHERE id = 'proc-v1'`).run();

    const verdict = judged(evaluate());
    expect(verdict.reasons).toEqual(['no_baseline_success']);
    expect(verdict.report.staleEvidence).toBe(1);
  });

  it('never writes memory_item, so an unverified candidate gains no active exposure', () => {
    const snapshot = () => db.prepare('SELECT * FROM memory_item ORDER BY id').all();
    const before = snapshot();
    record('proc-v1', 'base-1');
    record('cand', 'cand-1');

    expect(judged(evaluate()).passed).toBe(true);
    expect(snapshot()).toEqual(before);
    expect(db.prepare("SELECT type FROM memory_item WHERE id = 'cand'").get()).toEqual({ type: 'episodic' });
    expect(db.prepare("SELECT COUNT(*) AS n FROM memory_item WHERE type = 'procedural'").get()).toEqual({ n: 1 });
  });

  it('does not count helpful feedback as execution success', () => {
    record('proc-v1', 'base-1');
    const helpful = db.prepare("INSERT INTO feedback_event (memory_id, event, score) VALUES ('cand', 'helpful', 1)");
    helpful.run();
    helpful.run();

    const verdict = judged(evaluate());
    expect(verdict.passed).toBe(false);
    expect(verdict.report.heldOut).toEqual({ cases: 0, passed: 0 });
    expect(verdict.report.missingCases).toEqual(['case-1']);
  });

  it('applies a re-sent run once and refuses a different payload under the same run id', () => {
    record('proc-v1', 'base-1');
    const first = record('cand', 'cand-1', { outcome: 'failure' });
    const again = record('cand', 'cand-1', { outcome: 'failure' });
    expect(first.kind).toBe('recorded');
    expect(again).toEqual({ kind: 'already_recorded', id: first.kind === 'recorded' ? first.id : '' });
    expect(record('cand', 'cand-1', { outcome: 'success' })).toEqual({ kind: 'rejected', reason: 'run_id_conflict' });
    expect(db.prepare("SELECT COUNT(*) AS n FROM procedural_execution_evidence WHERE memory_id = 'cand'").get())
      .toEqual({ n: 1 });
    expect(judged(evaluate()).report.regressions).toEqual(['case-1']);
  });

  it('records nothing while the flag is off', () => {
    Object.assign(mementoConfig, { proceduralExecutionEvidenceEnabled: false });
    expect(record('cand', 'cand-1')).toEqual({ kind: 'rejected', reason: 'disabled' });
    expect(db.prepare('SELECT COUNT(*) AS n FROM procedural_execution_evidence').get()).toEqual({ n: 0 });
  });

  it('only accepts evidence for procedural rows or unverified reflexion candidates', () => {
    db.prepare("INSERT INTO memory_item (id, type, content) VALUES ('plain', 'episodic', 'note')").run();
    expect(record('plain', 'r1')).toEqual({ kind: 'rejected', reason: 'not_procedure' });
    expect(record('missing', 'r2')).toEqual({ kind: 'rejected', reason: 'memory_not_found' });
  });

  it('blocks a missing series, a candidate from another scope, and one that is not an unverified candidate', () => {
    expect(evaluateProceduralAdoption(db, { candidateMemoryId: 'cand', versionSeriesId: 'none', ...ENV }))
      .toEqual({ kind: 'blocked', reason: 'served_not_found' });

    db.prepare("UPDATE memory_item SET owner_id = 'owner-b' WHERE id = 'cand'").run();
    expect(evaluate()).toEqual({ kind: 'blocked', reason: 'scope_mismatch' });

    db.prepare("UPDATE memory_item SET owner_id = 'owner-a', origin_source = NULL WHERE id = 'cand'").run();
    expect(evaluate()).toEqual({ kind: 'blocked', reason: 'candidate_not_unverified' });
  });
});
