import { describe, expect, it, vi } from 'vitest';
import { createRuntimeCoreBridge } from './runtime-core-bridge.js';

describe('createRuntimeCoreBridge', () => {
  it('delegates remember payload to core client remember()', async () => {
    const coreClient = {
      remember: vi.fn().mockResolvedValue({ memory_id: 'mem-1' }),
      recall: vi.fn(),
    };

    const bridge = createRuntimeCoreBridge(coreClient);
    const result = await bridge.remember!({
      content: 'Session started',
      type: 'working',
      tags: ['continuity', 'task'],
    });

    expect(result).toEqual({ memory_id: 'mem-1' });
    expect(coreClient.remember).toHaveBeenCalledTimes(1);
  });

  it('queries core recall and maps continuity items for resume snapshot', async () => {
    const coreClient = {
      remember: vi.fn(),
      recall: vi.fn().mockResolvedValue({
        items: [
          {
            id: 'mem-1',
            content: 'Decision',
            tags: ['continuity', 'decision'],
            origin_source: { project: 'memento', branch: 'feature/resume' },
          },
        ],
      }),
    };

    const bridge = createRuntimeCoreBridge(coreClient);
    const items = await bridge.queryContinuityMemories!({
      project: 'memento',
      processId: 'cursor',
      sessionId: 'sess-1',
      branch: 'feature/resume',
    });

    expect(coreClient.recall).toHaveBeenCalledWith(
      expect.objectContaining({
        query: 'memento',
        filters: { tags: ['continuity'] },
      })
    );
    expect(items).toEqual([
      { id: 'mem-1', content: 'Decision', tags: ['continuity', 'decision'] },
    ]);
  });

  it('filters continuity items by origin_source.branch when branch is provided', async () => {
    const coreClient = {
      remember: vi.fn(),
      recall: vi.fn().mockResolvedValue({
        items: [
          {
            id: 'mem-1',
            content: 'Decision A',
            tags: ['continuity', 'decision'],
            origin_source: { project: 'memento', branch: 'feature/a' },
          },
          {
            id: 'mem-2',
            content: 'Decision B',
            tags: ['continuity', 'decision'],
            origin_source: { project: 'memento', branch: 'feature/b' },
          },
        ],
      }),
    };

    const bridge = createRuntimeCoreBridge(coreClient);

    const items = await bridge.queryContinuityMemories!({
      project: 'memento',
      sessionId: 'sess-1',
      branch: 'feature/a',
    });

    expect(coreClient.recall).toHaveBeenCalledWith(
      expect.objectContaining({
        query: 'memento',
        include_metadata: true,
      })
    );
    expect(items).toEqual([
      { id: 'mem-1', content: 'Decision A', tags: ['continuity', 'decision'] },
    ]);
  });

  it('excludes branchless continuity items when branch is specified', async () => {
    const coreClient = {
      remember: vi.fn(),
      recall: vi.fn().mockResolvedValue({
        items: [
          {
            id: 'mem-1',
            content: 'Decision A',
            tags: ['continuity', 'decision'],
            origin_source: { project: 'memento', branch: 'feature/a' },
          },
          {
            id: 'mem-2',
            content: 'Session ended',
            tags: ['continuity', 'next-step'],
          },
        ],
      }),
    };

    const bridge = createRuntimeCoreBridge(coreClient);
    const items = await bridge.queryContinuityMemories!({
      project: 'memento',
      sessionId: 'sess-1',
      branch: 'feature/a',
    });

    expect(items).toEqual([
      { id: 'mem-1', content: 'Decision A', tags: ['continuity', 'decision'] },
    ]);
  });

  it('keeps branchless continuity items when branch is not specified', async () => {
    const coreClient = {
      remember: vi.fn(),
      recall: vi.fn().mockResolvedValue({
        items: [
          { id: 'mem-1', content: 'Decision A', tags: ['continuity', 'decision'] },
        ],
      }),
    };

    const bridge = createRuntimeCoreBridge(coreClient);
    const items = await bridge.queryContinuityMemories!({ project: 'memento' });

    expect(items).toEqual([
      { id: 'mem-1', content: 'Decision A', tags: ['continuity', 'decision'] },
    ]);
  });
});
