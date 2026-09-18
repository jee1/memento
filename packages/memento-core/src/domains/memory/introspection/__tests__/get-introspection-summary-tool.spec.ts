/**
 * Get Introspection Summary Tool 테스트 (Issue #21 Phase B)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { GetIntrospectionSummaryTool } from '../get-introspection-summary-tool.js';
import { IntrospectionScanCache } from '../introspection-scan-cache.js';
import type { ToolContext } from '../../../../tools/types.js';

describe('GetIntrospectionSummaryTool', () => {
  let tool: GetIntrospectionSummaryTool;
  let cache: IntrospectionScanCache;

  beforeEach(() => {
    tool = new GetIntrospectionSummaryTool();
    cache = new IntrospectionScanCache();
  });

  it('getDefinition() returns name get_introspection_summary', () => {
    const def = tool.getDefinition();
    expect(def.name).toBe('get_introspection_summary');
    expect(def.description).toContain('기억 품질');
    expect(def.inputSchema).toBeDefined();
  });

  it('returns empty message when cache is empty (no introspectionScanCache)', async () => {
    const context = { db: null as any, services: {} } as ToolContext;
    const result = await tool.handle({}, context);
    const text = result.content[0]?.text;
    expect(text).toBeDefined();
    const parsed = JSON.parse(text!);
    expect(parsed.summary).toContain('스캔 결과가 없습니다');
    expect(parsed.lowConfidenceMemoryIds).toEqual([]);
    expect(parsed.highFailureMemoryIds).toEqual([]);
    expect(parsed.scanned_at).toBeNull();
  });

  it('returns cached result when cache has data', async () => {
    const scanResult = {
      lowConfidenceMemoryIds: ['mem_low1'],
      highFailureMemoryIds: ['mem_high1', 'mem_high2'],
      lowConfidenceTotal: 1,
      highFailureTotal: 2,
      truncated: false,
      summary: '저신뢰 메모리 1건, 고실패 메모리 2건.'
    };
    cache.set(scanResult, '2026-03-15T12:00:00.000Z');
    const context = { db: null as any, services: { introspectionScanCache: cache } } as ToolContext;
    const result = await tool.handle({}, context);
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed.summary).toBe(scanResult.summary);
    expect(parsed.lowConfidenceMemoryIds).toEqual(scanResult.lowConfidenceMemoryIds);
    expect(parsed.highFailureMemoryIds).toEqual(scanResult.highFailureMemoryIds);
    expect(parsed.scanned_at).toBe('2026-03-15T12:00:00.000Z');
  });

  /** T4: 캐시의 총계·truncated 필드가 응답에 그대로 실림 */
  it('returns lowConfidenceTotal, highFailureTotal, and truncated from cache', async () => {
    const scanResult = {
      lowConfidenceMemoryIds: ['a'],
      highFailureMemoryIds: [],
      lowConfidenceTotal: 2212,
      highFailureTotal: 0,
      truncated: true,
      summary: '저신뢰 메모리 2212건, 고실패 메모리 0건. 재검토 또는 최신 정보 반영을 권장합니다. (ID 목록은 상위 1000건만 포함)'
    };
    cache.set(scanResult, '2026-09-18T10:53:27.032Z');
    const context = { db: null as any, services: { introspectionScanCache: cache } } as ToolContext;
    const result = await tool.handle({}, context);
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed.lowConfidenceTotal).toBe(2212);
    expect(parsed.highFailureTotal).toBe(0);
    expect(parsed.truncated).toBe(true);
    expect(parsed.lowConfidenceMemoryIds).toEqual(['a']);
  });
});
