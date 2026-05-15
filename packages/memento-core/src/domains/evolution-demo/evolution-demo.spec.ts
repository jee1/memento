import { describe, it, expect } from 'vitest';
import {
  getEvolutionDemoSnapshot,
  listEvolutionDemoScenarios,
  EvolutionDemoNotFoundError,
  EvolutionDemoSnapshotSchema,
} from './index.js';

describe('evolution-demo getters', () => {
  it('lists answer-over-time scenario with early, mid, late points', () => {
    const catalog = listEvolutionDemoScenarios();
    expect(catalog.scenarios).toHaveLength(1);
    const scenario = catalog.scenarios[0];
    expect(scenario?.scenario_id).toBe('answer-over-time');
    expect(scenario?.points.map(p => p.point_id)).toEqual(['early', 'mid', 'late']);
  });

  it('returns snapshot for each point with same question and different answers', () => {
    const early = getEvolutionDemoSnapshot('answer-over-time', 'early');
    const mid = getEvolutionDemoSnapshot('answer-over-time', 'mid');
    const late = getEvolutionDemoSnapshot('answer-over-time', 'late');

    expect(early.question).toBe(mid.question);
    expect(mid.question).toBe(late.question);
    expect(early.answer).not.toBe(mid.answer);
    expect(mid.answer).not.toBe(late.answer);
    expect(EvolutionDemoSnapshotSchema.safeParse(early).success).toBe(true);
    expect(EvolutionDemoSnapshotSchema.safeParse(late).success).toBe(true);
  });

  it('throws EvolutionDemoNotFoundError for unknown scenario or point', () => {
    expect(() => getEvolutionDemoSnapshot('missing', 'early')).toThrow(
      EvolutionDemoNotFoundError
    );
    expect(() => getEvolutionDemoSnapshot('answer-over-time', 'missing')).toThrow(
      EvolutionDemoNotFoundError
    );
  });
});
