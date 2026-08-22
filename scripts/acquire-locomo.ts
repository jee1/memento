#!/usr/bin/env node
import { isMain, parseArgs as parseCliArgs } from './lib/cli.js';

import { createHash } from 'node:crypto';
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

export const LOCOMO_DATASET_REVISION = '3eb6f2c585f5e1699204e3c3bdf7adc5c28cb376';
export const LOCOMO_DATASET_FILE = 'locomo10.json';
export const LOCOMO_LICENSE = 'CC BY-NC 4.0';

/**
 * LoCoMo is Creative Commons Attribution-NonCommercial 4.0. The raw file and any
 * corpus derived from it stay out of the repository (`.local/locomo/` is
 * gitignored) and published reports carry aggregates only — never conversation
 * text. See docs/quality/benchmark-datasets.md.
 */
export function buildLoCoMoDatasetUrl(
  revision: string = LOCOMO_DATASET_REVISION,
): string {
  return [
    'https://raw.githubusercontent.com/snap-research/locomo',
    revision,
    'data',
    LOCOMO_DATASET_FILE,
  ].join('/');
}

export async function acquireLoCoMo(
  outputPath: string,
  revision: string = LOCOMO_DATASET_REVISION,
): Promise<void> {
  const resolvedOutput = resolve(outputPath);
  if (existsSync(resolvedOutput)) {
    throw new Error(`Refusing to overwrite existing dataset: ${resolvedOutput}`);
  }
  mkdirSync(dirname(resolvedOutput), { recursive: true });
  const url = buildLoCoMoDatasetUrl(revision);
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok || !response.body) {
    throw new Error(`Dataset download failed: HTTP ${response.status}`);
  }
  await pipeline(
    Readable.fromWeb(response.body),
    createWriteStream(resolvedOutput, { flags: 'wx' }),
  );
  const content = readFileSync(resolvedOutput);
  writeFileSync(
    join(dirname(resolvedOutput), 'acquisition-receipt.json'),
    `${JSON.stringify({
      schema_version: 1,
      source: url,
      revision,
      file: LOCOMO_DATASET_FILE,
      sha256: createHash('sha256').update(content).digest('hex'),
      bytes: content.byteLength,
      license: LOCOMO_LICENSE,
      license_url: `https://github.com/snap-research/locomo/blob/${revision}/LICENSE.txt`,
      commercial_use: false,
      dataset_card: 'https://github.com/snap-research/locomo',
      vendored: false,
    }, null, 2)}\n`,
    'utf8',
  );
}

async function main(): Promise<void> {
  const outputPath = parseCliArgs().args[0]
    ?? join(process.cwd(), '.local/locomo', LOCOMO_DATASET_FILE);
  const revision = parseCliArgs().args[1] ?? LOCOMO_DATASET_REVISION;
  await acquireLoCoMo(outputPath, revision);
  process.stdout.write(`${outputPath}\n`);
  process.stdout.write(
    `license: ${LOCOMO_LICENSE} — non-commercial use only; do not vendor or quote conversation text\n`,
  );
}

if (isMain(import.meta.url)) {
  await main();
}
