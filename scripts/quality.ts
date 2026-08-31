#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isMain, parseArgs } from './lib/cli.js';

interface QualityCommand {
  script: string;
  args?: string[];
}

const COMMANDS: Record<string, QualityCommand> = {
  'benchmark:export': { script: 'export-search-quality-benchmark.ts' },
  'benchmark:candidates': { script: 'generate-search-quality-candidates.ts' },
  'benchmark:checklist': { script: 'generate-search-quality-review-checklist.ts' },
  'benchmark:verify-review': { script: 'verify-search-quality-benchmark-review.ts' },
  'benchmark:category-report': { script: 'quality-benchmark-category-report.ts' },
  'benchmark:verify-categories': { script: 'quality-benchmark-verify-categories.ts' },
  'benchmark:compare-profiles': { script: 'compare-weight-profiles.ts' },
  'benchmark:tune-weights': { script: 'tune-weights.ts' },
  'benchmark:tune-report': { script: 'tune-report.ts' },
  'longmemeval:acquire': { script: 'acquire-longmemeval.ts' },
  'longmemeval:validate': { script: 'longmemeval-validation.ts' },
  'locomo:acquire': { script: 'acquire-locomo.ts' },
  'locomo:benchmark': {
    script: 'agent-memory-benchmark.ts',
    args: ['--locomo', '.local/locomo/locomo10.json'],
  },
  'korean-gold:validate': {
    script: 'korean-gold-validate.ts',
    args: ['--fixture', 'tests/fixtures/agent-memory-benchmark-ko'],
  },
};

export function resolveQualityCommand(argv: string[]): { script: string; args: string[] } {
  const nested = argv[0]?.includes(':') ? argv[0] : `${argv[0] ?? ''}:${argv[1] ?? ''}`;
  const consumed = argv[0]?.includes(':') ? 1 : 2;
  const command = COMMANDS[nested];
  if (!command) {
    throw new Error(`Unknown quality command. Supported commands: ${Object.keys(COMMANDS).join(', ')}`);
  }
  const trailingArgs = argv.slice(consumed);
  if (trailingArgs[0] === '--') {
    trailingArgs.shift();
  }
  return {
    script: command.script,
    args: [...(command.args ?? []), ...trailingArgs],
  };
}

export function runQuality(argv = parseArgs().args): number {
  const command = resolveQualityCommand(argv);
  const scriptPath = fileURLToPath(new URL(command.script, import.meta.url));
  const result = spawnSync(process.execPath, ['--import', 'tsx', scriptPath, ...command.args], {
    stdio: 'inherit',
  });
  return result.status ?? 1;
}

if (isMain(import.meta.url)) {
  try {
    process.exitCode = runQuality();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
