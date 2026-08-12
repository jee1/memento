/**
 * telemetry-cli 단위 테스트 (specs/007-telemetry-cli-mcp)
 */

import { describe, it, expect } from 'vitest';
import {
  formatSearchQuality,
  formatMemoryQuality,
  formatFeedbackQuality,
  formatSystemMetrics,
  parseCliOptions,
  executeTelemetry,
} from './telemetry-cli.js';
import type { TelemetryRunner, FeedbackQualityResult } from './telemetry-cli.js';

// 인라인 타입 정의 (서브패스 export 미노출)
interface SearchQualityResult {
  period: string;
  owner_id: string | null;
  search_count: number | null;
  avg_latency_ms: number | null;
  p95_latency_ms: number | null;
  empty_retrieval_rate: number | null;
  avg_candidate_count: number | null;
  top_k_selected_rate: number | null;
  timestamp: string;
}

interface MemoryQualityResult {
  owner_id: string | null;
  total_memories: number | null;
  type_distribution: Record<string, number> | null;
  duplicate_write_rate_24h: number | null;
  relation_coverage_ratio: number | null;
  orphan_memory_ratio: number | null;
  timestamp: string;
}

// Phase 3 — 포맷터 테스트

describe('formatSearchQuality', () => {
  it('1) null 필드 → N/A 표시', () => {
    const input: SearchQualityResult = {
      period: '24h',
      owner_id: null,
      search_count: null,
      avg_latency_ms: null,
      p95_latency_ms: null,
      empty_retrieval_rate: null,
      avg_candidate_count: null,
      top_k_selected_rate: null,
      timestamp: '2026-03-29T10:00:00.000Z',
    };
    const output = formatSearchQuality(input);
    expect(output).toContain('N/A');
    // 모든 수치 필드가 N/A
    expect(output).not.toMatch(/: \d/);
  });

  it('2) 정상 데이터 → 예상 출력 포함', () => {
    const input: SearchQualityResult = {
      period: '24h',
      owner_id: null,
      search_count: 42,
      avg_latency_ms: 123,
      p95_latency_ms: 456,
      empty_retrieval_rate: 0.125,
      avg_candidate_count: 8.3,
      top_k_selected_rate: 0.87,
      timestamp: '2026-03-29T10:00:00.000Z',
    };
    const output = formatSearchQuality(input);
    expect(output).toContain('42');
    expect(output).toContain('123');
    expect(output).toContain('456');
    expect(output).toContain('12.5');
  });
});

describe('formatMemoryQuality', () => {
  it('null 필드 → N/A 표시', () => {
    const input: MemoryQualityResult = {
      owner_id: null,
      total_memories: null,
      type_distribution: null,
      duplicate_write_rate_24h: null,
      relation_coverage_ratio: null,
      orphan_memory_ratio: null,
      timestamp: '2026-03-29T10:00:00.000Z',
    };
    const output = formatMemoryQuality(input);
    expect(output).toContain('N/A');
  });
});

describe('formatFeedbackQuality', () => {
  it('정상 데이터 → recall count·helpful rate·미피드백 비율 포함', () => {
    const output = formatFeedbackQuality({
      period: '24h',
      owner_id: null,
      helpful_rate: 0.75,
      positive_count: 3,
      negative_count: 1,
      feedback_with_ranking_context_count: 2,
      recall_count: 40,
      recall_without_feedback_rate: 0.9,
      timestamp: '2026-03-29T10:00:00.000Z',
    });
    expect(output).toContain('[Feedback Quality]');
    expect(output).toContain('40');
    expect(output).toContain('75.0 %');
    expect(output).toContain('90.0 %');
  });

  it('null 필드 → N/A 표시', () => {
    const output = formatFeedbackQuality({
      period: '24h',
      owner_id: null,
      helpful_rate: null,
      positive_count: 0,
      negative_count: 0,
      feedback_with_ranking_context_count: 0,
      recall_count: 0,
      recall_without_feedback_rate: null,
      timestamp: '2026-03-29T10:00:00.000Z',
    });
    expect(output).toContain('N/A');
  });
});

