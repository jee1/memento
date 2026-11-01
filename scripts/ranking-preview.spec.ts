import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { HybridSearchEngine } from '@memento/core';
import { loadPreviewSplit, parsePreviewArgs, runRankingPreview } from './ranking-preview.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MINI = join(ROOT, 'tests/fixtures/search-quality/ranking-preview-mini');
const SCRIPT = join(ROOT, 'scripts/ranking-preview.ts');
const HELD_OUT_TEXT = ['컨테이너 메모리 상한', 'backup nightly database copy'];

describe('ranking-preview', () => {
  const previousProvider = process.env.EMBEDDING_PROVIDER;
  let work: string;

  beforeAll(() => {
    process.env.EMBEDDING_PROVIDER = 'tfidf';
    work = mkdtempSync(join(tmpdir(), 'ranking-preview-spec-'));
  });

  afterAll(() => {
    rmSync(work, { recursive: true, force: true });
    if (previousProvider === undefined) delete process.env.EMBEDDING_PROVIDER;
    else process.env.EMBEDDING_PROVIDER = previousProvider;
  });

  const argsFor = (changes: object, cacheDir = join(work, 'cache')) =>
    parsePreviewArgs(['--changes', JSON.stringify(changes), '--benchmark-dir', MINI, '--cache-dir', cacheDir]);

  it('dev 쿼리만 실행하고 held-out 은 실행하지 않는다', async () => {
    const search = vi.spyOn(HybridSearchEngine.prototype, 'search');
    try {
      const result = await runRankingPreview(argsFor({ 'relevance_signal.scale': 2.2 }));
      const searched = search.mock.calls.map((call) => (call[1] as { query: string }).query);
      // 예열 1회 + 현재 + 제안, 모두 dev 6개만
      expect(searched).toHaveLength(18);
      expect(new Set(searched).size).toBe(6);
      for (const text of HELD_OUT_TEXT) expect(searched).not.toContain(text);
      expect(result.dev_query_count).toBe(6);
      expect(result.split_version).toBe('mini-split-1');
      expect(result.changes).toEqual({ 'relevance_signal.scale': 2.2 });
    } finally {
      search.mockRestore();
    }
  });

  it('현재/제안/차이와 카테고리별 결과와 tie gate 를 낸다', async () => {
    const result = await runRankingPreview(argsFor({ 'relevance_signal.scale': 2.2, 'recency_signal.scale': 0.25 }));
    for (const key of ['ndcg_at_10', 'mrr', 'recall_at_10', 'empty_result_rate', 'p95_latency_ms', 'relevance_tie_rate'] as const) {
      expect(result.delta[key]).toBeCloseTo(result.proposed[key] - result.current[key], 10);
    }
    expect(result.per_category).toMatchObject({
      incident_ops: { query_count: 2 },
      conceptual: { query_count: 2 },
      procedural: { query_count: 2 },
    });
    expect(result.tie_gate.passed).toBe(true);
  });

  it('같은 코퍼스면 시드 캐시를 다시 쓴다', async () => {
    const cacheDir = join(work, 'cache-reuse');
    const first = await runRankingPreview(argsFor({ 'recency_signal.scale': 0.25 }, cacheDir));
    const second = await runRankingPreview(argsFor({ 'recency_signal.scale': 0.25 }, cacheDir));
    expect(first.seed_cache.hit).toBe(false);
    expect(second.seed_cache).toEqual({ hit: true, key: first.seed_cache.key });
    expect(second.proposed.ndcg_at_10).toBe(first.proposed.ndcg_at_10);
  });

  it('queries.json 이 바뀐 split 은 낡았다고 거절한다', () => {
    const dir = join(work, 'stale');
    mkdirSync(dir, { recursive: true });
    copyFileSync(join(MINI, 'queries.json'), join(dir, 'queries.json'));
    const split = JSON.parse(readFileSync(join(MINI, 'split.json'), 'utf8')) as { queries_sha256: string };
    split.queries_sha256 = '0'.repeat(64);
    writeFileSync(join(dir, 'split.json'), JSON.stringify(split));
    expect(() => loadPreviewSplit(dir, join(dir, 'split.json'))).toThrow(/낡았습니다/);
  });

  it('dev 와 held-out 이 겹치면 거절한다', () => {
    const dir = join(work, 'overlap');
    mkdirSync(dir, { recursive: true });
    copyFileSync(join(MINI, 'queries.json'), join(dir, 'queries.json'));
    const split = JSON.parse(readFileSync(join(MINI, 'split.json'), 'utf8')) as { held_out_query_ids: string[] };
    split.held_out_query_ids.push('q_01');
    writeFileSync(join(dir, 'split.json'), JSON.stringify(split));
    expect(() => loadPreviewSplit(dir, join(dir, 'split.json'))).toThrow(/겹칩니다/);
  });

  it('알 수 없는 knob 과 범위 밖 값과 빈 changes 를 거절한다', () => {
    expect(() => argsFor({ 'nope.x': 1 })).toThrow(/알 수 없는 knob/);
    expect(() => argsFor({ 'relevance_signal.scale': 9 })).toThrow(/이하의 숫자/);
    expect(() => argsFor({})).toThrow(/비어/);
    expect(() => argsFor({ 'vector_length_decay.saturation_length': 30 })).toThrow(/characteristic_length/);
  });

  it('CLI 는 stdout 마지막 줄에 JSON 을 쓰고, 시간 상한을 넘으면 0 이 아닌 코드로 끝난다', () => {
    const env = { ...process.env, EMBEDDING_PROVIDER: 'tfidf' };
    const common = ['--import', 'tsx', SCRIPT, '--changes', '{"relevance_signal.scale":2.2}', '--benchmark-dir', MINI, '--cache-dir', join(work, 'cache-cli')];
    const ok = spawnSync(process.execPath, common, { cwd: ROOT, env, encoding: 'utf8' });
    expect(ok.status).toBe(0);
    const last = ok.stdout.trim().split('\n').at(-1)!;
    expect((JSON.parse(last) as { dev_query_count: number }).dev_query_count).toBe(6);

    const late = spawnSync(process.execPath, [...common, '--cache-dir', join(work, 'cache-slow'), '--timeout-ms', '1'], { cwd: ROOT, env, encoding: 'utf8' });
    expect(late.status).not.toBe(0);
  }, 60_000);
});
