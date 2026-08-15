#!/usr/bin/env node

import { mkdirSync, writeFileSync } from 'fs';
import { isAbsolute, join } from 'path';
import { buildReviewChecklistMarkdown } from '@memento/core/shared/ops/search-quality-cli-helpers.js';

interface CliOptions {
  benchmarkDir: string;
  output?: string;
  help: boolean;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const options: CliOptions = {
    benchmarkDir: join(process.cwd(), 'tests', 'fixtures', 'search-quality', 'benchmark-v3'),
    help: false,
  };

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];

    if (arg === '--benchmark-dir' && args[index + 1]) {
      options.benchmarkDir = isAbsolute(args[index + 1])
        ? args[index + 1]
        : join(process.cwd(), args[index + 1]);
      index++;
      continue;
    }

    if (arg === '--output' && args[index + 1]) {
      options.output = isAbsolute(args[index + 1])
        ? args[index + 1]
        : join(process.cwd(), args[index + 1]);
      index++;
      continue;
    }

    if (arg === '--help' || arg === '-h') {
      options.help = true;
    }
  }

  return options;
}

function printHelp(): void {
  console.log(`
Search quality review checklist generator

Usage:
  npm run quality:benchmark:checklist
  npm run quality:benchmark:checklist -- --benchmark-dir tests/fixtures/search-quality/benchmark-v3
  npm run quality:benchmark:checklist -- --output review-checklist.md
`);
}

async function main(): Promise<void> {
  const options = parseArgs();

  if (options.help) {
    printHelp();
    return;
  }

  const outputPath = options.output ?? join(options.benchmarkDir, 'review-checklist.md');
  const markdown = buildReviewChecklistMarkdown(options.benchmarkDir);

  mkdirSync(join(outputPath, '..'), { recursive: true });
  writeFileSync(outputPath, markdown, 'utf-8');

  console.log(`Written: ${outputPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
