import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildCaseMemories,
  collectLiveVerdicts,
  evaluateFromVerdictRows,
  scoreSupersedeVerdicts,
  type PanelDecision,
} from '../evaluate-supersede-candidates.js';
import { wilson95 } from '../lib/rejection-sweep.js';

const fixture = join(process.cwd(), 'tests/fixtures/search-quality/adoption-ko-panel-v1');
const read = (name: string) => JSON.parse(readFileSync(join(fixture, name), 'utf8'));
const decisions: PanelDecision[] = read('panel-result.json').decisions;

const synthetic = (positive: number, negative: number, ambiguous = 0): PanelDecision[] => [
  ...Array.from({ length: positive }, (_, i) => ({ case_id: `p${i}`, label: 'retire' as const, gold: true })),
  ...Array.from({ length: negative }, (_, i) => ({ case_id: `n${i}`, label: 'retain' as const, gold: true })),
  ...Array.from({ length: ambiguous }, (_, i) => ({ case_id: `a${i}`, label: 'ambiguous' as const, gold: false })),
];

describe('scoreSupersedeVerdicts (#1548)', () => {
  it('실제 fixture 의 이진 분모는 positive 30, negative 27 이고 보류 3건은 제외 수로 보고한다', () => {
    const report = scoreSupersedeVerdicts(decisions, new Map());
    expect(report.counts).toMatchObject({ positive: 30, negative: 27, excluded: 3 });
  });

  it('TP, FP, 누락, pending 을 세어 primary endpoint 와 보조 비율을 계산한다', () => {
    const verdicts = new Map<string, 'confirmed' | 'pending' | 'compatible'>([
      ['p0', 'confirmed'], ['p1', 'confirmed'], ['p2', 'confirmed'],
      ['p3', 'pending'],
      ['p4', 'compatible'],
      ['n0', 'confirmed'],
      ['n1', 'pending'], ['n2', 'pending'],
      ['n3', 'compatible'],
      ['a0', 'confirmed'],
    ]);
    const report = scoreSupersedeVerdicts(synthetic(10, 10, 1), verdicts);

    expect(report.counts).toMatchObject({
      tp: 3, fp: 1, fn: 7, missing_positive: 5, missing_negative: 6, excluded: 1,
    });
    expect(report.precision).toMatchObject({ numerator: 3, denominator: 4, rate: 0.75 });
    expect(report.detection).toMatchObject({ numerator: 3, denominator: 10, rate: 0.3 });
    expect(report.false_retire).toMatchObject({ numerator: 1, denominator: 10, rate: 0.1 });
    expect(report.detection_lenient).toMatchObject({ numerator: 4, denominator: 10, rate: 0.4 });
    expect(report.detection_loss).toMatchObject({ numerator: 1, denominator: 10 });
    expect(report.detection_loss.rate).toBeCloseTo(0.1, 12);
    expect(report.false_retire_lenient).toMatchObject({ numerator: 3, denominator: 10, rate: 0.3 });
  });

  it('각 비율에 Wilson 95% 구간을 붙인다', () => {
    const report = scoreSupersedeVerdicts(synthetic(10, 10), new Map([['p0', 'confirmed']]));
    expect(report.detection.ci95).toEqual(wilson95(1, 10));
    expect(report.detection.ci95![0]).toBeCloseTo(0.0179, 3);
    expect(report.detection.ci95![1]).toBeCloseTo(0.4041, 3);
  });

  it('오류 0건이면 false_retire 에 단측 95% 상한 1 - 0.05^(1/n) 을 함께 낸다', () => {
    const clean = scoreSupersedeVerdicts(synthetic(0, 30), new Map());
    expect(clean.false_retire.numerator).toBe(0);
    expect(clean.false_retire.zero_error_upper95).toBeCloseTo(1 - 0.05 ** (1 / 30), 12);
    expect(clean.false_retire.zero_error_upper95).toBeCloseTo(0.095, 3);

    const dirty = scoreSupersedeVerdicts(synthetic(0, 30), new Map([['n0', 'confirmed']]));
    expect(dirty.false_retire.zero_error_upper95).toBeNull();
  });

  it('분모가 0 이면 0% 로 채우지 않고 null 과 사유를 보고한다', () => {
    const noRetire = scoreSupersedeVerdicts(synthetic(5, 5), new Map([['n0', 'pending']]));
    expect(noRetire.precision).toEqual({
      numerator: 0, denominator: 0, rate: null, ci95: null, reason: 'no_confirmed_verdicts',
    });

    const empty = scoreSupersedeVerdicts([], new Map());
    for (const ratio of [empty.detection, empty.false_retire, empty.detection_lenient, empty.false_retire_lenient, empty.detection_loss]) {
      expect(ratio).toMatchObject({ rate: null, ci95: null, reason: 'empty_denominator' });
    }
    expect(empty.false_retire.zero_error_upper95).toBeNull();
  });

  it('coverage 는 이진 분모 대비 판정이 있는 비율이다', () => {
    const report = scoreSupersedeVerdicts(synthetic(4, 4), new Map([['p0', 'confirmed'], ['n0', 'compatible']]));
    expect(report.coverage).toEqual({ judged: 2, binary_cases: 8, rate: 0.25 });
  });
});

