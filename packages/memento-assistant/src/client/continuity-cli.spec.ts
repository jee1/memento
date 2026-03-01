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

  it('accepts --process as alias for --process_id and passes process_id to resume', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          result: {
            snapshot: {
              project: 'proj',
              resume: [],
              recentDecisions: [],
              openThreads: [],
              nextActions: [],
            },
          },
        }),
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('process', {
      ...process,
      env: { ...process.env, MEMENTO_ASSISTANT_URL: 'http://localhost:8090' },
    });

    await runCli(['node', 'continuity-cli', 'resume', '--project', 'proj', '--process', 'pid-123']);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8090/assistant/tools/resume_session',
      expect.objectContaining({
        method: 'POST',
        body: expect.any(String),
      })
    );
    const init = fetchMock.mock.calls[0]?.[1];
    const body = init && typeof init.body === 'string' ? JSON.parse(init.body) : {};
    expect(body).toMatchObject({ project: 'proj', process_id: 'pid-123' });
  });

  it('accepts --process_id and passes process_id to resume', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          result: {
            snapshot: {
              project: 'p',
              resume: [],
              recentDecisions: [],
              openThreads: [],
              nextActions: [],
            },
          },
        }),
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('process', {
      ...process,
      env: { ...process.env, MEMENTO_ASSISTANT_URL: 'http://localhost:8090' },
    });

    await runCli(['node', 'continuity-cli', 'resume', '--project', 'p', '--process_id', 'pid-456']);
    const init = fetchMock.mock.calls[0]?.[1];
    const body = init && typeof init.body === 'string' ? JSON.parse(init.body) : {};
    expect(body).toMatchObject({ project: 'p', process_id: 'pid-456' });
  });
});
