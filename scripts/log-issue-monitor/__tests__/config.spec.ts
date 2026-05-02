import { describe, expect, it } from 'vitest';
import { loadMonitorConfig } from '../config.js';

describe('loadMonitorConfig', () => {
  it('uses safe defaults when optional environment variables are absent', () => {
    const config = loadMonitorConfig({});

    expect(config.containerName).toBe('memento-mcp-server');
    expect(config.githubRepository).toBe('jee1lee/memento');
    expect(config.intervalSeconds).toBe(30);
    expect(config.warnThreshold).toBe(3);
    expect(config.warnWindowSeconds).toBe(600);
    expect(config.dryRun).toBe(false);
    expect(config.labels).toEqual(['bug', 'needs-triage', 'memento-log-monitor']);
    expect(config.logsRoot).toBe('/logs');
    expect(config.stateDir).toBe('/logs/log-issue-monitor');
  });

  it('parses overrides and treats missing GitHub token as local-only capable', () => {
    const config = loadMonitorConfig({
      GITHUB_TOKEN: '',
      GITHUB_REPOSITORY: 'owner/repo',
      LOG_ISSUE_MONITOR_INTERVAL_SECONDS: '45',
      LOG_ISSUE_MONITOR_WARN_THRESHOLD: '5',
      LOG_ISSUE_MONITOR_WARN_WINDOW_SECONDS: '900',
      LOG_ISSUE_MONITOR_DRY_RUN: 'true',
      LOG_ISSUE_MONITOR_LABELS: 'bug,ops,monitor',
      LOG_ISSUE_MONITOR_LOGS_ROOT: '/tmp/logs',
      LOG_ISSUE_MONITOR_STATE_DIR: '/tmp/state',
      LOG_ISSUE_MONITOR_MAX_EXCERPT_BYTES: '1234',
      LOG_ISSUE_MONITOR_INCLUDE_STACK: 'false',
    });

    expect(config.githubToken).toBeUndefined();
    expect(config.githubRepository).toBe('owner/repo');
    expect(config.intervalSeconds).toBe(45);
    expect(config.warnThreshold).toBe(5);
    expect(config.warnWindowSeconds).toBe(900);
    expect(config.dryRun).toBe(true);
    expect(config.labels).toEqual(['bug', 'ops', 'monitor']);
    expect(config.logsRoot).toBe('/tmp/logs');
    expect(config.stateDir).toBe('/tmp/state');
    expect(config.maxExcerptBytes).toBe(1234);
    expect(config.includeStack).toBe(false);
  });
});
