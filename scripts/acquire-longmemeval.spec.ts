import { describe, expect, it } from 'vitest';
import {
  buildLongMemEvalDatasetUrl,
  LONGMEMEVAL_DATASET_REVISION,
} from './acquire-longmemeval.js';

describe('LongMemEval acquisition', () => {
  it('pins the official cleaned dataset to an immutable Hugging Face revision', () => {
    expect(LONGMEMEVAL_DATASET_REVISION).toMatch(/^[a-f0-9]{40}$/);
    expect(buildLongMemEvalDatasetUrl()).toBe(
      `https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned/resolve/${LONGMEMEVAL_DATASET_REVISION}/longmemeval_s_cleaned.json`,
    );
  });
});
