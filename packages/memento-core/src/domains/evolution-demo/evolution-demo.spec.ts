import { describe, it, expect } from 'vitest';
import {
  getEvolutionDemoSnapshot,
  listEvolutionDemoScenarios,
  EvolutionDemoNotFoundError,
  EvolutionDemoSnapshotSchema,
} from './index.js';

describe('evolution-demo getters', () => {
  it('lists answer-over-time and episodic-to-semantic scenarios', () => {
    const catalog = listEvolutionDemoScenarios();
    expect(catalog.scenarios).toHaveLength(2);

    const answerOverTime = catalog.scenarios.find(
      s => s.scenario_id === 'answer-over-time'
    );
    expect(answerOverTime?.points.map(p => p.point_id)).toEqual([
      'early',
      'mid',
      'late',
    ]);

    const consolidation = catalog.scenarios.find(
      s => s.scenario_id === 'episodic-to-semantic'
    );
    expect(consolidation?.title).toBe('Episodic to semantic consolidation');
    expect(consolidation?.points.map(p => p.point_id)).toEqual(['before', 'after']);
  });

  it('returns snapshot for each answer-over-time point with same question and different answers', () => {
    const early = getEvolutionDemoSnapshot('answer-over-time', 'early');
    const mid = getEvolutionDemoSnapshot('answer-over-time', 'mid');
    const late = getEvolutionDemoSnapshot('answer-over-time', 'late');

    expect(early.question).toBe(mid.question);
    expect(mid.question).toBe(late.question);
    expect(early.answer).not.toBe(mid.answer);
    expect(mid.answer).not.toBe(late.answer);
    expect(EvolutionDemoSnapshotSchema.safeParse(early).success).toBe(true);
    expect(EvolutionDemoSnapshotSchema.safeParse(late).success).toBe(true);
    expect(early.episodic_sources).toBeUndefined();
    expect(early.semantic_result).toBeUndefined();
  });

  it('returns episodic-to-semantic before snapshot with episodic_sources and search_comparison', () => {
    const before = getEvolutionDemoSnapshot('episodic-to-semantic', 'before');

    expect(EvolutionDemoSnapshotSchema.safeParse(before).success).toBe(true);
    expect(before.episodic_sources).toBeDefined();
    expect(before.episodic_sources!.length).toBeGreaterThanOrEqual(3);
    expect(before.episodic_sources![0]).toMatchObject({
      id: expect.any(String),
      summary: expect.any(String),
    });
    expect(before.semantic_result).toBeUndefined();
    expect(before.search_comparison).toMatchObject({
      before_summary: expect.stringContaining('episodic'),
      after_summary: expect.any(String),
    });
  });

  it('returns episodic-to-semantic after snapshot with semantic_result and search_comparison', () => {
    const after = getEvolutionDemoSnapshot('episodic-to-semantic', 'after');

    expect(EvolutionDemoSnapshotSchema.safeParse(after).success).toBe(true);
    expect(after.episodic_sources).toBeDefined();
    expect(after.episodic_sources!.length).toBe(after.semantic_result!.source_count);
    expect(after.semantic_result).toMatchObject({
      id: expect.any(String),
      summary: expect.any(String),
      source_count: 4,
      explanation: expect.any(String),
    });
    expect(after.search_comparison?.after_summary).toContain('semantic');
  });

  it('throws EvolutionDemoNotFoundError for unknown scenario or point', () => {
    expect(() => getEvolutionDemoSnapshot('missing', 'early')).toThrow(
      EvolutionDemoNotFoundError
    );
    expect(() => getEvolutionDemoSnapshot('answer-over-time', 'missing')).toThrow(
      EvolutionDemoNotFoundError
    );
    expect(() => getEvolutionDemoSnapshot('episodic-to-semantic', 'missing')).toThrow(
      EvolutionDemoNotFoundError
    );
  });
});
