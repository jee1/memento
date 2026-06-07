import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import {
  applyClaudeCodeSettings,
  diagnoseClaudeCode,
  planClaudeCodeSettings,
  type ClaudeSettings,
} from '@memento/agent-integration';

interface ClaudeProbe {
  versionOutput: string;
  helpOutput: string;
}

interface ConnectDependencies {
  probe?: () => ClaudeProbe;
  write?: (message: string) => void | Promise<void>;
  env?: NodeJS.ProcessEnv;
}

interface ConnectOptions {
  dryRun: boolean;
  settingsPath: string;
}

function defaultProbe(): ClaudeProbe {
  const version = spawnSync('claude', ['--version'], {
    encoding: 'utf8',
    stdio: 'pipe',
    timeout: 5_000,
  });
  const help = spawnSync('claude', ['--help'], {
    encoding: 'utf8',
    stdio: 'pipe',
    timeout: 5_000,
  });
  return {
    versionOutput: `${version.stdout ?? ''}${version.stderr ?? ''}`,
    helpOutput: `${help.stdout ?? ''}${help.stderr ?? ''}`,
  };
}

function parseOptions(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
): ConnectOptions {
  let dryRun = false;
  let settingsPath = join(env.HOME ?? homedir(), '.claude', 'settings.json');
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }
    if (arg === '--settings-path' && argv[index + 1]) {
      settingsPath = argv[index + 1]!;
      index += 1;
      continue;
    }
    throw new Error(`Unknown connect claude-code option: ${arg}`);
  }
  return { dryRun, settingsPath };
}

async function readSettings(settingsPath: string): Promise<ClaudeSettings> {
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    return JSON.parse(await readFile(settingsPath, 'utf8')) as ClaudeSettings;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw error;
  }
}

export async function runClaudeCodeConnect(
  argv: readonly string[],
  dependencies: ConnectDependencies = {},
): Promise<number> {
  const write = dependencies.write ?? (message => process.stdout.write(message));
  try {
    const options = parseOptions(argv, dependencies.env ?? process.env);
    const probe = (dependencies.probe ?? defaultProbe)();
    const existing = await readSettings(options.settingsPath);
    const plan = planClaudeCodeSettings(existing, {
      settingsPath: options.settingsPath,
    });
    const configuredEvents = Object.keys(plan.settings.hooks ?? {});
    const diagnostic = diagnoseClaudeCode({
      ...probe,
      configuredEvents,
    });
    const applied = options.dryRun
      ? plan
      : await applyClaudeCodeSettings({ settingsPath: options.settingsPath });
    await write(`${JSON.stringify({
      agent: 'claude-code',
      settingsPath: options.settingsPath,
      dryRun: options.dryRun,
      compatible: diagnostic.compatible,
      version: diagnostic.version,
      includeHookEvents: diagnostic.includeHookEvents,
      missingEvents: diagnostic.missingEvents,
      warnings: diagnostic.warnings,
      changed: applied.changed,
      addedEvents: applied.addedEvents,
      diff: applied.diff,
      backupPath: 'backupPath' in applied ? applied.backupPath : undefined,
      backupTarget: applied.backupTarget,
    })}\n`);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Claude Code connection failed';
    await write(`${JSON.stringify({ agent: 'claude-code', error: message })}\n`);
    return 1;
  }
}
