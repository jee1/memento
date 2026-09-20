import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolveQualityCommand } from './quality.js';
import {
  assertOverlayCorpusNeutralized,
  assertRejectionBaselineQueryGroups,
  firstRelevantRank,
  loadRejectionBaselineQueries,
  measureRejectionBaseline,
  percentileLatencyMs,
  reciprocalRank,
  type RejectionBaselineReport,
} from './lib/rejection-baseline-measurement.js';
import {
  REJECTION_BASELINE_DIR,
  createRejectionBaselineUnitTestDatabase,
  loadRejectionBaselineOverlay,
} from './lib/rejection-baseline-database.js';
import {
  emitRejectionBaselineJson,
  runRejectionBaselineMeasurement,
} from './quality-benchmark-rejection-baseline.js';

const RUNNER_SCRIPT = fileURLToPath(new URL('./quality-benchmark-rejection-baseline.ts', import.meta.url));

describe('quality-benchmark-rejection-baseline (#922)', () => {
  it('registers benchmark:rejection-baseline in quality CLI', () => {
    const command = resolveQualityCommand(['benchmark:rejection-baseline']);
    expect(command.script).toBe('quality-benchmark-rejection-baseline.ts');
  });

  it('fixture has exactly six relevant and six unrelated queries with issue-sourced strings', () => {
    const rows = loadRejectionBaselineQueries(REJECTION_BASELINE_DIR);
    assertRejectionBaselineQueryGroups(rows);
    expect(rows.map((row) => row.query_id)).toEqual([
      'rb_rel_001',
      'rb_rel_002',
      'rb_rel_003',
      'rb_rel_004',
      'rb_rel_005',
      'rb_rel_006',
      'rb_unr_001',
      'rb_unr_002',
      'rb_unr_003',
      'rb_unr_004',
      'rb_unr_005',
      'rb_unr_006',
    ]);
    expect(rows.filter((row) => row.group === 'relevant').map((row) => row.query)).toEqual([
      'sleep consolidation 이 임베딩을 다시 계산해서',
      '도커 컨테이너가 readonly database 로 재시작 루',
      '앵커 맵 노드가 화면 밖으로 나가는 문제',
      '자동차 정비 녹음에서 위키 노트를 만든 기록',
      '고성 왕곡마을 클리핑',
      '우리말 질의가 엉뚱한 결과를 내던 원인을 찾아 고친 기록',
    ]);
    expect(rows.filter((row) => row.group === 'unrelated').map((row) => row.query)).toEqual([
      '김치찌개 끓이는 법',
      '오늘 저녁 뭐 먹지',
      '내일 비 오나',
      '고양이 사료 추천',
      '주말에 등산 갈까',
      '어제 축구 경기 결과',
    ]);
  });

  it('overlay corpus uses neutral identical tags and synthetic memory ids', () => {
    const overlay = loadRejectionBaselineOverlay();
    assertOverlayCorpusNeutralized(overlay);
    expect(overlay).toHaveLength(6);
    expect(overlay.map((entry) => entry.benchmark_id)).toEqual([
      'rej_overlay_0001',
      'rej_overlay_0002',
      'rej_overlay_0003',
      'rej_overlay_0004',
      'rej_overlay_0005',
      'rej_overlay_0006',
    ]);
    expect(overlay.every((entry) => entry.source_memory_id.startsWith('rej_syn_mem_'))).toBe(true);
    expect(overlay.every((entry) => !entry.source_memory_id.startsWith('mem_'))).toBe(true);
  });

  it('fixture provenance documents synthetic corpus without production id mapping', () => {
    const provenance = JSON.parse(
      readFileSync(join(REJECTION_BASELINE_DIR, 'fixture-provenance.json'), 'utf8')
    ) as {
      corpus_source: { type: string };
      query_source: { issues: string[] };
    };
    expect(provenance.corpus_source.type).toBe('synthetic');
    expect(provenance.query_source.issues).toEqual(['922', '903']);
  });

  it('computes rank, recall, reciprocal rank, and p95 latency', () => {
    const results = [
      { id: 'noise', score: 0.9 },
      { id: 'answer', score: 0.8 },
    ];
    expect(firstRelevantRank(results, ['answer'])).toBe(2);
    expect(reciprocalRank(2)).toBe(0.5);
    expect(percentileLatencyMs([10, 20, 30, 40, 100])).toBe(100);
  });

  it('report JSON has required top-level structure', () => {
    const sample: RejectionBaselineReport = {
      schema_version: 1,
      benchmark_version: 'rejection-baseline-v1',
      embedding_provider: 'minilm',
      vector_dims: 384,
      ranking_baseline_note: 'test',
      corpus: { parent: 'benchmark-v3', parent_document_count: 3, overlay_document_count: 6 },
      top_k: 10,
      latency_ms: { p95: 12.3 },
      relevant: [
        {
          query_id: 'rb_rel_001',
          query: 'q',
          result_count: 10,
          recall_at_k: 1,
          first_relevant_rank: 1,
          reciprocal_rank: 1,
          latency_ms: 10,
        },
      ],
      unrelated: [
        {
          query_id: 'rb_unr_001',
          query: 'u',
          returned_any: true,
          result_count: 10,
          latency_ms: 11,
        },
      ],
      aggregates: {
        unrelated_returned_any_count: 1,
        relevant_recall_at_k_mean: 1,
        relevant_reciprocal_rank_mean: 1,
      },
    };
    const parsed = JSON.parse(JSON.stringify(sample)) as RejectionBaselineReport;
    expect(parsed.schema_version).toBe(1);
    expect(parsed.relevant[0]?.query_id).toBe('rb_rel_001');
    expect(parsed.unrelated[0]?.returned_any).toBe(true);
    expect(parsed.aggregates.relevant_recall_at_k_mean).toBe(1);
    expect(parsed.latency_ms.p95).toBe(12.3);
  });

  it('emitRejectionBaselineJson writes a single parseable JSON document', () => {
    const payload = JSON.stringify({ schema_version: 1, benchmark_version: 'rejection-baseline-v1' });
    let captured = '';
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      captured += String(chunk);
      return true;
    });
    try {
      emitRejectionBaselineJson(payload);
    } finally {
      writeSpy.mockRestore();
    }
    expect(JSON.parse(captured.trim())).toEqual({
      schema_version: 1,
      benchmark_version: 'rejection-baseline-v1',
    });
  });

  describe('synthetic corpus measurement', () => {
    let seeded: Awaited<ReturnType<typeof createRejectionBaselineUnitTestDatabase>>;
    let previousProvider: string | undefined;

    beforeAll(async () => {
      previousProvider = process.env.EMBEDDING_PROVIDER;
      process.env.EMBEDDING_PROVIDER = 'tfidf';
      seeded = await createRejectionBaselineUnitTestDatabase();
    }, 60_000);

    afterAll(() => {
      seeded?.close();
      if (previousProvider === undefined) {
        delete process.env.EMBEDDING_PROVIDER;
      } else {
        process.env.EMBEDDING_PROVIDER = previousProvider;
      }
    });

    it('maps memory ids to benchmark ids and returns per-query metrics', async () => {
      const overlay = loadRejectionBaselineOverlay();
      const report = await measureRejectionBaseline(seeded.db, REJECTION_BASELINE_DIR, {
        overlayCorpus: overlay,
        parentDocumentCount: seeded.parentDocumentCount,
        vectorDims: seeded.vectorDims,
      });

      expect(report.schema_version).toBe(1);
      expect(report.benchmark_version).toBe('rejection-baseline-v1');
      expect(report.relevant).toHaveLength(6);
      expect(report.unrelated).toHaveLength(6);
      expect(report.corpus.overlay_document_count).toBe(6);
      expect(report.corpus.parent_document_count).toBe(3);
      expect(report.top_k).toBe(10);
      expect(report.relevant.map((row) => row.query_id)).toEqual([
        'rb_rel_001',
        'rb_rel_002',
        'rb_rel_003',
        'rb_rel_004',
        'rb_rel_005',
        'rb_rel_006',
      ]);
      expect(report.unrelated.map((row) => row.query_id)).toEqual([
        'rb_unr_001',
        'rb_unr_002',
        'rb_unr_003',
        'rb_unr_004',
        'rb_unr_005',
        'rb_unr_006',
      ]);
      expect(report.relevant.every((row) => row.result_count > 0)).toBe(true);
      expect(report.relevant.every((row) => row.recall_at_k >= 0 && row.recall_at_k <= 1)).toBe(true);
      expect(report.unrelated.every((row) => typeof row.returned_any === 'boolean')).toBe(true);
      expect(report.latency_ms.p95).toBeGreaterThanOrEqual(0);
      expect(report.aggregates.unrelated_returned_any_count).toBeGreaterThanOrEqual(0);
      expect(report.aggregates.relevant_recall_at_k_mean).toBeGreaterThanOrEqual(0);
      expect(report.aggregates.relevant_reciprocal_rank_mean).toBeGreaterThanOrEqual(0);

      const rbRel001 = report.relevant.find((row) => row.query_id === 'rb_rel_001');
      expect(rbRel001?.first_relevant_rank).toBe(1);
      expect(rbRel001?.recall_at_k).toBe(1);
      expect(rbRel001?.reciprocal_rank).toBe(1);
    });

    it('runRejectionBaselineMeasurement returns parseable JSON', async () => {
      const json = await runRejectionBaselineMeasurement({ unitTest: true });
      const parsed = JSON.parse(json) as RejectionBaselineReport;
      expect(parsed.schema_version).toBe(1);
      expect(parsed.relevant).toHaveLength(6);
      expect(parsed.unrelated).toHaveLength(6);
    });
  });

  it('runner stdout is a single parseable JSON document', () => {
    const result = spawnSync(process.execPath, ['--import', 'tsx', RUNNER_SCRIPT], {
      env: {
        ...process.env,
        EMBEDDING_PROVIDER: 'tfidf',
        MEMENTO_REJECTION_BASELINE_UNIT_TEST: '1',
      },
      encoding: 'utf8',
    });
    expect(result.status).toBe(0);
    const stdout = result.stdout.trim();
    expect(stdout.length).toBeGreaterThan(0);
    expect(stdout.startsWith('{')).toBe(true);
    expect(stdout.endsWith('}')).toBe(true);
    const parsed = JSON.parse(stdout) as RejectionBaselineReport;
    expect(parsed.schema_version).toBe(1);
    expect(parsed.embedding_provider).toBe('tfidf');
    expect(parsed.relevant).toHaveLength(6);
    expect(parsed.unrelated).toHaveLength(6);
    expect(result.stderr).toMatch(/\[rejection-baseline-seed\]/);
  });
});
