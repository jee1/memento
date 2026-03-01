import { describe, expect, it } from 'vitest';
import type { ResumeSnapshot } from '../../types.js';
import { ResumeSnapshotService } from '../resume-snapshot-service.js';

describe('ResumeSnapshotService', () => {
  it('session_id, process_id, continuity tags를 기준으로 resume snapshot을 구성한다', async () => {
    const mockItems = [
      { id: 'mem-1', content: 'Task: implement resume', tags: ['continuity', 'task'] },
      { id: 'mem-2', content: 'Decision: resume 엔진은 recall 기반으로 간다', tags: ['continuity', 'decision'] },
      { id: 'mem-3', content: 'Next: add E2E test', tags: ['continuity', 'next-step'] },
    ];
    const queryContinuityMemories = async () => mockItems;
    const service = new ResumeSnapshotService({ queryContinuityMemories });

    const snapshot = await service.build({
      project: 'memento',
      processId: 'cursor',
      sessionId: 'sess-1',
      branch: 'feature/resume',
    });

    expect(snapshot).toMatchObject({
      project: 'memento',
      sessionId: 'sess-1',
      resume: expect.any(Array),
      recentDecisions: expect.any(Array),
      openThreads: expect.any(Array),
      nextActions: expect.any(Array),
    } as ResumeSnapshot);
    expect(snapshot.resume.length).toBeGreaterThan(0);
    expect(snapshot.recentDecisions[0]?.title).toContain('decision');
    expect(snapshot.nextActions[0]?.summary.toLowerCase()).toContain('next');
  });
});
