import { describe, it, expect } from 'vitest';
import answerOverTimeFixture from './fixtures/answer-over-time.snapshots.json' with { type: 'json' };
import {
  getEvolutionDemoSnapshot,
  listEvolutionDemoScenarios,
  EvolutionDemoNotFoundError,
  EvolutionDemoSnapshotSchema,
} from './index.js';

const POINT_IDS = ['early', 'mid', 'late'] as const;

describe('evolution-demo getters', () => {
  it('lists answer-over-time scenario with early, mid, late points', () => {
    const catalog = listEvolutionDemoScenarios();
    expect(catalog.scenarios).toHaveLength(1);
    const scenario = catalog.scenarios[0];
    expect(scenario?.scenario_id).toBe('answer-over-time');
    expect(scenario?.title).toBe('시간 경과에 따른 답변 변화');
    expect(scenario?.points.map(p => p.point_id)).toEqual([...POINT_IDS]);
    expect(scenario?.points.map(p => p.label)).toEqual([
      '초기 (1일차)',
      '중기 (30일차)',
      '후기 (90일차)',
    ]);
  });

  it('returns snapshot for each point with same question and different answers', () => {
    const early = getEvolutionDemoSnapshot('answer-over-time', 'early');
    const mid = getEvolutionDemoSnapshot('answer-over-time', 'mid');
    const late = getEvolutionDemoSnapshot('answer-over-time', 'late');

    expect(early.question).toBe(mid.question);
    expect(mid.question).toBe(late.question);
    expect(early.question).toBe(answerOverTimeFixture.question);

    expect(early.answer).not.toBe(mid.answer);
    expect(mid.answer).not.toBe(late.answer);
    expect(early.answer).not.toBe(late.answer);

    expect(early.answer.length).toBeGreaterThan(mid.answer.length);
    expect(mid.answer.length).toBeGreaterThan(late.answer.length);
  });

  it('validates snapshot structure against spec schema for all points', () => {
    for (const pointId of POINT_IDS) {
      const snapshot = getEvolutionDemoSnapshot('answer-over-time', pointId);
      const parsed = EvolutionDemoSnapshotSchema.safeParse(snapshot);
      expect(parsed.success, `schema failed for ${pointId}`).toBe(true);
      expect(snapshot.scenario_id).toBe('answer-over-time');
      expect(snapshot.point_id).toBe(pointId);
      expect(snapshot.memory_summary.summary_text.length).toBeGreaterThan(0);
      expect(snapshot.explanation.length).toBeGreaterThan(0);
    }
  });

  it('tells a memory-evolution story: episodic fades, semantic grows', () => {
    const early = getEvolutionDemoSnapshot('answer-over-time', 'early');
    const mid = getEvolutionDemoSnapshot('answer-over-time', 'mid');
    const late = getEvolutionDemoSnapshot('answer-over-time', 'late');

    expect(early.memory_summary.semantic_count).toBe(0);
    expect(early.memory_summary.forgotten_count).toBe(0);
    expect(mid.memory_summary.semantic_count).toBeGreaterThan(0);
    expect(mid.memory_summary.forgotten_count).toBeGreaterThan(0);
    expect(late.memory_summary.semantic_count).toBeGreaterThan(mid.memory_summary.semantic_count);
    expect(late.memory_summary.episodic_count).toBeLessThan(mid.memory_summary.episodic_count);
    expect(late.memory_summary.forgotten_count).toBeGreaterThan(mid.memory_summary.forgotten_count);
  });

  it('emphasizes transformation (변형) in explanations, not mere storage', () => {
    for (const pointId of POINT_IDS) {
      const snapshot = getEvolutionDemoSnapshot('answer-over-time', pointId);
      const fixture = answerOverTimeFixture.snapshots[pointId];
      expect(snapshot.explanation).toBe(fixture.explanation);
      expect(snapshot.explanation).toMatch(/변형|응축|승격|망각/);
    }
    const late = getEvolutionDemoSnapshot('answer-over-time', 'late');
    expect(late.explanation).toContain('저장이 아니라 변형');
  });

  it('matches fixture JSON for answer-over-time snapshots', () => {
    for (const pointId of POINT_IDS) {
      const snapshot = getEvolutionDemoSnapshot('answer-over-time', pointId);
      const fixture = answerOverTimeFixture.snapshots[pointId];
      expect(snapshot.question).toBe(answerOverTimeFixture.question);
      expect(snapshot.answer).toBe(fixture.answer);
      expect(snapshot.memory_summary).toEqual(fixture.memory_summary);
      expect(snapshot.explanation).toBe(fixture.explanation);
      expect(snapshot.timestamp).toBe(fixture.timestamp);
    }
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
