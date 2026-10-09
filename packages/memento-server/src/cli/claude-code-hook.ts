import type { Readable } from 'node:stream';

import { runClaudeCodeHook } from '@memento/agent-integration';

import { runAgentHookCommand } from './agent-hook-command.js';

export function runClaudeCodeHookCommand(
  stream: Readable = process.stdin,
): Promise<number> {
  return runAgentHookCommand(runClaudeCodeHook, stream);
}