describe('formatSystemMetrics', () => {
  it('정상 데이터 → Recall/Remember/Feedback 섹션 포함 및 퍼센트 표시', () => {
    const output = formatSystemMetrics({
      period: '24h',
      tools: {
        recall: { request_count: 42, success_count: 40, error_count: 2, error_rate: 0.048, avg_latency_ms: 120, p95_latency_ms: 300 },
        remember: { request_count: 18, success_count: 18, error_count: 0, error_rate: 0, avg_latency_ms: 80, p95_latency_ms: 200 },
        feedback: { request_count: 3, success_count: 3, error_count: 0, error_rate: 0, avg_latency_ms: 50, p95_latency_ms: 100 },
      },
      background_jobs: {},
      timestamp: '2026-03-29T10:00:00.000Z',
    });
    expect(output).toContain('[System Metrics (24h)]');
    expect(output).toContain('Recall');
    expect(output).toContain('Remember');
    expect(output).toContain('Feedback');
    expect(output).toContain('42');   // recall request_count
    expect(output).toContain('%');    // error_rate 퍼센트 표시
  });

  it('null 필드 → N/A 표시', () => {
    const output = formatSystemMetrics({
      period: '7d',
      tools: {
        recall: { request_count: null, success_count: null, error_count: null, error_rate: null, avg_latency_ms: null, p95_latency_ms: null },
        remember: { request_count: null, success_count: null, error_count: null, error_rate: null, avg_latency_ms: null, p95_latency_ms: null },
        feedback: { request_count: null, success_count: null, error_count: null, error_rate: null, avg_latency_ms: null, p95_latency_ms: null },
      },
      background_jobs: {},
      timestamp: '2026-03-29T10:00:00.000Z',
    });
    expect(output).toContain('N/A');
  });
});

describe('executeTelemetry', () => {
  function makeNullRunner(): TelemetryRunner {
    return {
      getSearchQuality: () => ({
        period: '24h',
        owner_id: null,
        search_count: null,
        avg_latency_ms: null,
        p95_latency_ms: null,
        empty_retrieval_rate: null,
        avg_candidate_count: null,
        top_k_selected_rate: null,
        timestamp: '2026-03-29T10:00:00.000Z',
      }),
      getMemoryQuality: () => ({
        owner_id: null,
        total_memories: null,
        type_distribution: null,
        duplicate_write_rate_24h: null,
        relation_coverage_ratio: null,
        orphan_memory_ratio: null,
        timestamp: '2026-03-29T10:00:00.000Z',
      }),
      getSystemMetrics: () => ({
        period: '24h',
        tools: {
          recall: { request_count: null, success_count: null, error_count: null, error_rate: null, avg_latency_ms: null, p95_latency_ms: null },
          remember: { request_count: null, success_count: null, error_count: null, error_rate: null, avg_latency_ms: null, p95_latency_ms: null },
          feedback: { request_count: null, success_count: null, error_count: null, error_rate: null, avg_latency_ms: null, p95_latency_ms: null },
        },
        background_jobs: {},
        timestamp: '2026-03-29T10:00:00.000Z',
      }),
      getFeedbackQuality: (): FeedbackQualityResult => ({
        period: '24h',
        owner_id: null,
        helpful_rate: null,
        positive_count: 0,
        negative_count: 0,
        feedback_with_ranking_context_count: 0,
        recall_count: 0,
        recall_without_feedback_rate: null,
        timestamp: '2026-03-29T10:00:00.000Z',
      }),
    };
  }

  it('3) 빈 DB(데이터 없음) → "기록된 텔레메트리 데이터가 없습니다." 출력 + exit 0', () => {
    const result = executeTelemetry(makeNullRunner(), { period: '24h', type: 'all' });
    expect(result.stdout).toContain('기록된 텔레메트리 데이터가 없습니다.');
    expect(result.stderr).toBe('');
    expect(result.exitCode).toBe(0);
  });

  it('5) telemetry_events 테이블 없을 때(마이그레이션 미실행) → stderr 에러 메시지 + exit 1', () => {
    const errorRunner: TelemetryRunner = {
      ...makeNullRunner(),
      getSearchQuality: () => {
        throw new Error('no such table: telemetry_events');
      },
    };
    const result = executeTelemetry(errorRunner, { period: '24h', type: 'all' });
    expect(result.stderr).toContain('telemetry_events');
    expect(result.stdout).toBe('');
    expect(result.exitCode).toBe(1);
  });
});

