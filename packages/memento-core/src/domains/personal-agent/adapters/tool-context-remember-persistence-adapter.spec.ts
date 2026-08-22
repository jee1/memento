import { describe, it, expect, vi } from 'vitest';
import { RememberTool } from '../../memory/remember/remember-tool.js';
import { ToolContextRememberPersistenceAdapter } from './tool-context-remember-persistence-adapter.js';
import type { KnowledgeCandidate } from '../types/agent-types.js';
import type { ToolContext } from '../../../tools/types.js';

describe('ToolContextRememberPersistenceAdapter', () => {
  it('승인 id가 스냅샷에 없으면 error 한 행을 반환한다', async () => {
    const adapter = new ToolContextRememberPersistenceAdapter({} as ToolContext);
    const out = await adapter.persistApproved({
      candidates: [],
      approvedCandidateIds: ['kc_missing'],
    });
    expect(out.items).toEqual([
      {
        candidateId: 'kc_missing',
        status: 'error',
        errorMessage: '승인 id에 해당하는 후보가 candidates 스냅샷에 없습니다',
      },
    ]);
    expect(out.errorCount).toBe(1);
    expect(out.persistedCount).toBe(0);
  });

  it('approvedCandidateIds 중복은 한 번만 처리한다', async () => {
    const rememberSpy = vi.spyOn(RememberTool.prototype, 'handle').mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify({ memory_id: 'mem_dup' }) }],
    });

    const c: KnowledgeCandidate = {
      id: 'kc_1',
      category: 'preference',
      content: 'x',
      reason: 'r',
      suggestedMemoryType: 'semantic',
      tags: ['t'],
      importance: 0.5,
      confidence: 0.9,
    };

    const adapter = new ToolContextRememberPersistenceAdapter({ db: {} } as ToolContext);
    const out = await adapter.persistApproved({
      candidates: [c],
      approvedCandidateIds: ['kc_1', 'kc_1'],
    });

    expect(rememberSpy).toHaveBeenCalledTimes(1);
    expect(out.persistedCount).toBe(1);
    expect(out.items).toEqual([{ candidateId: 'kc_1', status: 'persisted', memoryId: 'mem_dup' }]);

    rememberSpy.mockRestore();
  });
});
