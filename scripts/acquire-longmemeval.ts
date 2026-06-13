#!/usr/bin/env node

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

export const LONGMEMEVAL_DATASET_REVISION = '98d7416c24c778c2fee6e6f3006e7a073259d48f';
export const LONGMEMEVAL_DATASET_FILE = 'longmemeval_s_cleaned.json';

export function buildLongMemEvalDatasetUrl(
  revision: string = LONGMEMEVAL_DATASET_REVISION,
): string {
  return [
    'https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned/resolve',
    revision,
    LONGMEMEVAL_DATASET_FILE,
  ].join('/');
}

export async function acquireLongMemEval(
  outputPath: string,
  revision: string = LONGMEMEVAL_DATASET_REVISION,
): Promise<void> {
  const resolvedOutput = resolve(outputPath);
  if (existsSync(resolvedOutput)) {
    throw new Error(`Refusing to overwrite existing dataset: ${resolvedOutput}`);
  }
  mkdirSync(dirname(resolvedOutput), { recursive: true });
  const url = buildLongMemEvalDatasetUrl(revision);
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
      file: LONGMEMEVAL_DATASET_FILE,
      sha256: createHash('sha256').update(content).digest('hex'),
      bytes: content.byteLength,
      license: 'MIT',
      dataset_card: 'https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned',
      vendored: false,
    }, null, 2)}\n`,
    'utf8',
  );
}

async function main(): Promise<void> {
  const outputPath = process.argv[2]
    ?? join(process.cwd(), '.local/longmemeval', LONGMEMEVAL_DATASET_FILE);
  const revision = process.argv[3] ?? LONGMEMEVAL_DATASET_REVISION;
  await acquireLongMemEval(outputPath, revision);
  process.stdout.write(`${outputPath}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
