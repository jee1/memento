#!/usr/bin/env node
import { parseArgs as parseCliArgs } from './lib/cli.js';

import { isAbsolute, join } from 'path';
import { verifyReviewableBenchmark } from '@memento/core/domains/monitoring/services/quality-assurance/search-quality-review-verifier.js';

interface CliOptions {
  benchmarkDir: string;
  requireReviewed: boolean;
  help: boolean;
}

function parseArgs(): CliOptions {
  const args = parseCliArgs().args;
  const options: CliOptions = {
    benchmarkDir: join(process.cwd(), 'tests', 'fixtures', 'search-quality', 'benchmark-v3'),
    requireReviewed: true,
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

    if (arg === '--allow-unreviewed') {
      options.requireReviewed = false;
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
Search quality benchmark review verifier

Usage:
  npm run quality -- benchmark verify-review
  npm run quality -- benchmark verify-review -- --benchmark-dir tests/fixtures/search-quality/benchmark-v3
  npm run quality -- benchmark verify-review -- --allow-unreviewed
`);
}

async function main(): Promise<void> {
  const options = parseArgs();

  if (options.help) {
    printHelp();
    return;
  }

  const result = verifyReviewableBenchmark(options.benchmarkDir, {
    requireReviewed: options.requireReviewed,
  });

  console.log(
    JSON.stringify(
      {
        ok: result.ok,
        summary: result.summary,
        errors: result.errors,
      },
      null,
      2
    )
  );

  if (!result.ok) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
