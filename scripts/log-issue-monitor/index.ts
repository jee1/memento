import { isMain } from '../lib/cli.js';
import { loadMonitorConfig } from './config.js';
import { GitHubIssueClient } from './github-client.js';
import { runMonitorCycle } from './monitor.js';
import { readDockerLogs, readJsonlFiles as readJsonlFilesFromSources } from './sources.js';
import type { MonitorConfig } from './types.js';

function isExecutedAsMainCli(): boolean {
  return isMain(import.meta.url);
}

export function createMonitorRuntime(env: NodeJS.ProcessEnv = process.env): {
  config: MonitorConfig;
  githubClient?: GitHubIssueClient;
} {
  const config = loadMonitorConfig(env);
  const githubClient =
    config.githubToken && !config.dryRun
      ? new GitHubIssueClient({ token: config.githubToken, repository: config.githubRepository })
      : undefined;

  return { config, githubClient };
}

export async function runForever(): Promise<void> {
  const { config, githubClient } = createMonitorRuntime();
  const run = async (): Promise<void> => {
    await runMonitorCycle(config, {
      readDockerLogs,
      readJsonlFiles: (logsRoot, cursors, maxReadBytes) =>
        readJsonlFilesFromSources(logsRoot, cursors, maxReadBytes ?? config.jsonlMaxReadBytes),
      githubClient,
      onMonitorError: error => {
        process.stderr.write(`log-issue-monitor error: ${error.message}\n`);
      },
    });
  };

  const githubSync = Boolean(config.githubToken && !config.dryRun);
  process.stderr.write(
    `log-issue-monitor started for ${config.containerName}; interval=${config.intervalSeconds}s dryRun=${config.dryRun} githubSync=${githubSync}\n`,
  );

  for (;;) {
    await run();
    await new Promise(resolve => setTimeout(resolve, config.intervalSeconds * 1000));
  }
}

if (isExecutedAsMainCli()) {
  runForever().catch(error => {
    process.stderr.write(`log-issue-monitor fatal: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
