import { join } from 'node:path';

import type { DirectiveConfig } from './types.js';

const expandHome = (path: string, home: string): string =>
  path === '~' ? home : path.startsWith('~/') ? join(home, path.slice(2)) : path;

export function parseDirectiveConfig(env: NodeJS.ProcessEnv, homedir: string): DirectiveConfig {
  const flag = env.MEMENTO_DIRECTIVES?.trim().toLowerCase();
  if (flag !== '1' && flag !== 'true') return { enabled: false };
  const pinned = env.MEMENTO_DIRECTIVES_PINNED_FILE?.trim();
  const logDir = env.MEMENTO_DIRECTIVES_LOG_DIR?.trim() || '~/.claude/state/directive-log';
  return {
    enabled: true,
    mode: env.MEMENTO_DIRECTIVES_MODE?.trim().toLowerCase() === 'live' ? 'live' : 'shadow',
    pinnedFile: pinned ? expandHome(pinned, homedir) : null,
    logDir: expandHome(logDir, homedir),
  };
}
