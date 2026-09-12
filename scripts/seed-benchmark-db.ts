#!/usr/bin/env node
/** One-shot: seed benchmark-v3 to a persistent DB path for #961 tuning. */
import { join } from 'path';
import { createSeededBenchmarkDatabase } from './lib/benchmark-search-database.js';

async function main(): Promise<void> {
  const dbPath = process.argv[2];
  if (!dbPath) {
    console.error('Usage: npx tsx scripts/seed-benchmark-db.ts <dbPath>');
    process.exit(1);
  }
  const DIR = join(process.cwd(), 'tests/fixtures/search-quality/benchmark-v3');
  console.log('Seeding', DIR, '→', dbPath);
  const r = await createSeededBenchmarkDatabase(DIR, { dbPath });
  console.log('SEED_DONE', r.embeddingProvider, r.vectorDims);
  r.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
