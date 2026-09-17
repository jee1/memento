import { describe, it, expect } from 'vitest';
import { ZodError } from 'zod';
import { RememberSchema } from '../remember-tool-schema.js';

describe('RememberSchema (#1000)', () => {
  it('memory_id를 포함한 파라미터가 파싱된다', () => {
    const parsed = RememberSchema.parse({
      type: 'episodic',
      content: '갱신 대상 테스트',
      memory_id: 'mem_target_001',
      update_mode: 'replace',
    });

    expect(parsed.memory_id).toBe('mem_target_001');
    expect(parsed.update_mode).toBe('replace');
  });

  it('미지원 키는 ZodError로 거절된다', () => {
    const unsupportedKeys = [
      { type: 'episodic', content: 'x', id: 'mem_bad' },
      { type: 'episodic', content: 'x', memoryId: 'mem_bad' },
      { type: 'episodic', content: 'x', typo_field: true },
    ];

    for (const params of unsupportedKeys) {
      expect(() => RememberSchema.parse(params)).toThrow(ZodError);
    }
  });

  it('기존 정상 파라미터 조합은 그대로 통과한다', () => {
    expect(() => RememberSchema.parse({
      type: 'semantic',
      content: '지식 저장',
      tags: ['knowledge'],
      importance: 0.8,
      project_id: 'proj-a',
    })).not.toThrow();

    expect(() => RememberSchema.parse({
      type: 'core',
      key: 'identity',
      value: 'assistant',
    })).not.toThrow();

    expect(() => RememberSchema.parse({
      type: 'procedural',
      content: '절차',
      workflow_name: 'deploy',
      skill_name: 'rollback',
      update_mode: 'incremental',
    })).not.toThrow();
  });
});
