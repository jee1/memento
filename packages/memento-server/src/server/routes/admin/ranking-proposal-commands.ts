/**
 * 랭킹 가중치 제안을 사람이 PR 로 옮길 때 쓰는 셸 명령을 만든다 (#1584).
 * 서버는 GitHub 토큰을 쓰지 않으므로 PR 은 만들지 않고 실행할 명령 문자열만 돌려준다.
 */

import type { RankingProposal } from '@memento/core';

export interface ProposalCommands {
  preview: string;
  branch_and_pr: string;
}

/** 작은따옴표 한 겹으로 감싸 셸이 어떤 문자도 해석하지 못하게 한다. */
export function shellQuote(text: string): string {
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

interface PreviewSummaryShape {
  dev_query_count?: unknown;
  current?: { ndcg_at_10?: unknown; mrr?: unknown };
  proposed?: { ndcg_at_10?: unknown; mrr?: unknown };
  tie_gate?: { passed?: unknown };
}

const fixed = (value: unknown): string => (typeof value === 'number' ? value.toFixed(4) : '?');

function previewLines(preview: unknown): string[] {
  if (preview === null || typeof preview !== 'object') return [];
  const p = preview as PreviewSummaryShape;
  return [
    '',
    `미리보기(dev ${String(p.dev_query_count ?? '?')}쿼리)`,
    `- ndcg_at_10 ${fixed(p.current?.ndcg_at_10)} → ${fixed(p.proposed?.ndcg_at_10)}`,
    `- mrr ${fixed(p.current?.mrr)} → ${fixed(p.proposed?.mrr)}`,
    `- relevance tie gate ${p.tie_gate?.passed === true ? '통과' : '실패'}`,
  ];
}

export function buildProposalCommands(proposal: RankingProposal): ProposalCommands {
  const shortId = proposal.id.slice(0, 8);
  const knobs = Object.keys(proposal.proposed);
  const title = `chore(ranking): ${knobs.join(', ')} 조정 (제안 ${shortId})`;
  const body = [
    proposal.reason,
    '',
    ...knobs.map((key) => `- ${key}: ${String(proposal.current[key as keyof typeof proposal.current])} → ${String(proposal.proposed[key as keyof typeof proposal.proposed])}`),
    ...previewLines(proposal.preview),
    '',
    `대시보드 랭킹 가중치 제안 ${proposal.id}`,
  ].join('\n');
  return {
    preview: `npm run ranking:preview -- --changes ${shellQuote(JSON.stringify(proposal.proposed))}`,
    branch_and_pr: [
      `git checkout -b ranking/${shortId}`,
      `git apply ranking-${proposal.id}.patch`,
      'git add config/ranking-weights.toml',
      `git commit -m ${shellQuote(title)}`,
      `gh pr create --draft --title ${shellQuote(title)} --body ${shellQuote(body)}`,
    ].join(' && '),
  };
}
