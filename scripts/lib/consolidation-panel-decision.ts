/**
 * consolidation-replay agent_panel checkpoint decision shared by the v1.1 and v2 aggregators (#1624).
 *
 * Gold needs both judges resolved and every adjudicator's contract_agreement true.
 * Relevant evidence is frozen only when gold and both judges cited the same set; a split keeps gold and freezes nothing.
 */

export type Verdict = 'pass' | 'fail';

export interface Probe {
  probe: 'P_A' | 'P_B' | 'P_omit' | 'P_assert';
  target: string | null;
  verdict_a: Verdict;
  verdict_b: Verdict;
}

export interface AdjudicatorCase {
  adjudicator: string;
  contract_agreement: boolean;
  probes: Probe[];
}

export interface JudgeContract {
  status: string;
  relevant_evidence_refs: string[];
}

export interface CheckpointDecision {
  adjudicator_approvals: boolean[];
  contract_gold: boolean;
  relevant_evidence_agreement: boolean;
  relevant_evidence_refs: string[] | null;
}

const sortedSet = (refs: string[]) => [...new Set(refs)].sort();

/** Throws when an adjudicator's contract_agreement is not what its own probes say; the record goes back, never gets rewritten. */
export function assertAgreementMatchesProbes(checkpointId: string, row: AdjudicatorCase): void {
  if (row.probes.length === 0) throw new Error(`${row.adjudicator} ${checkpointId}: no probes`);
  const probesAgree = row.probes.every(p => p.verdict_a === p.verdict_b);
  if (probesAgree !== row.contract_agreement) {
    throw new Error(`${row.adjudicator} ${checkpointId}: contract_agreement=${row.contract_agreement} but probes ${probesAgree ? 'all agree' : 'diverge'}`);
  }
}

export function decideCheckpoint(
  checkpointId: string,
  contracts: { a: JudgeContract; b: JudgeContract },
  rows: AdjudicatorCase[],
): CheckpointDecision {
  for (const row of rows) assertAgreementMatchesProbes(checkpointId, row);
  const approvals = rows.map(r => r.contract_agreement);
  const resolved = contracts.a.status === 'resolved' && contracts.b.status === 'resolved';
  const gold = resolved && rows.length > 0 && approvals.every(Boolean);
  const aRefs = sortedSet(contracts.a.relevant_evidence_refs);
  const bRefs = sortedSet(contracts.b.relevant_evidence_refs);
  const sameRefs = aRefs.length === bRefs.length && aRefs.every((ref, i) => ref === bRefs[i]);
  return {
    adjudicator_approvals: approvals,
    contract_gold: gold,
    relevant_evidence_agreement: sameRefs,
    relevant_evidence_refs: gold && sameRefs ? aRefs : null,
  };
}
