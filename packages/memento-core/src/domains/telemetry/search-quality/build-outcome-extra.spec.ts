import { describe, expect, it } from 'vitest';
import { SEARCH_QUALITY_EXTRA_KEYS } from './extra-keys.js';
import { recallOutcomeStageExtra } from './build-outcome-extra.js';

const keys = SEARCH_QUALITY_EXTRA_KEYS;

describe('recallOutcomeStageExtra', () => {
  it('copies measured lane times and keeps a finished 0', () => {
    expect(recallOutcomeStageExtra({
      stage_ms: { text_ms: 3, embedding_ms: 0, vector_ms: 4, gate_ms: 1 },
      query_time: 99,
    }, 2)).toEqual({
      [keys.text_ms]: 3,
      [keys.embedding_ms]: 0,
      [keys.vector_ms]: 4,
      [keys.gate_ms]: 1,
      [keys.post_ms]: 2,
    });
  });

  it('omits lanes that were not measured', () => {
    expect(recallOutcomeStageExtra({ stage_ms: { text_ms: 8 } }, 1)).toEqual({
      [keys.text_ms]: 8,
      [keys.post_ms]: 1,
    });
  });

  it('stores FTS query_time as text_ms when the hybrid lanes are absent', () => {
    expect(recallOutcomeStageExtra({ query_time: 15 }, 0)).toEqual({
      [keys.text_ms]: 15,
      [keys.post_ms]: 0,
    });
  });

  it('records only post_ms when the search result has no clocks', () => {
    expect(recallOutcomeStageExtra({ items: [] } as { query_time?: number }, 6)).toEqual({
      [keys.post_ms]: 6,
    });
    expect(recallOutcomeStageExtra(undefined, 6)).toEqual({ [keys.post_ms]: 6 });
  });
});
