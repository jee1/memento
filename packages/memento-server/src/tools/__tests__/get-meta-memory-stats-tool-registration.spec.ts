/**
 * GetMetaMemoryStatsTool 등록 테스트
 * 
 * Phase 5.3: get_meta_memory_stats 도구는 MCP에서 제거되고 HTTP API로만 제공됩니다.
 * 이 테스트는 더 이상 유효하지 않으므로 스킵 처리합니다.
 * 
 * HTTP API 엔드포인트: GET /admin/memory/meta-stats
 */

import { describe, it } from 'vitest';

describe('GetMetaMemoryStatsTool 등록', () => {
  it.skip('given: 도구가 생성될 때, when: 도구 레지스트리를 확인하면, then: get_meta_memory_stats 도구가 등록되어야 함', () => {
    // Phase 5.3: 이 도구는 MCP에서 제거되고 HTTP API로만 제공됩니다.
    // HTTP API: GET /admin/memory/meta-stats
  });

  it.skip('given: 모든 도구 목록을 조회할 때, when: 도구 목록을 확인하면, then: get_meta_memory_stats 도구가 포함되어야 함', () => {
    // Phase 5.3: 이 도구는 MCP에서 제거되고 HTTP API로만 제공됩니다.
    // HTTP API: GET /admin/memory/meta-stats
  });

  it.skip('given: 도구 레지스트리에서 직접 조회할 때, when: get_meta_memory_stats를 조회하면, then: 도구 정의가 반환되어야 함', () => {
    // Phase 5.3: 이 도구는 MCP에서 제거되고 HTTP API로만 제공됩니다.
    // HTTP API: GET /admin/memory/meta-stats
  });
});
