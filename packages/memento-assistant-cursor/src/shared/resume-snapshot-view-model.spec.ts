import { describe, expect, it } from 'vitest';

import { toResumeSnapshotViewModel } from './resume-snapshot-view-model.js';

describe('toResumeSnapshotViewModel', () => {
  it('maps a runtime snapshot into the four continuity sections', () => {
    const viewModel = toResumeSnapshotViewModel({
      project: 'memento',
      sessionId: 'sess-1',
      resume: [{ title: 'task: one', summary: 'Task one', memoryIds: ['m1'] }],
      recentDecisions: [{ title: 'decision: one', summary: 'Decision one', memoryIds: ['m2'] }],
      openThreads: [],
      nextActions: [{ title: 'next-step: one', summary: 'Next action', memoryIds: ['m3'] }],
    });

    expect(viewModel.header).toEqual({
      project: 'memento',
      sessionId: 'sess-1',
    });
    expect(viewModel.sections.map((section) => section.key)).toEqual([
      'resume',
      'recent-decisions',
      'open-threads',
      'next-actions',
    ]);
    expect(viewModel.sections[1]).toMatchObject({
      key: 'recent-decisions',
      title: 'Recent Decisions',
      items: [{ title: 'decision: one', summary: 'Decision one', memoryIds: ['m2'] }],
      emptyMessage: 'No recent decisions.',
    });
  });
});
