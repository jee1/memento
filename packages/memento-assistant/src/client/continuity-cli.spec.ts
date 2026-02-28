import { describe, expect, it, vi, beforeEach } from 'vitest';
import { runCli } from './continuity-cli.js';

describe('continuity-cli', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('resume command should print four continuity sections', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          result: {
            snapshot: {
              project: 'memento',
              resume: [{ title: 'task: one', summary: 'Task one', memoryIds: ['m1'] }],
              recentDecisions: [{ title: 'decision: use recall', summary: 'Use recall', memoryIds: ['m2'] }],
              openThreads: [],
              nextActions: [{ title: 'next-step: add test', summary: 'Add test', memoryIds: ['m3'] }],
            },
          },
        }),
    }));
    vi.stubGlobal('process', {
      ...process,
      env: { ...process.env, MEMENTO_ASSISTANT_URL: 'http://localhost:8090' },
    });

    const output = await runCli(['node', 'continuity-cli', 'resume', '--project', 'memento']);
    expect(output).toContain('Resume');
    expect(output).toContain('Recent Decisions');
    expect(output).toContain('Open Threads');
    expect(output).toContain('Next Actions');
  });
});
