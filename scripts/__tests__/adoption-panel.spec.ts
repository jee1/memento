import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { aggregateAdoptionPanel } from '../aggregate-adoption-panel.js';

const fixture = join(process.cwd(), 'tests/fixtures/search-quality/adoption-ko-panel-v1');
const read = (path: string) => JSON.parse(readFileSync(join(fixture, path), 'utf8'));
const candidates = read('candidates.json');
const submissions = [read('reviewer-a/answers.json'), read('reviewer-b/answers.json')];
const review = read('contract-review.json');
const aggregate = (answers = submissions, contracts = review) =>
  aggregateAdoptionPanel(candidates, answers, contracts);

describe('agent_panel consent', () => {
  it('separates 60 matching labels, 57 answer contracts and 55 retrieval contracts', () => {
    const result = aggregate();
    expect(result.summary).toMatchObject({
      total: 60, label_agreement: 60, gold_count: 57,
      labels: { retire: 30, retain: 27, ambiguous: 3 },
      retrieval_gold_count: 55, retrieval_held_count: 5,
    });
    expect(result.decisions.filter(d => d.label === 'ambiguous')).toHaveLength(3);
    expect(result.ground_truth).toHaveLength(55);
  });

  it('holds matching labels when the compared answer contracts disagree', () => {
    const changed = structuredClone(review);
    changed.cases[0].contract_agreement = false;
    expect(aggregate(submissions, changed).decisions[0]).toMatchObject({
      label: 'ambiguous', gold: false, hold_reasons: ['contract_disagreement'],
    });
  });

  it('holds label disagreement, one-sided ambiguous and missing judgments', () => {
    for (const label of ['retain', 'ambiguous', null]) {
      const changed = structuredClone(submissions);
      const id = candidates.cases[1].case_id;
      const answer = changed[1].answers.find((a: { case_id: string }) => a.case_id === id);
      if (label === null) changed[1].answers = changed[1].answers.filter((a: { case_id: string }) => a.case_id !== id);
      else answer.label = label;
      const decision = aggregate(changed).decisions[1];
      expect(decision.gold).toBe(false);
      expect(decision.label).toBe('ambiguous');
      expect(decision.hold_reasons.length).toBeGreaterThan(0);
    }
  });

  it('does not choose a union or intersection of disputed retrieval refs', () => {
    const result = aggregate();
    expect(result.decisions.find(d => d.case_id === 'c_327f9089fef4')).toMatchObject({
      label: 'retain', gold: true, relevant_evidence_refs: null,
    });
    expect(result.ground_truth.some(g => g.queryId === 'c_327f9089fef4')).toBe(false);
  });

  it('rejects duplicate/foreign judgments and invalid evidence refs', () => {
    for (const kind of ['duplicate', 'foreign', 'evidence'] as const) {
      const changed = structuredClone(submissions);
      if (kind === 'duplicate') changed[0].answers.push(changed[0].answers[0]);
      if (kind === 'foreign') changed[0].answers[0].case_id = 'unknown';
      if (kind === 'evidence') changed[0].answers[0].evidence_refs = ['unknown'];
      expect(() => aggregate(changed)).toThrow();
    }
  });

  it('rejects same-model or non-agent_panel submissions and incomplete contract review', () => {
    const sameModel = structuredClone(submissions);
    sameModel[1].model = sameModel[0].model;
    expect(() => aggregate(sameModel)).toThrow();
    const human = structuredClone(submissions);
    human[0].label_source = 'human';
    expect(() => aggregate(human)).toThrow();
    const incomplete = structuredClone(review);
    incomplete.cases.pop();
    expect(() => aggregate(submissions, incomplete)).toThrow();
  });
});
