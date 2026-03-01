import { describe, expect, it, vi } from 'vitest';

import { ResumePanelProvider } from './resume-panel-provider.js';

describe('ResumePanelProvider', () => {
  it('loads a snapshot from the runtime client and renders the four continuity sections', async () => {
    const resume = vi.fn().mockResolvedValue({
      snapshot: {
        project: 'memento',
        sessionId: 'sess-1',
        resume: [{ title: 'task: one', summary: 'Task one', memoryIds: ['m1'] }],
        recentDecisions: [{ title: 'decision: one', summary: 'Decision one', memoryIds: ['m2'] }],
        openThreads: [],
        nextActions: [{ title: 'next-step: one', summary: 'Next step', memoryIds: ['m3'] }],
      },
    });

    const provider = new ResumePanelProvider({
      client: { resume } as never,
      context: {
        project: 'memento',
        branch: 'feature/host-adapter',
        session_id: 'sess-1',
        process_id: 'cursor',
      },
    });

    const html = await provider.refresh();

    expect(resume).toHaveBeenCalledWith({
      project: 'memento',
      branch: 'feature/host-adapter',
      session_id: 'sess-1',
      process_id: 'cursor',
    });
    expect(html).toContain('Memento Assistant');
    expect(html).toContain('Resume');
    expect(html).toContain('Recent Decisions');
    expect(html).toContain('Open Threads');
    expect(html).toContain('Next Actions');
    expect(html).toContain('task: one');
    expect(provider.getState()).toMatchObject({ status: 'ready' });
  });

  it('renders an empty state when the snapshot has no items', async () => {
    const provider = new ResumePanelProvider({
      client: {
        resume: vi.fn().mockResolvedValue({
          snapshot: {
            project: 'memento',
            resume: [],
            recentDecisions: [],
            openThreads: [],
            nextActions: [],
          },
        }),
      } as never,
      context: {
        project: 'memento',
        process_id: 'cursor',
      },
    });

    const html = await provider.refresh();

    expect(html).toContain('No continuity snapshot found');
    expect(provider.getState()).toMatchObject({ status: 'empty' });
  });

  it('renders an error state when the runtime client fails', async () => {
    const provider = new ResumePanelProvider({
      client: {
        resume: vi.fn().mockRejectedValue(new Error('runtime unavailable')),
      } as never,
      context: {
        project: 'memento',
        process_id: 'cursor',
      },
    });

    const html = await provider.refresh();

    expect(html).toContain('Could not load snapshot');
    expect(html).toContain('runtime unavailable');
    expect(provider.getState()).toMatchObject({
      status: 'error',
      message: 'runtime unavailable',
    });
  });

  it('delegates save action to the runtime client and refreshes the panel', async () => {
    const save = vi.fn().mockResolvedValue({ memory_id: 'mem-2' });
    const resume = vi.fn().mockResolvedValue({
      snapshot: {
        project: 'memento',
        sessionId: 'sess-1',
        resume: [],
        recentDecisions: [{ title: 'decision: one', summary: 'Decision one', memoryIds: ['m2'] }],
        openThreads: [],
        nextActions: [],
      },
    });

    const provider = new ResumePanelProvider({
      client: { save, resume } as never,
      context: {
        project: 'memento',
        session_id: 'sess-1',
        process_id: 'cursor',
        branch: 'feature/host-adapter',
      },
    });

    const html = await provider.handleAction({
      type: 'save',
      payload: {
        kind: 'decision',
        content: 'Use host adapter',
      },
    });

    expect(save).toHaveBeenCalledWith({
      kind: 'decision',
      content: 'Use host adapter',
      project: 'memento',
      session_id: 'sess-1',
      process_id: 'cursor',
      branch: 'feature/host-adapter',
    });
    expect(resume).toHaveBeenCalledTimes(1);
    expect(html).toContain('decision: one');
  });

  it('delegates start and end actions and keeps session context in sync', async () => {
    const start = vi.fn().mockResolvedValue({ session_id: 'sess-2', memory_id: 'mem-1' });
    const end = vi.fn().mockResolvedValue({ session_id: 'sess-2', memory_id: 'mem-3' });
    const resume = vi.fn()
      .mockResolvedValueOnce({
        snapshot: {
          project: 'memento',
          sessionId: 'sess-2',
          resume: [{ title: 'task: active', summary: 'Active task', memoryIds: ['m1'] }],
          recentDecisions: [],
          openThreads: [],
          nextActions: [],
        },
      })
      .mockResolvedValueOnce({
        snapshot: {
          project: 'memento',
          sessionId: 'sess-2',
          resume: [],
          recentDecisions: [],
          openThreads: [],
          nextActions: [{ title: 'next-step: wrap', summary: 'Wrap up', memoryIds: ['m3'] }],
        },
      });

    const provider = new ResumePanelProvider({
      client: { start, end, resume } as never,
      context: {
        project: 'memento',
        process_id: 'cursor',
        branch: 'feature/host-adapter',
      },
    });

    await provider.handleAction({
      type: 'start',
      payload: { session_id: 'sess-2' },
    });

    const endHtml = await provider.handleAction({
      type: 'end',
      payload: { summary: 'Done for now' },
    });

    expect(start).toHaveBeenCalledWith({
      project: 'memento',
      session_id: 'sess-2',
      process_id: 'cursor',
      branch: 'feature/host-adapter',
    });
    expect(end).toHaveBeenCalledWith({
      project: 'memento',
      session_id: 'sess-2',
      process_id: 'cursor',
      branch: 'feature/host-adapter',
      summary: 'Done for now',
    });
    expect(provider.getState()).toMatchObject({
      status: 'ready',
      viewModel: {
        header: {
          sessionId: 'sess-2',
        },
      },
    });
    expect(endHtml).toContain('next-step: wrap');
  });
});
