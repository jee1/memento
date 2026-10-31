import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { formatOpsSummaryHuman, runOpsReport } from './ops-report-core.js';
import { createOpsReportRequest } from '../ops-report-cli.js';
import type { OpsSummaryResponse } from '../server/routes/admin/admin-ops-summary.types.js';

const sample: OpsSummaryResponse = {
  generated_at: '2026-10-31T00:00:00.000Z',
  window: { period: '24h', since: '2026-10-30T00:00:00.000Z', until: '2026-10-31T00:00:00.000Z' },
  admin_status_path: '/admin/status',
  admin_status: {} as OpsSummaryResponse['admin_status'],
  questions: {
    search_health: {
      availability: 'measured',
      window: { period: '24h', since: 'a', until: 'b' },
      request_count: 10,
      error_count: 1,
      search_query_count: 8,
      p95_latency_ms: 120,
      empty_retrieval_rate: 0.1,
      search_failed_events: 2,
      recent_search_failures: [],
    },
    batch_jobs: {
      availability: 'measured',
      window: { period: '24h', since: 'a', until: 'b' },
      failed_run_count: 1,
      success_run_count: 4,
      stuck_or_error_jobs: [],
      recent_failed_runs: [],
    },
    llm_pressure: {
      availability: 'unmeasured',
      window: { period: '24h', since: 'a', until: 'b' },
      reason: 'GET /admin/telemetry/llm-usage not deployed (#1546)',
    },
    quality_trend: {
      availability: 'partial',
      window: { period: '24h', since: 'a', until: 'b' },
      measured_metric_count: 0,
      unmeasured_metric_count: 3,
      evaluable_metric_count: 0,
      history_sample_count: 0,
      overall_status: null,
    },
  },
  source_gets: ['/admin/status'],
};

describe('ops-report-core', () => {
  it('human output labels llm section as unmeasured', () => {
    const text = formatOpsSummaryHuman(sample);
    expect(text).toContain('미측정');
    expect(text).toContain('#1546');
    expect(text).toContain('[1]');
    expect(text).toContain('[4]');
  });

  it('createOpsReportRequest attaches session cookie to admin GET', async () => {
    const httpRequest = createOpsReportRequest('http://127.0.0.1:9', 'memento_admin_session=s1', 1000);
    const captured: RequestInit[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        captured.push(init ?? {});
        return { status: 200, text: async () => '{}' };
      }),
    );
    await httpRequest('/admin/ops/summary?period=24h', { method: 'GET' });
    expect(new Headers(captured[0]?.headers).get('Cookie')).toBe('memento_admin_session=s1');
    expect(new Headers(captured[0]?.headers).get('X-API-Key')).toBeNull();
    vi.unstubAllGlobals();
  });

  it('runOpsReport uses HTTP request only', async () => {
    const request = vi.fn(async () => ({ status: 200, body: sample }));
    const result = await runOpsReport(
      {
        endpoint: 'http://127.0.0.1:9',
        apiKey: 'test',
        period: '24h',
        json: false,
        timeoutMs: 1000,
      },
      request,
    );
    expect(result.exitCode).toBe(0);
    expect(request).toHaveBeenCalledWith('/admin/ops/summary?period=24h', { method: 'GET' });
  });
});

describe('ops-report-cli bootstrap guard', () => {
  it('ops-report sources do not reference createMementoCore', () => {
    const root = resolve(import.meta.dirname, '../..');
    const cli = readFileSync(resolve(root, 'src/ops-report-cli.ts'), 'utf8');
    const core = readFileSync(resolve(root, 'src/cli/ops-report-core.ts'), 'utf8');
    expect(cli.includes('createMementoCore')).toBe(false);
    expect(core.includes('createMementoCore')).toBe(false);
  });
});
