#!/usr/bin/env node
import { isMain } from './lib/cli.js';
/**
 * #922 decision-neutral baseline: 6 relevant + 6 unrelated queries on benchmark-v3 + overlay.
 * Machine-readable JSON on stdout; no rejection gate or pass/fail latency threshold.
 */

import { writeFileSync } from 'fs';
import { measureRejectionBaseline } from './lib/rejection-baseline-measurement.js';
import {
  createRejectionBaselineDatabase,
  createRejectionBaselineUnitTestDatabase,
  loadRejectionBaselineOverlay,
  REJECTION_BASELINE_DIR,
} from './lib/rejection-baseline-database.js';

export function emitRejectionBaselineJson(json: string): void {
  process.stdout.write(`${json}\n`);
}

export async function runRejectionBaselineMeasurement(options?: {
  jsonOutPath?: string;
  unitTest?: boolean;
}): Promise<string> {
  const seeded = options?.unitTest
    ? await createRejectionBaselineUnitTestDatabase()
    : await createRejectionBaselineDatabase();
  try {
    const overlay = loadRejectionBaselineOverlay();
    const report = await measureRejectionBaseline(seeded.db, REJECTION_BASELINE_DIR, {
      overlayCorpus: overlay,
      parentDocumentCount: seeded.parentDocumentCount,
      vectorDims: seeded.vectorDims,
    });
    const json = JSON.stringify(report, null, 2);
    if (options?.jsonOutPath) {
      writeFileSync(options.jsonOutPath, `${json}\n`, 'utf8');
    }
    return json;
  } finally {
    seeded.close();
  }
}

async function main(): Promise<void> {
  const jsonOut = process.env.MEMENTO_REJECTION_BASELINE_JSON?.trim();
  const unitTest = process.env.MEMENTO_REJECTION_BASELINE_UNIT_TEST === '1';
  const report = await runRejectionBaselineMeasurement({
    jsonOutPath: jsonOut || undefined,
    unitTest,
  });
  emitRejectionBaselineJson(report);
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
