import type { Readable } from 'node:stream';

import { runCodexHook } from '@memento/agent-integration';

import { runAgentHookCommand } from './agent-hook-command.js';

export function runCodexHookCommand(
  stream: Readable = process.stdin,
): Promise<number> {
  return runAgentHookCommand(runCodexHook, stream);
}
