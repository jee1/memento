import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildLoCoMoDatasetUrl,
  LOCOMO_DATASET_REVISION,
  LOCOMO_LICENSE,
} from './acquire-locomo.js';

describe('LoCoMo acquisition', () => {
  it('pins the dataset to an immutable snap-research/locomo revision', () => {
    expect(LOCOMO_DATASET_REVISION).toMatch(/^[a-f0-9]{40}$/);
    expect(buildLoCoMoDatasetUrl()).toBe(
      `https://raw.githubusercontent.com/snap-research/locomo/${LOCOMO_DATASET_REVISION}/data/locomo10.json`,
    );
  });

  it('records the NonCommercial license so downstream reports cannot claim otherwise', () => {
    expect(LOCOMO_LICENSE).toBe('CC BY-NC 4.0');
  });

  it('keeps the acquired dataset out of the repository', () => {
    const gitignore = readFileSync(join(process.cwd(), '.gitignore'), 'utf8');
    expect(gitignore).toMatch(/^\.local\/locomo\/$/m);
  });
});
