import type { ToolContext, ToolResult } from '../../../tools/types.js';
import { RememberTool } from '../../memory/remember/remember-tool.js';
import { mapKnowledgeCandidateToRememberParams } from '../mappers/knowledge-candidate-to-remember-params.js';
import type { IPersistencePort } from '../ports/persistence-port.js';
import type {
  PersonalKnowledgePersistInput,
  PersonalKnowledgePersistItemResult,
  PersonalKnowledgePersistResult,
} from '../types/agent-types.js';

function parseRememberSuccess(result: ToolResult): { ok: true; memoryId: string } | { ok: false; errorMessage: string } {
  if ('error' in result && result.error) {
    const msg =
      typeof result.error === 'string'
        ? result.error
        : typeof result.message === 'string'
          ? result.message
          : 'remember 오류';
    return { ok: false, errorMessage: msg };
  }
  const block = result.content?.[0];
  const text = block && block.type === 'text' ? block.text : null;
  if (!text) {
    return { ok: false, errorMessage: 'remember 응답 본문이 없습니다' };
  }
  try {
    const data = JSON.parse(text) as { memory_id?: string };
    if (typeof data.memory_id !== 'string' || data.memory_id.length === 0) {
      return { ok: false, errorMessage: 'memory_id 없음' };
    }
    return { ok: true, memoryId: data.memory_id };
  } catch {
    return { ok: false, errorMessage: 'remember 응답 JSON 파싱 실패' };
  }
}

/**
 * MCP `ToolContext`로 `remember`를 호출해 승인된 후보만 저장한다 (#235).
 */
export class ToolContextRememberPersistenceAdapter implements IPersistencePort {
  private readonly rememberTool = new RememberTool();

  constructor(private readonly toolContext: ToolContext) {}

  async persistApproved(input: PersonalKnowledgePersistInput): Promise<PersonalKnowledgePersistResult> {
    const items: PersonalKnowledgePersistItemResult[] = [];
    const seen = new Set<string>();
    const byId = new Map(input.candidates.map((c) => [c.id, c]));

    const ctx = {
      projectId: input.projectId,
      ownerId: input.ownerId,
      sessionId: input.sessionId,
      processId: input.processId,
    };

    for (const rawId of input.approvedCandidateIds) {
      if (seen.has(rawId)) continue;
      seen.add(rawId);

      const candidate = byId.get(rawId);
      if (!candidate) {
        items.push({
          candidateId: rawId,
          status: 'error',
          errorMessage: '승인 id에 해당하는 후보가 candidates 스냅샷에 없습니다',
        });
        continue;
      }

      const mapped = mapKnowledgeCandidateToRememberParams(candidate, ctx);
      if (mapped.ok === false) {
        items.push({ candidateId: candidate.id, status: 'error', errorMessage: mapped.errorMessage });
        continue;
      }

      try {
        const result = await this.rememberTool.handle(mapped.params, this.toolContext);
        const parsed = parseRememberSuccess(result);
        if (parsed.ok === false) {
          items.push({ candidateId: candidate.id, status: 'error', errorMessage: parsed.errorMessage });
          continue;
        }
        items.push({ candidateId: candidate.id, status: 'persisted', memoryId: parsed.memoryId });
      } catch (e) {
        const errorMessage = e instanceof Error ? e.message : String(e);
        items.push({ candidateId: candidate.id, status: 'error', errorMessage });
      }
    }

    const persistedCount = items.filter((i) => i.status === 'persisted').length;
    const errorCount = items.filter((i) => i.status === 'error').length;
    return { items, persistedCount, errorCount };
  }
}
