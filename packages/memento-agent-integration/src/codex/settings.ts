import {
  chmod,
  copyFile,
  mkdir,
  readFile,
  rename,
  stat,
  writeFile,
} from 'node:fs/promises';
import { dirname } from 'node:path';

import { CODEX_HOOK_EVENTS, type CodexHookEvent } from './types.js';

export interface CodexHookHandler {
  type: string;
  command?: string;
  timeout?: number;
  [key: string]: unknown;
}

export interface CodexHookGroup {
  matcher?: string;
  hooks: CodexHookHandler[];
  [key: string]: unknown;
}

export interface CodexHooksSettings {
  hooks?: Partial<Record<CodexHookEvent | string, CodexHookGroup[]>>;
  [key: string]: unknown;
}

export interface CodexHooksOptions {
  hooksPath: string;
  now?: () => Date;
}

export interface CodexHooksPlan {
  settings: CodexHooksSettings;
  changed: boolean;
  addedEvents: CodexHookEvent[];
  backupTarget: string;
  diff: string;
}

export interface CodexHooksApplyResult extends CodexHooksPlan {
  backupPath?: string;
}

const HANDLER: CodexHookHandler = {
  type: 'command',
  command: 'memento hook codex',
  timeout: 5,
};

function clone<T>(input: T): T {
  return JSON.parse(JSON.stringify(input)) as T;
}

function backupTarget(path: string, now: Date): string {
  return `${path}.memento-backup-${now.toISOString().replace(/[-:.]/g, '')}`;
}

export function planCodexHooks(
  existing: CodexHooksSettings,
  options: CodexHooksOptions,
): CodexHooksPlan {
  const settings = clone(existing);
  settings.hooks ??= {};
  const addedEvents: CodexHookEvent[] = [];
  for (const event of CODEX_HOOK_EVENTS) {
    const groups = settings.hooks[event] ?? [];
    const installed = groups.some(group =>
      Array.isArray(group.hooks)
      && group.hooks.some(handler => handler.command === HANDLER.command));
    if (!installed) {
      groups.push({
        ...(event === 'SessionStart' ? { matcher: 'startup|resume|clear' } : {}),
        hooks: [clone(HANDLER)],
      });
      settings.hooks[event] = groups;
      addedEvents.push(event);
    }
  }
  return {
    settings,
    changed: addedEvents.length > 0,
    addedEvents,
    backupTarget: backupTarget(options.hooksPath, options.now?.() ?? new Date()),
    diff: addedEvents.map(event => `+ ${event}: memento hook codex`).join('\n'),
  };
}

export async function applyCodexHooks(
  options: CodexHooksOptions,
): Promise<CodexHooksApplyResult> {
  let existing: CodexHooksSettings = {};
  let mode: number | undefined;
  let exists = false;
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    existing = JSON.parse(await readFile(options.hooksPath, 'utf8')) as CodexHooksSettings;
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    mode = (await stat(options.hooksPath)).mode;
    exists = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const plan = planCodexHooks(existing, options);
  if (!plan.changed) return plan;
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  await mkdir(dirname(options.hooksPath), { recursive: true });
  let backupPath: string | undefined;
  if (exists) {
    backupPath = plan.backupTarget;
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    await copyFile(options.hooksPath, backupPath);
  }
  const tempPath = `${options.hooksPath}.${process.pid}.tmp`;
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  await writeFile(tempPath, `${JSON.stringify(plan.settings, null, 2)}\n`, {
    encoding: 'utf8',
    mode,
  });
  if (mode !== undefined) {
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    await chmod(tempPath, mode);
  }
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  await rename(tempPath, options.hooksPath);
  return { ...plan, backupPath };
}
