import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

import type { AgentEventScope } from '../types.js';
import type { ClaudeScopeOptions } from './types.js';

function explicit(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
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
  const issue = branch.match(/(?:^|\/)(issue-\d+)(?:-|$)/i);
  return issue?.[1]?.toLowerCase() ?? branch;
}

export function detectClaudeCodeScope(
  cwd: string,
  options: ClaudeScopeOptions = {},
): AgentEventScope {
  const env = options.env ?? process.env;
  const git = options.git ?? defaultGit;
  const project = explicit(env.MEMENTO_PROJECT_ID)
    ?? normalizeRemote(git(['config', '--get', 'remote.origin.url'], cwd))
    ?? explicit(git(['rev-parse', '--show-toplevel'], cwd))
    ?? resolve(cwd);
  const processId = explicit(env.MEMENTO_PROCESS_ID)
    ?? processFromBranch(explicit(git(['branch', '--show-current'], cwd)));

  return {
    ...(explicit(env.MEMENTO_OWNER_ID) ? { owner_id: explicit(env.MEMENTO_OWNER_ID) } : {}),
    ...(project ? { project_id: project } : {}),
    ...(processId ? { process_id: processId } : {}),
  };
}
