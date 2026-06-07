import { CLAUDE_CODE_HOOK_EVENTS, type ClaudeCodeHookEvent } from './types.js';

const MINIMUM_VERSION = [2, 1, 153] as const;

export interface ClaudeCodeDiagnosticInput {
  versionOutput: string;
  helpOutput: string;
  configuredEvents: readonly string[];
}

export interface ClaudeCodeDiagnosticResult {
  compatible: boolean;
  version?: string;
  includeHookEvents: boolean;
  missingEvents: ClaudeCodeHookEvent[];
  warnings: string[];
}

function parseVersion(output: string): {
  text?: string;
  tuple?: [number, number, number];
} {
  const match = output.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) return {};
  return {
    text: `${match[1]}.${match[2]}.${match[3]}`,
    tuple: [Number(match[1]), Number(match[2]), Number(match[3])],
  };
}

function versionAtLeast(
  version: readonly number[],
  minimum: readonly number[],
): boolean {
  for (let index = 0; index < minimum.length; index += 1) {
    if ((version[index] ?? 0) > (minimum[index] ?? 0)) return true;
    if ((version[index] ?? 0) < (minimum[index] ?? 0)) return false;
  }
  return true;
}

export function diagnoseClaudeCode(
  input: ClaudeCodeDiagnosticInput,
): ClaudeCodeDiagnosticResult {
  const parsed = parseVersion(input.versionOutput);
  const includeHookEvents = input.helpOutput.includes('--include-hook-events');
  const configured = new Set(input.configuredEvents);
  const missingEvents = CLAUDE_CODE_HOOK_EVENTS
    .filter(event => !configured.has(event));
  const warnings: string[] = [];

  if (!parsed.tuple) warnings.push('Unable to parse Claude Code version.');
  else if (!versionAtLeast(parsed.tuple, MINIMUM_VERSION)) {
    warnings.push(`Claude Code ${parsed.text} is older than tested version 2.1.153.`);
  }
  if (!includeHookEvents) warnings.push('Claude Code lacks --include-hook-events.');
  if (missingEvents.length > 0) {
    warnings.push(`Missing lifecycle hooks: ${missingEvents.join(', ')}.`);
  }

  return {
    compatible: warnings.length === 0,
    ...(parsed.text ? { version: parsed.text } : {}),
    includeHookEvents,
    missingEvents,
    warnings,
  };
}
