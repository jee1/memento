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
  it('lists answer-over-time and episodic-to-semantic scenarios', () => {
    const catalog = listEvolutionDemoScenarios();
    expect(catalog.scenarios).toHaveLength(2);

    const answerOverTime = catalog.scenarios.find(
      s => s.scenario_id === 'answer-over-time'
    );
    expect(answerOverTime?.scenario_id).toBe('answer-over-time');
    expect(answerOverTime?.title).toBe('시간 경과에 따른 답변 변화');
    expect(answerOverTime?.points.map(p => p.point_id)).toEqual([...POINT_IDS]);
    expect(answerOverTime?.points.map(p => p.label)).toEqual([
      '초기 (1일차)',
      '중기 (30일차)',
      '후기 (90일차)',
    ]);

    const consolidation = catalog.scenarios.find(
      s => s.scenario_id === 'episodic-to-semantic'
    );
    expect(consolidation?.title).toBe('에피소딕→시맨틱 통합');
    expect(consolidation?.points.map(p => p.point_id)).toEqual(['before', 'after']);
  });

  it('returns snapshot for each answer-over-time point with same question and different answers', () => {
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

    expect(EvolutionDemoSnapshotSchema.safeParse(early).success).toBe(true);
    expect(EvolutionDemoSnapshotSchema.safeParse(late).success).toBe(true);
    expect(early.episodic_sources).toBeUndefined();
    expect(early.semantic_result).toBeUndefined();
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
