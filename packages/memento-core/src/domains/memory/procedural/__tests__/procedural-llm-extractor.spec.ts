/**
 * LlmProceduralExtractor 단위 테스트
 * Given/When/Then 및 주입된 completion으로 실제 LLM 호출 없이 검증
 */

import { describe, it, expect, vi } from 'vitest';
import { LlmProceduralExtractor } from '../procedural-llm-extractor.js';
import type { ExtractedProceduralMemory } from '../procedural-memory-extractor.types.js';

describe('LlmProceduralExtractor', () => {
  it('Given: 유효한 JSON 응답을 반환하는 completion이 주어졌을 때, When: extract()를 호출하면, Then: ExtractedProceduralMemory를 반환한다', async () => {
    const validPayload: ExtractedProceduralMemory = {
      workflow_name: '데이터 검증',
      skill_name: '검증 스킬',
      steps: '["단계1", "단계2"]',
      trigger_conditions: '{"tool_name":"remember"}',
      task_goal: '테스트 작업'
    };
    const completion = vi.fn().mockResolvedValue(JSON.stringify(validPayload));

    const extractor = new LlmProceduralExtractor({ completion });
    const notes = { original_task: '테스트', suggested_improvements: '검증하라' };
    const result = await extractor.extract(notes);

    expect(result).not.toBeNull();
    expect(result?.workflow_name).toBe('데이터 검증');
    expect(result?.skill_name).toBe('검증 스킬');
    expect(result?.steps).toBe('["단계1", "단계2"]');
    expect(completion).toHaveBeenCalledTimes(1);
  });

  it('Given: completion이 잘못된 JSON을 반환했을 때, When: extract()를 호출하면, Then: null을 반환한다', async () => {
    const completion = vi.fn().mockResolvedValue('not valid json {');

    const extractor = new LlmProceduralExtractor({ completion });
    const result = await extractor.extract({ original_task: 'x' });

    expect(result).toBeNull();
  });

  it('Given: completion이 예외를 던졌을 때, When: extract()를 호출하면, Then: null을 반환한다', async () => {
    const completion = vi.fn().mockRejectedValue(new Error('Network error'));

    const extractor = new LlmProceduralExtractor({ completion });
    const result = await extractor.extract({ original_task: 'x' });

    expect(result).toBeNull();
  });

  it('Given: completion이 코드블록으로 감싼 JSON을 반환했을 때, When: extract()를 호출하면, Then: 파싱된 객체를 반환한다', async () => {
    const validPayload = {
      workflow_name: '마이그레이션',
      skill_name: '스키마 변경',
      steps: '[]',
      trigger_conditions: '{}',
      task_goal: '목표'
    };
    const completion = vi.fn().mockResolvedValue('```json\n' + JSON.stringify(validPayload) + '\n```');

    const extractor = new LlmProceduralExtractor({ completion });
    const result = await extractor.extract({});

    expect(result).not.toBeNull();
    expect(result?.workflow_name).toBe('마이그레이션');
  });
});
