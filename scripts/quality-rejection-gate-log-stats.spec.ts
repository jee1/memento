import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEFAULT_RELEVANCE_GATE_THRESHOLD } from '../packages/memento-core/src/domains/search/ports/relevance-gate-port.js';
import {
  DEFAULT_LOG_CONTAINER,
  DEFAULT_STATS_THRESHOLD,
  resolveLogContainer,
  summarizeGateText,
} from './quality-rejection-gate-log-stats.mjs';

const SCRIPT = fileURLToPath(new URL('./quality-rejection-gate-log-stats.mjs', import.meta.url));

function gateLine(step: string, topScore: number | null, extra: Record<string, string>): string {
  const data = {
    topScore,
    threshold: 0.5,
    unscored: 0,
    candidates: 1,
    scores: [{ id: extra.memoryId, score: topScore }],
    query: extra.query,
  };
  const meta = {
    searchId: extra.searchId,
    step,
    data,
  };
  return `2026-10-18T00:00:00.000Z | DEBUG | 하이브리드 검색 단계: ${step} | ${JSON.stringify(meta)}`;
}

describe('quality-rejection-gate-log-stats', () => {
  it('keeps the script default aligned with the gate constant', () => {
    expect(DEFAULT_STATS_THRESHOLD).toBe(DEFAULT_RELEVANCE_GATE_THRESHOLD);
    expect(DEFAULT_STATS_THRESHOLD).toBe(0.4);
  });

  it('counts reject bands and nearest-rank percentiles without echoing the line', () => {
    const query = 'QUERY_PLAINTEXT_DO_NOT_PRINT';
    const memoryId = 'mem_do_not_print_9f3a';
    const searchId = 'search_do_not_print_ab12';
    const extra = { query, memoryId, searchId };
    const scores = [0.1, 0.39, 0.41, 0.45, 0.49, 0.5, 0.9];
    const lines = [
      ...scores.map((score) => gateLine('기각 게이트: 질의 기각', score, extra)),
      gateLine('기각 게이트: 통과', 0.8, extra),
      gateLine('기각 게이트: 점수 없음 통과', null, extra),
      'noise 통과 without the gate step',
      gateLine('기각 게이트: 질의 기각', null, extra),
    ];

    const summary = summarizeGateText(lines.join('\n'), 0.4);
    const printed = JSON.stringify(summary);

    expect(printed).not.toContain(query);
    expect(printed).not.toContain(memoryId);
    expect(printed).not.toContain(searchId);
    expect(summary.counts).toEqual({
      reject: 8,
      pass: 1,
      failOpen: 1,
      rejectMissingTopScore: 1,
    });
    expect(summary.rejectTopScore).toEqual({
      n: 7,
      min: 0.1,
      p50: 0.45,
      p90: 0.9,
      p95: 0.9,
      max: 0.9,
      method: 'nearest-rank',
    });
    expect(summary.bands.measured04to05).toEqual({ low: 0.4, high: 0.5, rejectCount: 3 });
    expect(summary.bands.from04UntilThreshold).toEqual({ low: 0.4, high: 0.4, rejectCount: 0 });
    expect(summarizeGateText(lines.join('\n'), 0.45).bands.from04UntilThreshold.rejectCount).toBe(1);
  });

  it('rejects container names that are not a single docker name', () => {
    expect(resolveLogContainer(undefined)).toBe(DEFAULT_LOG_CONTAINER);
    expect(resolveLogContainer('')).toBe(DEFAULT_LOG_CONTAINER);
    expect(resolveLogContainer('memento-memento-mcp-server-1')).toBe('memento-memento-mcp-server-1');
    expect(resolveLogContainer('$(docker)')).toBeNull();
    expect(resolveLogContainer('name with space')).toBeNull();
  });

  it('prints aggregate JSON on stdin and nothing from the log line', () => {
    const query = 'QUERY_PLAINTEXT_DO_NOT_PRINT';
    const memoryId = 'mem_do_not_print_9f3a';
    const searchId = 'search_do_not_print_ab12';
    const input = `${gateLine('기각 게이트: 질의 기각', 0.42, { query, memoryId, searchId })}\n`;
    const result = spawnSync(process.execPath, [SCRIPT, '--threshold', '0.4'], {
      input,
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).not.toContain(query);
    expect(result.stdout).not.toContain(memoryId);
    expect(result.stdout).not.toContain(searchId);
    expect(JSON.parse(result.stdout)).toMatchObject({
      threshold: 0.4,
      counts: { reject: 1, pass: 0, failOpen: 0, rejectMissingTopScore: 0 },
      bands: {
        measured04to05: { rejectCount: 1 },
        from04UntilThreshold: { rejectCount: 0 },
      },
    });
  });

  it('prints an error code for a threshold outside 0..1', () => {
    const result = spawnSync(process.execPath, [SCRIPT, '--threshold', '1.5'], {
      input: '',
      encoding: 'utf8',
    });

    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout)).toEqual({ error: 'invalid_threshold' });
  });
});
