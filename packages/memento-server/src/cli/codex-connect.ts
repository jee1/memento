import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import {
  applyCodexHooks,
  diagnoseCodex,
  planCodexHooks,
  type CodexHooksSettings,
} from '@memento/agent-integration';

interface Dependencies {
  probe?: () => CodexProbe;
  write?: (message: string) => void | Promise<void>;
  env?: NodeJS.ProcessEnv;
}

interface CodexProbe {
  versionOutput: string;
  featuresOutput: string;
}

function runCodex(args: readonly string[]): string {
  const result = spawnSync('codex', args, {
    encoding: 'utf8',
    stdio: 'pipe',
    timeout: 5_000,
  });
  return `${result.stdout ?? ''}${result.stderr ?? ''}`;
}

function defaultProbe(): CodexProbe {
  return {
    versionOutput: runCodex(['--version']),
    featuresOutput: runCodex(['features', 'list']),
  };
}

function options(argv: readonly string[], env: NodeJS.ProcessEnv): {
  dryRun: boolean;
  hooksPath: string;
} {
  let dryRun = false;
  let hooksPath = join(env.HOME ?? homedir(), '.codex', 'hooks.json');
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') dryRun = true;
    else if (arg === '--hooks-path' && argv[index + 1]) {
      hooksPath = argv[index + 1]!;
      index += 1;
    } else {
      throw new Error(`Unknown connect codex option: ${arg}`);
    }
  }
  return { dryRun, hooksPath };
}

async function readSettings(path: string): Promise<CodexHooksSettings> {
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    return JSON.parse(await readFile(path, 'utf8')) as CodexHooksSettings;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw error;
  }
}

export async function runCodexConnect(
  argv: readonly string[],
  dependencies: Dependencies = {},
): Promise<number> {
  const write = dependencies.write ?? (message => process.stdout.write(message));
  try {
    const parsed = options(argv, dependencies.env ?? process.env);
    const current = await readSettings(parsed.hooksPath);
    const plan = planCodexHooks(current, { hooksPath: parsed.hooksPath });
    const probe = (dependencies.probe ?? defaultProbe)();
    const diagnostic = diagnoseCodex({
      ...probe,
      configuredEvents: Object.keys(plan.settings.hooks ?? {}),
    });
    const applied = parsed.dryRun
      ? plan
      : await applyCodexHooks({ hooksPath: parsed.hooksPath });
    await write(`${JSON.stringify({
      agent: 'codex',
      hooksPath: parsed.hooksPath,
      dryRun: parsed.dryRun,
      compatible: diagnostic.compatible,
      trustApproval: diagnostic.trustApproval,
      version: diagnostic.version,
      hooksFeature: diagnostic.hooksFeature,
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
    const message = error instanceof Error ? error.message : 'Codex connection failed';
    await write(`${JSON.stringify({ agent: 'codex', error: message })}\n`);
    return 1;
  }
}