describe('buildCaseMemories (#1548)', () => {
  it('retirement_target_ref 근거가 old, 나머지 근거가 new 이고 scope 는 사례 scope 다', () => {
    const candidate = read('candidates.json').cases[0];
    const { old, next } = buildCaseMemories(candidate);
    expect(old.id).toBe(candidate.retirement_target_ref);
    expect(next.id).not.toBe(old.id);
    expect(old).toMatchObject({ ownerId: candidate.scope.owner, projectId: candidate.scope.project });
    expect(next.content).toBe(candidate.evidence.find((e: { evidence_id: string }) => e.evidence_id === next.id).content);
  });
});

describe('collectLiveVerdicts (#1548)', () => {
  const dirs: string[] = [];
  afterEach(() => {
    while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
  });
  const store = () => {
    const dir = mkdtempSync(join(tmpdir(), 'supersede-live-'));
    dirs.push(dir);
    return join(dir, 'verdicts.jsonl');
  };
  const candidates = read('candidates.json').cases.slice(0, 3);
  const ids = candidates.map((c: { case_id: string }) => c.case_id);
  const base = { cases: candidates, provider: 'gemini', model: 'm', promptVersion: 'v' };

  it('판정마다 한 줄씩 append 하고 같은 input_hash 는 다시 부르지 않는다', async () => {
    const storePath = store();
    let calls = 0;
    const judge = async () => {
      calls += 1;
      return { kind: 'judged' as const, judgment: { verdict: 'pending' as const, rationale: 'r', evidenceQuote: null } };
    };

    const first = await collectLiveVerdicts({ ...base, judge, storePath });
    const second = await collectLiveVerdicts({ ...base, judge, storePath });

    expect(calls).toBe(3);
    expect(first.verdicts.size).toBe(3);
    expect(second.verdicts.size).toBe(3);
    const lines = readFileSync(storePath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(lines.map((l) => l.case_id)).toEqual(ids);
    expect(lines[0]).toMatchObject({ verdict: 'pending', provider: 'gemini', model: 'm', prompt_version: 'v' });
    expect(lines[0].input_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rate_limited 를 받으면 멈추고 그때까지의 판정만 돌려준다', async () => {
    const storePath = store();
    let calls = 0;
    const judge = async () => {
      calls += 1;
      return calls === 1
        ? { kind: 'judged' as const, judgment: { verdict: 'confirmed' as const, rationale: 'r', evidenceQuote: null } }
        : { kind: 'rate_limited' as const };
    };

    const result = await collectLiveVerdicts({ ...base, judge, storePath });

    expect(calls).toBe(2);
    expect(result.stoppedByRateLimit).toBe(true);
    expect([...result.verdicts.entries()]).toEqual([[ids[0], 'confirmed']]);
  });
});

describe('evaluateFromVerdictRows (#1548)', () => {
  it('입력 SHA, prompt/provider/model 집합, coverage 를 담아 채점한다', () => {
    const candidates = read('candidates.json');
    const positive = decisions.find((d) => d.gold && d.label === 'retire')!;
    const rows = [
      { case_id: positive.case_id, verdict: 'confirmed', input_hash: 'h', provider: 'gemini', model: 'm', prompt_version: 'v' },
    ];
    const report = evaluateFromVerdictRows({ fixtureDir: fixture, rows, runnerGitSha: 'abc123' });

    expect(candidates.cases).toHaveLength(60);
    expect(report.inputs.candidates_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(report.inputs.panel_result_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(report).toMatchObject({
      runner_git_sha: 'abc123',
      prompt_versions: ['v'],
      providers_models: ['gemini/m'],
      score: { counts: { tp: 1, positive: 30, negative: 27, excluded: 3 }, coverage: { judged: 1, binary_cases: 57 } },
    });
  });

  it('같은 case 에 서로 다른 verdict 가 있으면 거절한다', () => {
    const id = decisions.find((d) => d.gold)!.case_id;
    const row = (verdict: string) => ({ case_id: id, verdict, input_hash: verdict, provider: 'g', model: 'm', prompt_version: 'v' });
    expect(() =>
      evaluateFromVerdictRows({ fixtureDir: fixture, rows: [row('confirmed'), row('pending')], runnerGitSha: null }),
    ).toThrow(/conflicting/);
  });

  it('prompt 판본이나 provider/model 이 섞인 판정은 한 점수로 합치지 않는다', () => {
    const [a, b] = decisions.filter((d) => d.gold);
    const row = (caseId: string, promptVersion: string, model: string) => ({
      case_id: caseId, verdict: 'pending', input_hash: caseId, provider: 'g', model, prompt_version: promptVersion,
    });
    expect(() =>
      evaluateFromVerdictRows({ fixtureDir: fixture, rows: [row(a.case_id, 'v1', 'm'), row(b.case_id, 'v2', 'm')], runnerGitSha: null }),
    ).toThrow(/one prompt version and one provider\/model/);
    expect(() =>
      evaluateFromVerdictRows({ fixtureDir: fixture, rows: [row(a.case_id, 'v1', 'm1'), row(b.case_id, 'v1', 'm2')], runnerGitSha: null }),
    ).toThrow(/one prompt version and one provider\/model/);
  });
});