describe('output line length', () => {
  it('4) 포맷된 출력의 각 줄이 80컬럼 이내', () => {
    // formatSearchQuality
    const searchOutput = formatSearchQuality({
      period: '24h',
      owner_id: null,
      search_count: 42,
      avg_latency_ms: 123,
      p95_latency_ms: 456,
      empty_retrieval_rate: 0.125,
      avg_candidate_count: 8.3,
      top_k_selected_rate: 0.87,
      timestamp: '2026-03-29T10:00:00.000Z',
    });
    for (const line of searchOutput.split('\n')) {
      expect(line.length, `formatSearchQuality line: "${line}"`).toBeLessThanOrEqual(80);
    }

    // formatMemoryQuality — type_distribution에 다수 항목 포함 (잠재적 초과 위험)
    const memoryOutput = formatMemoryQuality({
      owner_id: null,
      total_memories: 100,
      type_distribution: { episodic: 210, semantic: 180, procedural: 133, working: 50, core: 20, vault: 10 },
      duplicate_write_rate_24h: 0.021,
      relation_coverage_ratio: 0.782,
      orphan_memory_ratio: 0.053,
      timestamp: '2026-03-29T10:00:00.000Z',
    });
    for (const line of memoryOutput.split('\n')) {
      expect(line.length, `formatMemoryQuality line: "${line}"`).toBeLessThanOrEqual(80);
    }

    // formatSystemMetrics — 일반 케이스
    const systemOutput = formatSystemMetrics({
      period: '24h',
      tools: {
        recall: { request_count: 42, success_count: 40, error_count: 2, error_rate: 0.048, avg_latency_ms: 120, p95_latency_ms: 300 },
        remember: { request_count: 18, success_count: 18, error_count: 0, error_rate: 0, avg_latency_ms: 80, p95_latency_ms: 200 },
        feedback: { request_count: 3, success_count: 3, error_count: 0, error_rate: 0, avg_latency_ms: 50, p95_latency_ms: 100 },
      },
      background_jobs: {},
      timestamp: '2026-03-29T10:00:00.000Z',
    });
    for (const line of systemOutput.split('\n')) {
      expect(line.length, `formatSystemMetrics line: "${line}"`).toBeLessThanOrEqual(80);
    }

    // formatSystemMetrics — 극단값 (request_count 4자리, error_rate 100%)
    const systemOutputMax = formatSystemMetrics({
      period: '30d',
      tools: {
        recall: { request_count: 9999, success_count: 9999, error_count: 0, error_rate: 1.0, avg_latency_ms: 9999, p95_latency_ms: 9999 },
        remember: { request_count: 9999, success_count: 9999, error_count: 0, error_rate: 1.0, avg_latency_ms: 9999, p95_latency_ms: 9999 },
        feedback: { request_count: 9999, success_count: 9999, error_count: 0, error_rate: 1.0, avg_latency_ms: 9999, p95_latency_ms: 9999 },
      },
      background_jobs: {},
      timestamp: '2026-03-29T10:00:00.000Z',
    });
    for (const line of systemOutputMax.split('\n')) {
      expect(line.length, `formatSystemMetrics (max) line: "${line}"`).toBeLessThanOrEqual(80);
    }
  });
});

// Phase 4 — parseCliOptions 테스트

describe('parseCliOptions', () => {
  it('6) --period 7d → { period: "7d", type: "all" }', () => {
    const result = parseCliOptions(['--period', '7d']);
    expect(result).toEqual({ period: '7d', type: 'all' });
  });

  it('7) --period 1y → 잘못된 period 에러', () => {
    expect(() => parseCliOptions(['--period', '1y'])).toThrow();
  });

  it('8) --type memory-quality → { period: "24h", type: "memory-quality" }', () => {
    const result = parseCliOptions(['--type', 'memory-quality']);
    expect(result).toEqual({ period: '24h', type: 'memory-quality' });
  });

  it('9) --type invalid → 잘못된 type 에러', () => {
    expect(() => parseCliOptions(['--type', 'invalid'])).toThrow();
  });

  it('10) --type feedback-quality → { period: "24h", type: "feedback-quality" }', () => {
    const result = parseCliOptions(['--type', 'feedback-quality']);
    expect(result).toEqual({ period: '24h', type: 'feedback-quality' });
  });
});
