import { describe, it, expect, vi, beforeEach } from 'vitest';
import { INTROSPECTION_HINT_SUFFIX } from '../../../../shared/constants/introspection-constants.js';
import { IntrospectionScanCache } from '../../introspection/introspection-scan-cache.js';
import { describeRecallTool, db, tool, context, hybridSearchEngine } from './recall-tool.test-setup.js';

const SCAN_SUMMARY =
  '저신뢰 메모리 2212건, 고실패 메모리 502건. 재검토 또는 최신 정보 반영을 권장합니다. (ID 목록은 상위 1000건만 포함)';
const SCANNED_AT = '2026-09-18T10:53:27.032Z';

describeRecallTool('introspection hint integration (#997)', () => {
  let cache: IntrospectionScanCache;

  beforeEach(() => {
    cache = new IntrospectionScanCache();
  });

  function injectCache(): void {
    (context.services as Record<string, unknown>).introspectionScanCache = cache;
  }

  async function recallWithSeededMemory(memoryId: string, content: string) {
    db.prepare(`
      INSERT INTO memory_item (id, type, content, importance, created_at)
      VALUES (?, 'semantic', ?, 0.8, CURRENT_TIMESTAMP)
    `).run(memoryId, content);

    vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
      items: [
        {
          id: memoryId,
          content,
          type: 'semantic',
          importance: 0.8,
          created_at: new Date().toISOString(),
          finalScore: 0.9,
        },
      ],
      total_count: 1,
      query_time: 5,
    });

    const result = await tool.handle(
      { query: content, type: 'semantic', limit: 3 },
      context,
    );
    return JSON.parse(result.content[0].text);
  }

  describe('T9 — 천장 회귀 가드 (엔드투엔드)', () => {
    beforeEach(() => {
      cache.set(
        {
          lowConfidenceMemoryIds: ['mem_a'],
          highFailureMemoryIds: ['mem_b', 'mem_c'],
          lowConfidenceTotal: 2212,
          highFailureTotal: 502,
          truncated: true,
          summary: SCAN_SUMMARY,
        },
        SCANNED_AT,
      );
      injectCache();
    });

    it('recall 응답의 introspection_hint 건수는 ID 목록 길이가 아니라 총계를 쓴다', async () => {
      const resultData = await recallWithSeededMemory(
        'mem_introspection_hint_997',
        'introspection hint ceiling regression',
      );

      expect(resultData.introspection_hint).toBeDefined();
      expect(resultData.introspection_hint.low_confidence_count).toBe(2212);
      expect(resultData.introspection_hint.low_confidence_count).not.toBe(1);
      expect(resultData.introspection_hint.high_failure_count).toBe(502);
      expect(resultData.introspection_hint.high_failure_count).not.toBe(2);
      expect(resultData.introspection_hint.scanned_at).toBe(SCANNED_AT);
      expect(resultData.introspection_hint.summary).toBe(`${SCAN_SUMMARY}${INTROSPECTION_HINT_SUFFIX}`);
    });
  });

  describe('T10 — 플래그할 것이 없으면 힌트를 붙이지 않는다', () => {
    beforeEach(() => {
      cache.set(
        {
          lowConfidenceMemoryIds: [],
          highFailureMemoryIds: [],
          lowConfidenceTotal: 0,
          highFailureTotal: 0,
          truncated: false,
          summary: '플래그 없음',
        },
        SCANNED_AT,
      );
      injectCache();
    });

    it('두 총계가 모두 0이면 introspection_hint 키가 없다', async () => {
      const resultData = await recallWithSeededMemory(
        'mem_introspection_hint_997_empty',
        'no introspection flags',
      );

      expect(resultData.introspection_hint).toBeUndefined();
    });
  });

  describe('T11 — 캐시 자체가 없으면 힌트가 없다', () => {
    it('introspectionScanCache 를 주입하지 않으면 introspection_hint 가 없다', async () => {
      const resultData = await recallWithSeededMemory(
        'mem_introspection_hint_997_no_cache',
        'no introspection cache',
      );

      expect(resultData.introspection_hint).toBeUndefined();
    });
  });
});
