import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  closeSupersedeTestDb,
  createSupersedeTestDb,
  fakeChatPort,
  insertSeedMemory,
  isoDaysAgo,
  judgeReply,
} from '../../../../domains/memory/supersede/__tests__/supersede-test-support.js';
import { jobRunSummaryFieldsFromBatchJobResult } from '../../batch-scheduler/batch-job-result-job-run-summary.js';
import type { BatchSchedulerRunContext } from '../batch-scheduler-run-context.js';
import { runSupersedeCandidateScan } from '../batch-scheduler-supersede-handlers.js';

const { resolveSupersedeLlm } = vi.hoisted(() => ({ resolveSupersedeLlm: vi.fn() }));
vi.mock('../../../../domains/memory/supersede/supersede-llm-resolver.js', () => ({ resolveSupersedeLlm }));

function context(db: Database.Database, enabled: boolean): BatchSchedulerRunContext {
  return {
    db,
    config: { supersedeCandidateScanEnabled: enabled },
    log: vi.fn(),
  } as unknown as BatchSchedulerRunContext;
}

describe('runSupersedeCandidateScan (#1548)', () => {
  let db: Database.Database;

  beforeEach(async () => {
    db = await createSupersedeTestDb();
    resolveSupersedeLlm.mockReset();
    insertSeedMemory(db, { id: 'old', content: '회의실은 3층이다.', createdAt: isoDaysAgo(10) });
    insertSeedMemory(db, { id: 'new', content: '회의실을 4층으로 옮겼다.', createdAt: isoDaysAgo(1), vec: [0.9, 0.1, 0] });
  });

  afterEach(() => closeSupersedeTestDb(db));

  it('flag 가 꺼져 있으면 LLM 설정도 호출도 없이 skipped 성공으로 끝난다', async () => {
    const result = await runSupersedeCandidateScan(context(db, false));

    expect(resolveSupersedeLlm).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      jobType: 'supersede_candidate_scan',
      success: true,
      processed: 0,
      warnings: ['disabled'],
      details: { status: 'skipped' },
    });
    expect(db.prepare('SELECT COUNT(*) AS n FROM llm_usage_logical').get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM memory_supersede_candidate').get()).toEqual({ n: 0 });
  });

  it('flag 가 켜져 있으면 판정 건수를 processed 와 job_run 요약에 남긴다', async () => {
    const port = fakeChatPort(() => judgeReply('confirmed'));
    resolveSupersedeLlm.mockResolvedValue({ port, model: 'test-model' });

    const result = await runSupersedeCandidateScan(context(db, true));

    expect(port.calls).toHaveLength(1);
    expect(result).toMatchObject({ success: true, processed: 1, errors: [] });
    const summary = jobRunSummaryFieldsFromBatchJobResult(result);
    expect(JSON.parse(summary.details_json!)).toMatchObject({
      status: 'completed',
      pairsConsidered: 1,
      judged: 1,
      byVerdict: { confirmed: 1, pending: 0, compatible: 0 },
    });
  });

  it('LLM 이 설정되지 않으면 not_configured 경고로 성공 처리하고 호출하지 않는다', async () => {
    resolveSupersedeLlm.mockResolvedValue(null);

    const result = await runSupersedeCandidateScan(context(db, true));

    expect(result).toMatchObject({ success: true, processed: 0, details: { status: 'not_configured' } });
    expect(result.warnings).toEqual(['not_configured']);
  });

  it('429 로 미뤄지면 deferred 경고를 남기되 job 은 실패시키지 않는다', async () => {
    resolveSupersedeLlm.mockResolvedValue({
      port: fakeChatPort(() => new Error('429 rate limit exceeded')),
      model: 'test-model',
    });

    const result = await runSupersedeCandidateScan(context(db, true));

    expect(result).toMatchObject({ success: true, processed: 0, details: { status: 'deferred' } });
    expect(result.warnings).toEqual(['deferred']);
  });
});
