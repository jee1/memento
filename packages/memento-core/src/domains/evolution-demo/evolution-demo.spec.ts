import { describe, it, expect } from 'vitest';
import answerOverTimeFixture from './fixtures/answer-over-time.snapshots.json' with { type: 'json' };
import forgettingPolicyFixture from './fixtures/forgetting-policy.snapshots.json' with { type: 'json' };
import {
  getEvolutionDemoSnapshot,
  listEvolutionDemoScenarios,
  EvolutionDemoNotFoundError,
  EvolutionDemoSnapshotSchema,
} from './index.js';

const POINT_IDS = ['early', 'mid', 'late'] as const;

describe('evolution-demo getters', () => {
  it('lists answer-over-time and forgetting-policy scenarios', () => {
    const catalog = listEvolutionDemoScenarios();
    expect(catalog.scenarios).toHaveLength(2);
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

  describe('forgetting-policy scenario (#344)', () => {
    const FORGETTING_POINT_IDS = ['day-30', 'day-90'] as const;

    it('lists forgetting-policy with day-30 and day-90 points', () => {
      const catalog = listEvolutionDemoScenarios();
      const scenario = catalog.scenarios.find(s => s.scenario_id === 'forgetting-policy');
      expect(scenario?.title).toBe('망각 정책 비교');
      expect(scenario?.points.map(p => p.point_id)).toEqual([...FORGETTING_POINT_IDS]);
    });

    it('returns memory_groups comparing low vs high importance fates', () => {
      const day30 = getEvolutionDemoSnapshot('forgetting-policy', 'day-30');
      const day90 = getEvolutionDemoSnapshot('forgetting-policy', 'day-90');

      expect(day30.memory_groups).toBeDefined();
      expect(day30.memory_groups).toHaveLength(3);
      expect(day90.memory_groups).toHaveLength(3);

      const low30 = day30.memory_groups!.find(g => g.importance < 0.5);
      const high30 = day30.memory_groups!.find(g => g.importance >= 0.8);
      const pinned30 = day30.memory_groups!.find(g => g.pinned);

      expect(low30?.outcome).toBe('forget');
      expect(high30?.outcome).toBe('preserve');
      expect(pinned30?.outcome).toBe('pin');
      expect(pinned30?.pinned).toBe(true);

      const low90 = day90.memory_groups!.find(g => g.importance < 0.5);
      expect(low90?.status).toMatch(/망각/);
      expect(day90.explanation).toMatch(/핀|semantic/);
    });

    it('validates forgetting-policy snapshots against schema', () => {
      for (const pointId of FORGETTING_POINT_IDS) {
        const snapshot = getEvolutionDemoSnapshot('forgetting-policy', pointId);
        const parsed = EvolutionDemoSnapshotSchema.safeParse(snapshot);
        expect(parsed.success, `schema failed for ${pointId}`).toBe(true);
        expect(snapshot.scenario_id).toBe('forgetting-policy');
        expect(snapshot.memory_groups?.length).toBeGreaterThanOrEqual(2);
      }
    });

    it('matches fixture JSON for forgetting-policy snapshots', () => {
      for (const pointId of FORGETTING_POINT_IDS) {
        const snapshot = getEvolutionDemoSnapshot('forgetting-policy', pointId);
        const fixture = forgettingPolicyFixture.snapshots[pointId];
        expect(snapshot.question).toBe(forgettingPolicyFixture.question);
        expect(snapshot.answer).toBe(fixture.answer);
        expect(snapshot.memory_groups).toEqual(fixture.memory_groups);
        expect(snapshot.explanation).toBe(fixture.explanation);
      }
    });
  });
});
