import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

import type { AgentEventScope } from '../types.js';
import type { CodexScopeOptions } from './types.js';

function value(input: string | undefined): string | undefined {
  const trimmed = input?.trim();
  return trimmed || undefined;
}

function defaultGit(args: readonly string[], cwd: string): string | undefined {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 500,
    }).trim() || undefined;
  } catch {
    return undefined;
  }
}

function normalizeRemote(remote: string | undefined): string | undefined {
  if (!remote) return undefined;
  const trimmed = remote.trim().replace(/\.git$/, '');
  const scp = trimmed.match(/^git@([^:]+):(.+)$/);
  if (scp) return `${scp[1]}/${scp[2]}`;
  try {
    const url = new URL(trimmed);
    return `${url.host}${url.pathname}`.replace(/\/$/, '');
  } catch {
    return trimmed;
  }
}

function processFromBranch(branch: string | undefined): string | undefined {
  if (!branch) return undefined;
  return branch.match(/(?:^|\/)(issue-\d+)(?:-|$)/i)?.[1]?.toLowerCase()
    ?? branch;
}

export function detectCodexScope(
  cwd: string,
  options: CodexScopeOptions = {},
): AgentEventScope {
  const env = options.env ?? process.env;
  const git = options.git ?? defaultGit;
  const projectId = value(env.MEMENTO_PROJECT_ID)
    ?? normalizeRemote(git(['config', '--get', 'remote.origin.url'], cwd))
    ?? value(git(['rev-parse', '--show-toplevel'], cwd))
    ?? resolve(cwd);
  const processId = value(env.MEMENTO_PROCESS_ID)
    ?? processFromBranch(value(git(['branch', '--show-current'], cwd)));

  return {
    ...(value(env.MEMENTO_OWNER_ID) ? { owner_id: value(env.MEMENTO_OWNER_ID) } : {}),
    project_id: projectId,
    ...(processId ? { process_id: processId } : {}),
  };
}
