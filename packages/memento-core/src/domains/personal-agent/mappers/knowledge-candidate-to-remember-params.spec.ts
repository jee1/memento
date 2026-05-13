import { describe, it, expect } from 'vitest';
import {
  buildProceduralStepsJson,
  mapKnowledgeCandidateToRememberParams,
} from './knowledge-candidate-to-remember-params.js';
import type { KnowledgeCandidate } from '../types/agent-types.js';

function baseCandidate(over: Partial<KnowledgeCandidate>): KnowledgeCandidate {
  return {
    id: 'kc_test',
    category: 'preference',
    content: '본문',
    reason: '이유',
    suggestedMemoryType: 'semantic',
    tags: ['personal-agent', 'preference'],
    importance: 0.55,
    confidence: 0.9,
    ...over,
  };
}

describe('buildProceduralStepsJson', () => {
  it('번호 붙은 줄이면 step 번호를 유지한다', () => {
    const json = buildProceduralStepsJson('1. 첫 단계\n2. 둘째');
    expect(JSON.parse(json)).toEqual([
      { step: 1, description: '첫 단계' },
      { step: 2, description: '둘째' },
    ]);
  });

  it('일반 줄이면 1부터 순서를 매긴다', () => {
    const json = buildProceduralStepsJson('A\nB');
    expect(JSON.parse(json)).toEqual([
      { step: 1, description: 'A' },
      { step: 2, description: 'B' },
    ]);
  });
});

describe('mapKnowledgeCandidateToRememberParams', () => {
  const ctx = { projectId: 'p1', ownerId: 'agent-1', sessionId: 's1', processId: 'proc1' };

  it('semantic 후보를 매핑한다', () => {
    const r = mapKnowledgeCandidateToRememberParams(baseCandidate({ suggestedMemoryType: 'semantic' }), ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.params.type).toBe('semantic');
    expect(r.params.content).toBe('본문');
    expect(r.params.tags).toEqual(['personal-agent', 'preference']);
    expect(r.params.source).toBe('personal-knowledge-agent');
    expect(r.params.project_id).toBe('p1');
    expect(r.params.owner_id).toBe('agent-1');
    expect(r.params.session_id).toBe('s1');
    expect(r.params.process_id).toBe('proc1');
    expect(r.params.enable_triple_extraction).toBeUndefined();
  });

  it('episodic이면 enable_triple_extraction true', () => {
    const r = mapKnowledgeCandidateToRememberParams(baseCandidate({ suggestedMemoryType: 'episodic' }), ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.params.enable_triple_extraction).toBe(true);
  });

  it('procedural이면 task_goal·steps·content를 채운다', () => {
    const r = mapKnowledgeCandidateToRememberParams(
      baseCandidate({
        suggestedMemoryType: 'procedural',
        content: '1. 빌드\n2. 테스트',
      }),
      {},
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.params.type).toBe('procedural');
    expect(r.params.task_goal).toBe('개인 지식 에이전트 절차');
    expect(r.params.content).toBe('1. 빌드\n2. 테스트');
    expect(JSON.parse(r.params.steps!)).toEqual([
      { step: 1, description: '빌드' },
      { step: 2, description: '테스트' },
    ]);
  });

  it('ownerId가 배열이면 첫 요소를 사용한다', () => {
    const r = mapKnowledgeCandidateToRememberParams(baseCandidate({}), { ownerId: ['a', 'b'] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.params.owner_id).toBe('a');
  });
});
