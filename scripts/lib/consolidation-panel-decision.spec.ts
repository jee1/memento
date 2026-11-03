import { describe, expect, it } from 'vitest';
import { decideCheckpoint, type AdjudicatorCase, type JudgeContract } from './consolidation-panel-decision.js';

const agree = (adjudicator: string): AdjudicatorCase => ({
  adjudicator, contract_agreement: true,
  probes: [
    { probe: 'P_A', target: null, verdict_a: 'pass', verdict_b: 'pass' },
    { probe: 'P_omit', target: 'r1', verdict_a: 'fail', verdict_b: 'fail' },
  ],
});
const disagree = (adjudicator: string): AdjudicatorCase => ({
  adjudicator, contract_agreement: false,
  probes: [
    { probe: 'P_A', target: null, verdict_a: 'pass', verdict_b: 'pass' },
    { probe: 'P_omit', target: 'r2', verdict_a: 'fail', verdict_b: 'pass' },
  ],
});
const contract = (refs: string[], status = 'resolved'): JudgeContract => ({ status, relevant_evidence_refs: refs });

describe('consolidation panel checkpoint decision (#1624)', () => {
  it('gold with the same evidence set freezes that set', () => {
    const d = decideCheckpoint('t1', { a: contract(['o2', 'o1', 'o1']), b: contract(['o1', 'o2']) }, [agree('adj-1'), agree('adj-2')]);
    expect(d).toEqual({ adjudicator_approvals: [true, true], contract_gold: true, relevant_evidence_agreement: true, relevant_evidence_refs: ['o1', 'o2'] });
  });

  it('gold with diverging evidence sets keeps gold and freezes no evidence', () => {
    const d = decideCheckpoint('t1', { a: contract(['o1', 'o2']), b: contract(['o1', 'o2', 'o3']) }, [agree('adj-1'), agree('adj-2')]);
    expect(d.contract_gold).toBe(true);
    expect(d.relevant_evidence_agreement).toBe(false);
    expect(d.relevant_evidence_refs).toBeNull();
  });

  it('one adjudicator false holds the checkpoint even when evidence sets match', () => {
    const d = decideCheckpoint('t1', { a: contract(['o1']), b: contract(['o1']) }, [agree('adj-1'), disagree('adj-2')]);
    expect(d.contract_gold).toBe(false);
    expect(d.relevant_evidence_refs).toBeNull();
  });

  it('an unresolved judge contract holds the checkpoint whatever the adjudicators said', () => {
    const d = decideCheckpoint('t1', { a: contract(['o1'], 'ambiguous'), b: contract(['o1']) }, [agree('adj-1'), agree('adj-2')]);
    expect(d.contract_gold).toBe(false);
  });

  it('rejects contract_agreement=true when a probe diverges', () => {
    const bad = { ...disagree('adj-2'), contract_agreement: true };
    expect(() => decideCheckpoint('t1', { a: contract([]), b: contract([]) }, [agree('adj-1'), bad]))
      .toThrow('adj-2 t1: contract_agreement=true but probes diverge');
  });

  it('rejects contract_agreement=false when every probe agrees', () => {
    const bad = { ...agree('adj-1'), contract_agreement: false };
    expect(() => decideCheckpoint('t1', { a: contract([]), b: contract([]) }, [bad, agree('adj-2')]))
      .toThrow('adj-1 t1: contract_agreement=false but probes all agree');
  });

  it('rejects an adjudication without probes', () => {
    const empty: AdjudicatorCase = { adjudicator: 'adj-1', contract_agreement: true, probes: [] };
    expect(() => decideCheckpoint('t1', { a: contract([]), b: contract([]) }, [empty])).toThrow('adj-1 t1: no probes');
  });
});
