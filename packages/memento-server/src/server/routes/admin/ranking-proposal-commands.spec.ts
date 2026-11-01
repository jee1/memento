import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import type { RankingProposal } from '@memento/core';
import { buildProposalCommands, shellQuote } from './ranking-proposal-commands.js';

const proposal = (overrides: Partial<RankingProposal> = {}): RankingProposal => ({
  id: '12345678-aaaa-bbbb-cccc-1234567890ab',
  actor: 'session:abc',
  reason: "사유 'quote' $HOME `date` \"dq\"\n둘째 줄",
  current: { 'relevance_signal.scale': 2 },
  proposed: { 'relevance_signal.scale': 2.2 },
  patch: 'diff',
  preview: null,
  previewed_at: null,
  created_at: '2026-11-01T00:00:00.000Z',
  ...overrides,
});

const viaShell = (quoted: string): string => execFileSync('sh', ['-c', `printf %s ${quoted}`], { encoding: 'utf8' });

describe('shellQuote', () => {
  it.each(["plain", "it's", '$HOME `date` $(id) "dq" \\ ; & |', 'a\nb', ''])('셸을 거쳐도 원문 그대로다: %j', (text) => {
    expect(viaShell(shellQuote(text))).toBe(text);
  });
});

describe('buildProposalCommands', () => {
  it('미리보기 명령은 제안 값을 한 인자로 넘긴다', () => {
    const { preview } = buildProposalCommands(proposal());
    expect(preview).toBe(`npm run ranking:preview -- --changes '{"relevance_signal.scale":2.2}'`);
  });

  it('PR 명령은 브랜치, patch 적용, 커밋, draft PR 순이고 사유가 이스케이프된다', () => {
    const { branch_and_pr: command } = buildProposalCommands(proposal());
    const steps = command.split(' && ');
    expect(steps[0]).toBe('git checkout -b ranking/12345678');
    expect(steps[1]).toBe('git apply ranking-12345678-aaaa-bbbb-cccc-1234567890ab.patch');
    // 다른 추적 파일의 변경이 섞이지 않게 설정 파일만 스테이징한다.
    expect(steps[2]).toBe('git add config/ranking-weights.toml');
    expect(steps[3]).toMatch(/^git commit -m '/);
    expect(command).toContain('gh pr create --draft --title ');
    const body = /--body ('(?:[^']|'\\'')*')$/.exec(command)?.[1];
    expect(viaShell(body!)).toContain("사유 'quote' $HOME `date` \"dq\"\n둘째 줄");
  });

  it('미리보기 결과가 있으면 본문에 요약을 넣는다', () => {
    const preview = {
      dev_query_count: 27,
      current: { ndcg_at_10: 0.8651, mrr: 0.856 },
      proposed: { ndcg_at_10: 0.8437, mrr: 0.8282 },
      tie_gate: { passed: true },
    };
    const { branch_and_pr: command } = buildProposalCommands(proposal({ preview }));
    const body = viaShell(/--body ('(?:[^']|'\\'')*')$/.exec(command)![1]!);
    expect(body).toContain('미리보기(dev 27쿼리)');
    expect(body).toContain('ndcg_at_10 0.8651 → 0.8437');
    expect(body).toContain('relevance tie gate 통과');
  });
});
