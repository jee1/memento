import { describe, expect, it } from 'vitest';
import {
  AgentContextRecallService,
  type AgentContextCandidate,
  type AgentContextRecallSource,
} from './agent-context-recall-service.js';

const NOW = '2026-06-07T00:00:00.000Z';

function candidate(
  id: string,
  content: string,
  overrides: Partial<AgentContextCandidate> = {},
): AgentContextCandidate {
  return {
    id,
    content,
    type: 'semantic',
    relevance: 0.8,
    importance: 0.7,
    createdAt: '2026-06-06T00:00:00.000Z',
    provenanceConfidence: 0.9,
    privacyScope: 'private',
    ownerId: 'owner-a',
    projectId: 'project-a',
    processId: 'process-a',
    sessionId: 'session-a',
    topics: ['agent-memory'],
    ...overrides,
  };
}

function source(
  name: string,
  items: AgentContextCandidate[] | Error,
): AgentContextRecallSource {
  return {
    name,
    recall: async () => {
      if (items instanceof Error) {
        throw items;
      }
      return { items };
    },
  };
}

const baseRequest = {
  query: 'context packing',
  scope: {
    ownerId: 'owner-a',
    projectId: 'project-a',
    processId: 'process-a',
    sessionId: 'session-a',
  },
  tokenBudget: 200,
  now: NOW,
};

