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

import { CLAUDE_CODE_HOOK_EVENTS, type ClaudeCodeHookEvent } from './types.js';

export interface ClaudeHookHandler {
  type: string;
  command?: string;
  timeout?: number;
  statusMessage?: string;
  [key: string]: unknown;
}

export interface ClaudeHookGroup {
  matcher?: string;
  hooks: ClaudeHookHandler[];
  [key: string]: unknown;
}

export interface ClaudeSettings {
  hooks?: Partial<Record<ClaudeCodeHookEvent | string, ClaudeHookGroup[]>>;
  [key: string]: unknown;
}

export interface ClaudeSettingsOptions {
  settingsPath: string;
  now?: () => Date;
}

export interface ClaudeSettingsPlan {
  settings: ClaudeSettings;
  changed: boolean;
  addedEvents: ClaudeCodeHookEvent[];
  backupTarget: string;
  diff: string;
}

export interface ClaudeSettingsApplyResult extends ClaudeSettingsPlan {
  backupPath?: string;
}

const MEMENTO_HANDLER: ClaudeHookHandler = {
  type: 'command',
  command: 'memento hook claude-code',
  timeout: 5,
  statusMessage: 'Memento lifecycle capture',
};

function cloneSettings(input: ClaudeSettings): ClaudeSettings {
  return JSON.parse(JSON.stringify(input)) as ClaudeSettings;
}

function isMementoHandler(handler: ClaudeHookHandler): boolean {
  return handler.command === 'memento hook claude-code';
}

function backupTarget(settingsPath: string, now: Date): string {
  const timestamp = now.toISOString().replace(/[-:.]/g, '');
  return `${settingsPath}.memento-backup-${timestamp}`;
}

export function planClaudeCodeSettings(
  existing: ClaudeSettings,
  options: ClaudeSettingsOptions,
): ClaudeSettingsPlan {
  const settings = cloneSettings(existing);
  settings.hooks ??= {};
  const addedEvents: ClaudeCodeHookEvent[] = [];

  for (const event of CLAUDE_CODE_HOOK_EVENTS) {
    const groups = settings.hooks[event] ?? [];
    const installed = groups.some(group =>
      Array.isArray(group.hooks) && group.hooks.some(isMementoHandler)
    );
    if (!installed) {
      groups.push({
        ...(event === 'PostToolUse' ? { matcher: '*' } : {}),
        hooks: [cloneSettings(MEMENTO_HANDLER) as ClaudeHookHandler],
      });
      settings.hooks[event] = groups;
      addedEvents.push(event);
    }
  }

  return {
    settings,
    changed: addedEvents.length > 0,
    addedEvents,
    diff: addedEvents
      .map(event => `+ ${event}: memento hook claude-code`)
      .join('\n'),
    backupTarget: backupTarget(
      options.settingsPath,
      options.now?.() ?? new Date(),
    ),
  };
}

export async function applyClaudeCodeSettings(
  options: ClaudeSettingsOptions,
): Promise<ClaudeSettingsApplyResult> {
  let raw = '{}\n';
  let existing: ClaudeSettings = {};
  let mode: number | undefined;
  let exists = false;
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    raw = await readFile(options.settingsPath, 'utf8');
    existing = JSON.parse(raw) as ClaudeSettings;
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    mode = (await stat(options.settingsPath)).mode;
    exists = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  const plan = planClaudeCodeSettings(existing, options);
  if (!plan.changed) return plan;

  // eslint-disable-next-line security/detect-non-literal-fs-filename
  await mkdir(dirname(options.settingsPath), { recursive: true });
  let backupPath: string | undefined;
  if (exists) {
    backupPath = plan.backupTarget;
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    await copyFile(options.settingsPath, backupPath);
  }

  const tempPath = `${options.settingsPath}.${process.pid}.tmp`;
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
  await rename(tempPath, options.settingsPath);

  return { ...plan, backupPath };
}
