import { describe, it, expect, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import type { ToolContext } from '../../../../tools/types.js';
import type { RememberToolHost } from '../remember-tool-host.js';
import { runTripleExtraction, type AugmentationParams } from '../remember-tool-augmentation.js';

function createHost(): RememberToolHost & {
  logInfo: ReturnType<typeof vi.fn>;
  logWarning: ReturnType<typeof vi.fn>;
} {
  return {
    logInfo: vi.fn(),
    logWarning: vi.fn(),
    logError: vi.fn(),
    createSuccessResult: vi.fn(),
    createErrorResult: vi.fn(),
  };
}

function createContext(): ToolContext & {
  services: {
    batchScheduler: {
      addJob: ReturnType<typeof vi.fn>;
      isJobQueued: ReturnType<typeof vi.fn>;
      isJobRunning: ReturnType<typeof vi.fn>;
      getStatus: ReturnType<typeof vi.fn>;
    };
  };
} {
  return {
    services: {
      batchScheduler: {
        addJob: vi.fn(() => true),
        isJobQueued: vi.fn(() => false),
        isJobRunning: vi.fn(() => false),
        getStatus: vi.fn(() => ({ isRunning: true })),
      },
    },
  } as ToolContext & {
    services: {
      batchScheduler: {
        addJob: ReturnType<typeof vi.fn>;
        isJobQueued: ReturnType<typeof vi.fn>;
        isJobRunning: ReturnType<typeof vi.fn>;
        getStatus: ReturnType<typeof vi.fn>;
      };
    };
  };
}

function createParams(overrides: Partial<AugmentationParams> = {}): AugmentationParams {
  return {
    dbRef: new Database(':memory:'),
    savedMemoryId: 'mem_test',
    savedMemoryType: 'episodic',
    content: 'harmless test content',
    importance: 0.5,
    enable_triple_extraction: true,
    ...overrides,
  };
}

describe('runTripleExtraction TRIPLE_EXTRACTION_ENABLED gate (#1230)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('skips when TRIPLE_EXTRACTION_ENABLED=false (Test D)', async () => {
    vi.stubEnv('TRIPLE_EXTRACTION_ENABLED', 'false');

    const host = createHost();
    const context = createContext();
    const params = createParams();

    await runTripleExtraction(params, context, host);

    expect(host.logInfo).not.toHaveBeenCalled();
    expect(host.logWarning).not.toHaveBeenCalled();
    expect(context.services.batchScheduler.addJob).not.toHaveBeenCalled();
  });

  it('runs when env unset and enable_triple_extraction=true (Test E)', async () => {
    const host = createHost();
    const context = createContext();
    const params = createParams();

    await runTripleExtraction(params, context, host);

    expect(
      host.logInfo.mock.calls.length + context.services.batchScheduler.addJob.mock.calls.length
    ).toBeGreaterThan(0);
  });

  it('skips when enable_triple_extraction=false (Test F)', async () => {
    const host = createHost();
    const context = createContext();
    const params = createParams({ enable_triple_extraction: false });

    await runTripleExtraction(params, context, host);

    expect(host.logInfo).not.toHaveBeenCalled();
    expect(host.logWarning).not.toHaveBeenCalled();
    expect(context.services.batchScheduler.addJob).not.toHaveBeenCalled();
  });
});