describe('AgentContextRecallService', () => {
  it('excludes private memories from another owner or project and preserves scope fallback priority', async () => {
    const service = new AgentContextRecallService({
      sources: [
        source('hybrid', [
          candidate('session', 'session exact'),
          candidate('process', 'process fallback', { sessionId: 'session-old' }),
          candidate('project', 'project fallback', {
            processId: 'process-old',
            sessionId: 'session-old',
          }),
          candidate('owner', 'owner fallback', {
            projectId: null,
            processId: null,
            sessionId: null,
          }),
          candidate('other-owner', 'must never leak owner', { ownerId: 'owner-b' }),
          candidate('other-project', 'must never leak project', { projectId: 'project-b' }),
        ]),
      ],
      tokenEstimator: { estimate: () => 10 },
    });

    const result = await service.buildContext(baseRequest);

    expect(result.selected.map((item) => item.id)).toEqual([
      'session',
      'process',
      'project',
      'owner',
    ]);
    expect(result.selected.map((item) => item.scopeLevel)).toEqual([
      'session',
      'process',
      'project',
      'owner',
    ]);
    expect(result.excluded).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'other-owner',
          reason: 'privacy_scope_mismatch',
          score: 0,
          tokenEstimate: 21,
        }),
        expect.objectContaining({
          id: 'other-project',
          reason: 'privacy_scope_mismatch',
          score: 0,
          tokenEstimate: 21,
        }),
      ]),
    );
  });

  it('allows team memories only inside the current project', async () => {
    const service = new AgentContextRecallService({
      sources: [
        source('hybrid', [
          candidate('team-same-project', 'shared project decision', {
            privacyScope: 'team',
            ownerId: 'owner-b',
            processId: 'other-process',
            sessionId: 'other-session',
          }),
          candidate('team-other-project', 'other project decision', {
            privacyScope: 'team',
            ownerId: 'owner-b',
            projectId: 'project-b',
          }),
        ]),
      ],
      tokenEstimator: { estimate: () => 10 },
    });

    const result = await service.buildContext(baseRequest);

    expect(result.selected.map((item) => item.id)).toEqual(['team-same-project']);
    expect(result.selected[0]?.scopeLevel).toBe('project');
    expect(result.excluded).toContainEqual(
      expect.objectContaining({
        id: 'team-other-project',
        reason: 'privacy_scope_mismatch',
      }),
    );
  });

  it('does not expose project-private memories when the request has no project scope', async () => {
    const service = new AgentContextRecallService({
      sources: [
        source('hybrid', [
          candidate('project-private', 'project-only decision'),
          candidate('owner-private', 'owner fallback', {
            projectId: null,
            processId: null,
            sessionId: null,
          }),
        ]),
      ],
      tokenEstimator: { estimate: () => 10 },
    });

    const result = await service.buildContext({
      ...baseRequest,
      scope: { ownerId: 'owner-a' },
    });

    expect(result.selected.map((item) => item.id)).toEqual(['owner-private']);
    expect(result.excluded).toContainEqual(
      expect.objectContaining({
        id: 'project-private',
        reason: 'privacy_scope_mismatch',
      }),
    );
  });

  it('never lets relevance or diversity reorder a broader fallback ahead of a narrower scope', async () => {
    const service = new AgentContextRecallService({
      sources: [
        source('hybrid', [
          candidate('session-low-score', 'session context', {
            relevance: 0.1,
            importance: 0.1,
            provenanceConfidence: 0.1,
            topics: ['auth'],
          }),
          candidate('project-high-score', 'project context', {
            processId: 'other-process',
            sessionId: 'other-session',
            relevance: 1,
            importance: 1,
            provenanceConfidence: 1,
            type: 'procedural',
            topics: ['database'],
          }),
        ]),
      ],
      tokenEstimator: { estimate: () => 10 },
    });

    const result = await service.buildContext(baseRequest);

    expect(result.selected.map((item) => item.id)).toEqual([
      'session-low-score',
      'project-high-score',
    ]);
  });

  it('returns useful results with explicit degraded diagnostics when one provider fails', async () => {
    const service = new AgentContextRecallService({
      sources: [
        source('vector', new Error('provider unavailable')),
        source('text', [candidate('text-result', 'text fallback result')]),
      ],
      tokenEstimator: { estimate: () => 10 },
    });

    const result = await service.buildContext(baseRequest);

    expect(result.status).toBe('degraded');
    expect(result.selected.map((item) => item.id)).toEqual(['text-result']);
    expect(result.degradedReasons).toEqual([
      {
        source: 'vector',
        code: 'source_failed',
        message: 'provider unavailable',
      },
    ]);
  });

  it('propagates a fulfilled source fallback as a degraded result', async () => {
    const fallbackSource: AgentContextRecallSource = {
      name: 'hybrid',
      recall: async () => ({
        items: [candidate('fallback-result', 'fallback result')],
        degradedReason: {
          code: 'search_fallback',
          message: 'hybrid search used a fallback path',
        },
      }),
    };
    const service = new AgentContextRecallService({
      sources: [fallbackSource],
      tokenEstimator: { estimate: () => 10 },
    });

    const result = await service.buildContext(baseRequest);

    expect(result.status).toBe('degraded');
    expect(result.degradedReasons).toEqual([{
      source: 'hybrid',
      code: 'search_fallback',
      message: 'hybrid search used a fallback path',
    }]);
  });

  it('returns an explicit empty result when no source has candidates', async () => {
    const service = new AgentContextRecallService({
      sources: [source('hybrid', [])],
    });

    const result = await service.buildContext(baseRequest);

    expect(result.status).toBe('empty');
    expect(result.selected).toEqual([]);
    expect(result.tokenUsage).toEqual({
      budget: 200,
      used: 0,
      remaining: 200,
    });
  });

  it('deduplicates similar content and selects diverse topics and memory types', async () => {
    const service = new AgentContextRecallService({
      sources: [
        source('hybrid', [
          candidate('auth-semantic', 'Use OAuth PKCE for browser authentication', {
            type: 'semantic',
            topics: ['auth'],
            relevance: 1,
          }),
          candidate('auth-duplicate', 'Use OAuth PKCE for browser authentication.', {
            type: 'semantic',
            topics: ['auth'],
            relevance: 0.99,
          }),
          candidate('auth-episodic', 'OAuth callback failed until redirect URI matched', {
            type: 'episodic',
            topics: ['auth'],
            relevance: 0.95,
          }),
          candidate('database-procedural', 'Run schema validation before migration', {
            type: 'procedural',
            topics: ['database'],
            relevance: 0.9,
          }),
        ]),
      ],
      tokenEstimator: { estimate: () => 20 },
      estimationErrorRatio: 0.1,
      perItemOverheadTokens: 0,
    });

    const result = await service.buildContext({
      ...baseRequest,
      tokenBudget: 66,
      maxItems: 3,
    });

    expect(result.selected.map((item) => item.id)).toEqual([
      'auth-semantic',
      'database-procedural',
      'auth-episodic',
    ]);
    expect(result.excluded).toContainEqual(
      expect.objectContaining({
        id: 'auth-duplicate',
        reason: 'duplicate',
        duplicateOf: 'auth-semantic',
      }),
    );
  });

  it('uses stable id tie-breaks and returns identical decisions for identical input', async () => {
    const candidates = [
      candidate('memory-b', 'beta decision', { topics: ['beta'] }),
      candidate('memory-a', 'alpha decision', { topics: ['alpha'] }),
    ];
    const service = new AgentContextRecallService({
      sources: [source('hybrid', candidates)],
      tokenEstimator: { estimate: () => 10 },
    });

    const first = await service.buildContext(baseRequest);
    const second = await service.buildContext(baseRequest);

    expect(first).toEqual(second);
    expect(first.selected.map((item) => item.id)).toEqual(['memory-a', 'memory-b']);
  });

  it('fills an exact conservative budget boundary without exceeding it', async () => {
    const service = new AgentContextRecallService({
      sources: [
        source('hybrid', [
          candidate('fits', 'exact boundary'),
          candidate('overflow', 'must be excluded'),
        ]),
      ],
      tokenEstimator: { estimate: () => 10 },
      estimationErrorRatio: 0.2,
      perItemOverheadTokens: 3,
    });

    const result = await service.buildContext({
      ...baseRequest,
      tokenBudget: 15,
    });

    expect(result.selected.map((item) => item.id)).toEqual(['fits']);
    expect(result.selected[0]?.tokenEstimate).toBe(15);
    expect(result.tokenUsage).toEqual({ budget: 15, used: 15, remaining: 0 });
    expect(result.excluded).toContainEqual(
      expect.objectContaining({ id: 'overflow', reason: 'token_budget_exceeded' }),
    );
  });

  it('treats non-finite and negative limits as zero', async () => {
    const service = new AgentContextRecallService({
      sources: [source('hybrid', [candidate('excluded', 'must not be selected')])],
      tokenEstimator: { estimate: () => 1 },
      estimationErrorRatio: 0,
      perItemOverheadTokens: 0,
    });

    const result = await service.buildContext({
      ...baseRequest,
      tokenBudget: Number.NaN,
      maxItems: -1,
    });

    expect(result.selected).toEqual([]);
    expect(result.tokenUsage).toEqual({ budget: 0, used: 0, remaining: 0 });
    expect(result.excluded).toContainEqual(
      expect.objectContaining({ id: 'excluded', reason: 'max_items_reached' }),
    );
  });

  it('keeps token accounting finite when estimator configuration is invalid', async () => {
    const service = new AgentContextRecallService({
      sources: [source('hybrid', [candidate('safe', 'finite accounting')])],
      tokenEstimator: { estimate: () => Number.NaN },
      estimationErrorRatio: Number.NaN,
      perItemOverheadTokens: -10,
    });

    const result = await service.buildContext({
      ...baseRequest,
      tokenBudget: 1,
    });

    expect(result.selected[0]?.tokenEstimate).toBe(0);
    expect(result.tokenUsage).toEqual({ budget: 1, used: 0, remaining: 1 });
  });

  it('accounts conservatively for tokenizer estimation error', async () => {
    const actualTokenizer = { estimate: (text: string) => text.length };
    const underestimatingTokenizer = {
      estimate: (text: string) => Math.ceil(text.length / 2),
    };
    const service = new AgentContextRecallService({
      sources: [source('hybrid', [candidate('error-safe', '1234567890')])],
      tokenEstimator: underestimatingTokenizer,
      estimationErrorRatio: 1,
      perItemOverheadTokens: 0,
    });

    const result = await service.buildContext({
      ...baseRequest,
      tokenBudget: 10,
    });

    expect(result.selected[0]?.tokenEstimate).toBe(10);
    expect(actualTokenizer.estimate(result.selected[0]!.content)).toBeLessThanOrEqual(
      result.tokenUsage.budget,
    );
    expect(result.tokenUsage.used).toBeLessThanOrEqual(result.tokenUsage.budget);
  });
});
