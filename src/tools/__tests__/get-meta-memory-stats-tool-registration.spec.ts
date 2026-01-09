/**
 * GetMetaMemoryStatsTool 등록 테스트
 * 도구 레지스트리에 get_meta_memory_stats 도구가 등록되는지 확인
 */

import { describe, it, expect } from 'vitest';
import { getToolRegistry, getAllTools, getTool } from '../index.js';

describe('GetMetaMemoryStatsTool 등록', () => {
  it('given: 도구가 생성될 때, when: 도구 레지스트리를 확인하면, then: get_meta_memory_stats 도구가 등록되어야 함', () => {
    // Given: 도구 레지스트리
    const registry = getToolRegistry();

    // When: 도구 레지스트리에서 get_meta_memory_stats 도구 조회
    const tool = getTool('get_meta_memory_stats');

    // Then: get_meta_memory_stats 도구가 등록되어야 함
    expect(tool).toBeDefined();
    expect(tool?.name).toBe('get_meta_memory_stats');
    expect(tool?.description).toBeDefined();
    expect(tool?.inputSchema).toBeDefined();
    expect(typeof tool?.handler).toBe('function');
  });

  it('given: 모든 도구 목록을 조회할 때, when: 도구 목록을 확인하면, then: get_meta_memory_stats 도구가 포함되어야 함', () => {
    // Given: 도구 레지스트리
    // When: 모든 도구 목록 조회
    const allTools = getAllTools();

    // Then: get_meta_memory_stats 도구가 포함되어야 함
    const tool = allTools.find(t => t.name === 'get_meta_memory_stats');
    expect(tool).toBeDefined();
    expect(tool?.name).toBe('get_meta_memory_stats');
  });

  it('given: 도구 레지스트리에서 직접 조회할 때, when: get_meta_memory_stats를 조회하면, then: 도구 정의가 반환되어야 함', () => {
    // Given: 도구 레지스트리
    const registry = getToolRegistry();

    // When: get_meta_memory_stats 도구 조회
    const tool = registry.get('get_meta_memory_stats');

    // Then: 도구 정의가 반환되어야 함
    expect(tool).toBeDefined();
    expect(tool?.name).toBe('get_meta_memory_stats');
    expect(tool?.description).toContain('메타 메모리 통계');
    expect(tool?.inputSchema).toHaveProperty('type', 'object');
    expect(tool?.inputSchema.properties).toBeDefined();
  });
});
