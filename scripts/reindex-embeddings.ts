import { parseArgs as parseCliArgs } from './lib/cli.js';
import { createMementoCore, EmbeddingReindexService, mementoConfig, type EmbeddingProvider } from '@memento/core';

function option(name: string): string | undefined {
  const index = parseCliArgs().args.indexOf(name);
  return index >= 0 ? parseCliArgs().args[index + 1] : undefined;
}

async function main(): Promise<void> {
  const provider = (option('--provider') ?? mementoConfig.embeddingProvider) as EmbeddingProvider;
  const batchSize = Number(option('--batch-size') ?? '100');
  const ownerId = option('--owner-id');
  const dryRun = parseCliArgs().args.includes('--dry-run');
  const core = await createMementoCore({ dbPath: process.env.DB_PATH ?? mementoConfig.dbPath });
  try {
    const service = new EmbeddingReindexService(core.db, core.services.embeddingService);
    const result = await service.reindex({ provider, batchSize, ownerId, dryRun });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (result.failedCount > 0) process.exitCode = 1;
  } finally {
    core.db.close();
  }
}

void main();
