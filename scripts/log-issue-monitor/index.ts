import { loadMonitorConfig } from './config.js';
import { GitHubIssueClient } from './github-client.js';
import { runMonitorCycle } from './monitor.js';
import { readDockerLogs, readJsonlFiles } from './sources.js';
import type { MonitorConfig } from './types.js';

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
      readJsonlFiles,
      githubClient,
      onMonitorError: error => {
        process.stderr.write(`log-issue-monitor error: ${error.message}\n`);
      },
    });
  };

  process.stderr.write(
    `log-issue-monitor started for ${config.containerName}; interval=${config.intervalSeconds}s dryRun=${config.dryRun}\n`,
  );

  while (true) {
    await run();
    await new Promise(resolve => setTimeout(resolve, config.intervalSeconds * 1000));
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runForever().catch(error => {
    process.stderr.write(`log-issue-monitor fatal: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}

