import { describe, expect, it } from 'vitest';
import { createMonitorRuntime } from '../index.js';

describe('createMonitorRuntime', () => {
  it('creates a runtime without a GitHub client in local-only mode', () => {
    const runtime = createMonitorRuntime({
      GITHUB_TOKEN: '',
      LOG_ISSUE_MONITOR_DRY_RUN: 'true',
      LOG_ISSUE_MONITOR_LOGS_ROOT: '/tmp/logs',
    });

    expect(runtime.config.githubToken).toBeUndefined();
    expect(runtime.githubClient).toBeUndefined();
    expect(runtime.config.dryRun).toBe(true);
  });
});

