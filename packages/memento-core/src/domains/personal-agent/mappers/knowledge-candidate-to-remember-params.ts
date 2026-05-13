import type { RememberParams } from '../../memory/tools/remember-tool.js';
import type { KnowledgeCandidate } from '../types/agent-types.js';

export interface RememberParamsMappingContext {
  projectId?: string;
  ownerId?: string | string[];
  sessionId?: string;
  processId?: string;
}

export type MapKnowledgeCandidateToRememberParamsResult =
  | { ok: true; params: RememberParams }
  | { ok: false; errorMessage: string };

function normalizeOwnerId(ownerId?: string | string[]): string | undefined {
  if (ownerId === undefined) return undefined;
  if (typeof ownerId === 'string') return ownerId;
  return ownerId[0];
}

/** `candidate.content` 줄을 remember procedural `steps` JSON 배열 문자열로 변환 (#235 스펙) */
export function buildProceduralStepsJson(content: string): string {
  const lines = content.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const steps = lines.map((line, idx) => {
    const m = line.match(/^(\d+)\.\s*(.+)$/);
    if (m?.[1] != null && m[2] != null) {
      return { step: Number.parseInt(m[1], 10), description: m[2].trim() };
    }
    return { step: idx + 1, description: line };
  });
  return JSON.stringify(steps);
}

function assertUnreachable(t: never): never {
  throw new Error(`unexpected memory type: ${String(t)}`);
}

/**
 * 승인된 개인 지식 후보를 Remember 도구 입력으로 변환한다.
 * `SuggestedPersonalMemoryType`은 `working`·`core`·`vault`를 제외한다.
 */
export function mapKnowledgeCandidateToRememberParams(
  candidate: KnowledgeCandidate,
  ctx: RememberParamsMappingContext,
): MapKnowledgeCandidateToRememberParamsResult {
  const t = candidate.suggestedMemoryType;
  const owner_id = normalizeOwnerId(ctx.ownerId);

  const base: Pick<
    RememberParams,
    'tags' | 'importance' | 'source' | 'privacy_scope' | 'project_id' | 'owner_id' | 'process_id' | 'session_id'
  > = {
    tags: candidate.tags,
    importance: candidate.importance,
    source: 'personal-knowledge-agent',
    privacy_scope: 'private',
    project_id: ctx.projectId,
    owner_id,
    process_id: ctx.processId,
    session_id: ctx.sessionId,
  };

  switch (t) {
    case 'semantic':
    case 'episodic': {
      const episodicOnly =
        t === 'episodic' ? ({ enable_triple_extraction: true } satisfies Pick<RememberParams, 'enable_triple_extraction'>) : {};
      return {
        ok: true,
        params: {
          type: t,
          content: candidate.content,
          ...episodicOnly,
          ...base,
        },
      };
    }
    case 'procedural':
      return {
        ok: true,
        params: {
          type: 'procedural',
          content: candidate.content,
          task_goal: '개인 지식 에이전트 절차',
          steps: buildProceduralStepsJson(candidate.content),
          ...base,
        },
      };
    default:
      return assertUnreachable(t);
  }
}
