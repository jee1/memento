/**
 * GetTelemetrySummaryTool 테스트 (specs/007-telemetry-cli-mcp)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GetTelemetrySummaryTool } from './get-telemetry-summary-tool.js';
import type { ToolContext } from '../../../tools/types.js';
import type { TelemetryService } from '../services/telemetry-service.js';
import type { SearchQualityResult, MemoryQualityResult } from '../repositories/telemetry-repository.js';

function makeSearchQuality(overrides: Partial<SearchQualityResult> = {}): SearchQualityResult {
  return {
    period: '24h',
    owner_id: null,
    search_count: 42,
    avg_latency_ms: 123.4,
    p95_latency_ms: 456.7,
    empty_retrieval_rate: 0.125,
    avg_candidate_count: 8.3,
    top_k_selected_rate: 0.87,
    timestamp: '2026-03-29T10:00:00.000Z',
    ...overrides,
  };
}

function makeMemoryQuality(overrides: Partial<MemoryQualityResult> = {}): MemoryQualityResult {
  return {
    owner_id: null,
    total_memories: 523,
    type_distribution: { episodic: 210, semantic: 180, procedural: 133 },
    duplicate_write_rate_24h: 0.021,
    relation_coverage_ratio: 0.782,
    orphan_memory_ratio: 0.053,
    timestamp: '2026-03-29T10:00:00.000Z',
    ...overrides,
  };
}

function makeContext(
  overrides: Partial<{
    ownerId: string | null;
    searchQuality: SearchQualityResult;
    memoryQuality: MemoryQualityResult;
    getSearchQualityImpl: (...args: unknown[]) => SearchQualityResult;
    getMemoryQualityImpl: (...args: unknown[]) => MemoryQualityResult;
  }> = {}
): ToolContext {
  const {
    ownerId = null,
    searchQuality = makeSearchQuality(),
    memoryQuality = makeMemoryQuality(),
    getSearchQualityImpl,
    getMemoryQualityImpl,
  } = overrides;

  const mockTelemetryService = {
    getContext: vi.fn().mockReturnValue(ownerId !== null ? { ownerId, requestId: 'r1' } : undefined),
    getSearchQuality: getSearchQualityImpl
      ? vi.fn().mockImplementation(getSearchQualityImpl)
      : vi.fn().mockReturnValue(searchQuality),
    getMemoryQuality: getMemoryQualityImpl
      ? vi.fn().mockImplementation(getMemoryQualityImpl)
      : vi.fn().mockReturnValue(memoryQuality),
  } as unknown as TelemetryService;

  return {
    db: {} as any,
    services: {
      telemetryService: mockTelemetryService,
    },
  };
}

describe('GetTelemetrySummaryTool', () => {
  let tool: GetTelemetrySummaryTool;

  beforeEach(() => {
    tool = new GetTelemetrySummaryTool();
  });

  it('1) period 미지정 시 기본값 24h 사용', async () => {
    const context = makeContext();
    const result = await tool.handle({}, context);
    const data = JSON.parse(result.content[0].text);
    expect(data.period).toBe('24h');
    expect(context.services.telemetryService!.getSearchQuality).toHaveBeenCalledWith('24h', null);
  });

  it('2) ALS context의 ownerId로 필터링된 데이터 반환', async () => {
    const context = makeContext({ ownerId: 'agent-123' });
    const result = await tool.handle({ period: '7d' }, context);
    const data = JSON.parse(result.content[0].text);
    expect(data.owner_id).toBe('agent-123');
    expect(context.services.telemetryService!.getSearchQuality).toHaveBeenCalledWith('7d', 'agent-123');
    expect(context.services.telemetryService!.getMemoryQuality).toHaveBeenCalledWith('agent-123');
  });

  it('3) 잘못된 period → createErrorResult() 반환', async () => {
    const context = makeContext();
    const result = await tool.handle({ period: '1y' }, context);
    const data = JSON.parse(result.content[0].text);
    expect(data.error).toBeDefined();
    expect(data.error).toContain('Invalid period');
    // 에러 시 telemetry 호출 없음
    expect(context.services.telemetryService!.getSearchQuality).not.toHaveBeenCalled();
  });

  it('4) search_count 등 모든 필드가 null인 SearchQualityResult → null 필드 포함 응답', async () => {
    const nullSearch = makeSearchQuality({
      search_count: null,
      avg_latency_ms: null,
      p95_latency_ms: null,
      empty_retrieval_rate: null,
      avg_candidate_count: null,
      top_k_selected_rate: null,
    });
    const nullMemory = makeMemoryQuality({
      total_memories: null,
      type_distribution: null,
      duplicate_write_rate_24h: null,
      relation_coverage_ratio: null,
      orphan_memory_ratio: null,
    });
    const context = makeContext({ searchQuality: nullSearch, memoryQuality: nullMemory });
    const result = await tool.handle({}, context);
    const data = JSON.parse(result.content[0].text);
    expect(data.search_quality.search_count).toBeNull();
    expect(data.search_quality.avg_latency_ms).toBeNull();
    expect(data.memory_quality.total_memories).toBeNull();
    expect(data.memory_quality.type_distribution).toBeNull();
  });

  it('5) telemetry_events 테이블 없을 때 → createErrorResult() 반환', async () => {
    const context = makeContext({
      getSearchQualityImpl: () => {
        throw new Error('no such table: telemetry_events');
      },
    });
    const result = await tool.handle({}, context);
    const data = JSON.parse(result.content[0].text);
    expect(data.error).toBeDefined();
    expect(data.error).toContain('telemetry_events');
  });
});
