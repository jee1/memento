import { describe, expect, it, vi } from 'vitest';
import type { AgentContextRecallResult } from './agent-context-recall-service.js';
import {
  AgentContextInjectionService,
  summarizeAgentInjectionTelemetry,
} from './agent-context-injection-service.js';

const recallResult: AgentContextRecallResult = {
  status: 'ok',
  query: 'current task',
  contextText: 'Use the established context packer.',
  selected: [{
    id: 'memory-1',
    content: 'Use the established context packer.',
    type: 'procedural',
    relevance: 0.9,
    importance: 0.8,
    createdAt: '2026-06-06T00:00:00.000Z',
    provenanceConfidence: 1,
    privacyScope: 'private',
    ownerId: 'owner-1',
    projectId: 'project-1',
    processId: 'issue-466',
    sessionId: 'previous-session',
    topics: ['agent-memory'],
    score: 0.91,
    scopeLevel: 'project',
    tokenEstimate: 18,
    selectionReason: 'selected_by_score',
  }],
  excluded: [{
    id: 'memory-2',
    reason: 'token_budget_exceeded',
    score: 0.8,
    tokenEstimate: 30,
  }],
  tokenUsage: { budget: 32, used: 18, remaining: 14 },
  degradedReasons: [],
};

describe('AgentContextInjectionService', () => {
  it('builds the same versioned bundle for session start and pre-compact triggers', async () => {
    const buildContext = vi.fn().mockResolvedValue(recallResult);
    const service = new AgentContextInjectionService({
      recallService: { buildContext },
      now: () => new Date('2026-06-07T00:00:00.000Z'),
      createId: () => 'injection-1',
    });

    const sessionStart = await service.build({
      trigger: 'session_start',
      query: 'current task',
      scope: {
        ownerId: 'owner-1',
        projectId: 'project-1',
        processId: 'issue-466',
        sessionId: 'session-1',
      },
      tokenBudget: 32,
    });
    const preCompact = await service.build({
      trigger: 'pre_compact',
      currentContextSummary: 'current task',
      scope: {
        ownerId: 'owner-1',
        projectId: 'project-1',
        processId: 'issue-466',
        sessionId: 'session-1',
      },
      tokenBudget: 32,
    });

    expect(sessionStart).toMatchObject({
      bundleVersion: 1,
      injectionId: 'injection-1',
      trigger: 'session_start',
      status: 'ok',
      contextText: recallResult.contextText,
      selected: [expect.objectContaining({ id: 'memory-1', score: 0.91 })],
      excluded: [expect.objectContaining({
        id: 'memory-2',
        reason: 'token_budget_exceeded',
      })],
    });
    expect(preCompact.trigger).toBe('pre_compact');
    expect(buildContext).toHaveBeenNthCalledWith(2, expect.objectContaining({
      query: 'current task',
      tokenBudget: 32,
    }));
  });

  it('returns an empty bundle without throwing when recall has no candidates', async () => {
    const service = new AgentContextInjectionService({
      recallService: {
        buildContext: async () => ({
          ...recallResult,
          status: 'empty',
          contextText: '',
          selected: [],
          excluded: [],
          tokenUsage: { budget: 64, used: 0, remaining: 64 },
        }),
      },
      createId: () => 'injection-empty',
    });

    await expect(service.build({
      trigger: 'session_start',
      query: '',
      scope: { ownerId: 'owner-1' },
      tokenBudget: 64,
    })).resolves.toMatchObject({
      status: 'empty',
      contextText: '',
      selected: [],
      failureReason: null,
    });
  });

  it('returns a degraded bundle on timeout without blocking agent operation', async () => {
    vi.useFakeTimers();
    try {
      const service = new AgentContextInjectionService({
        recallService: {
          buildContext: async () => new Promise<AgentContextRecallResult>(() => undefined),
        },
        timeoutMs: 25,
        createId: () => 'injection-timeout',
      });

      const pending = service.build({
        trigger: 'pre_compact',
        query: 'summary',
        scope: { ownerId: 'owner-1' },
        tokenBudget: 128,
      });
      await vi.advanceTimersByTimeAsync(25);

      await expect(pending).resolves.toMatchObject({
        status: 'degraded',
        contextText: '',
        selected: [],
        failureReason: 'timeout',
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('preserves partial recall results and stable degraded reasons', async () => {
    const service = new AgentContextInjectionService({
      recallService: {
        buildContext: async () => ({
          ...recallResult,
          status: 'degraded',
          degradedReasons: [{
            source: 'vector',
            code: 'source_failed',
            message: 'provider unavailable',
          }],
        }),
      },
      createId: () => 'injection-partial',
    });

    const bundle = await service.build({
      trigger: 'session_start',
      query: 'task',
      scope: { ownerId: 'owner-1' },
      tokenBudget: 32,
    });

    expect(bundle.status).toBe('degraded');
    expect(bundle.selected).toHaveLength(1);
    expect(bundle.degradedReasons).toEqual(recallResult.degradedReasons.concat({
      source: 'vector',
      code: 'source_failed',
      message: 'provider unavailable',
    }));
  });

  it('reports latency samples while keeping the p95 fixture below 1500ms', async () => {
    let time = 1_000;
    const samples: number[] = [];
    const service = new AgentContextInjectionService({
      recallService: { buildContext: async () => recallResult },
      nowMs: () => {
        const current = time;
        time += 20;
        return current;
      },
      recordTelemetry: event => samples.push(event.latencyMs),
    });

    for (let index = 0; index < 20; index += 1) {
      await service.build({
        trigger: 'session_start',
        query: `task-${index}`,
        scope: { ownerId: 'owner-1' },
        tokenBudget: 32,
      });
    }

    const sorted = [...samples].sort((a, b) => a - b);
    const p95 = sorted[Math.ceil(sorted.length * 0.95) - 1]!;
    expect(p95).toBeLessThan(1_500);
  });

  it('records candidate decisions, scores, tokens, and later tool usage by injection id', async () => {
    const events: unknown[] = [];
    const service = new AgentContextInjectionService({
      recallService: { buildContext: async () => recallResult },
      createId: () => 'injection-linked',
      recordTelemetry: event => events.push(event),
    });

    const bundle = await service.build({
      trigger: 'session_start',
      query: 'task',
      scope: { ownerId: 'owner-1', sessionId: 'session-1' },
      tokenBudget: 32,
    });
    service.recordUsage({
      injectionId: bundle.injectionId,
      sessionId: 'session-1',
      observationId: 'observation-tool-1',
      toolName: 'functions.exec_command',
      usedMemoryIds: ['memory-1'],
    });

    expect(events).toEqual([
      expect.objectContaining({
        kind: 'injection_built',
        candidateCount: 2,
        selected: [{
          memoryId: 'memory-1',
          score: 0.91,
          tokenEstimate: 18,
          reason: 'selected_by_score',
        }],
        exclusions: [{
          memoryId: 'memory-2',
          score: 0.8,
          tokenEstimate: 30,
          reason: 'token_budget_exceeded',
        }],
      }),
      {
        kind: 'injection_used',
        injectionId: 'injection-linked',
        sessionId: 'session-1',
        observationId: 'observation-tool-1',
        toolName: 'functions.exec_command',
        usedMemoryIds: ['memory-1'],
      },
    ]);
  });

  it('summarizes p50/p95 latency and token-budget metrics', () => {
    const summary = summarizeAgentInjectionTelemetry([
      {
        kind: 'injection_built',
        injectionId: 'a',
        trigger: 'session_start',
        status: 'ok',
        latencyMs: 100,
        candidateCount: 2,
        selectedCount: 1,
        excludedCount: 1,
        selected: [],
        exclusions: [],
        tokenBudget: 100,
        tokenUsed: 80,
        budgetExceeded: false,
        failureReason: null,
      },
      {
        kind: 'injection_built',
        injectionId: 'b',
        trigger: 'pre_compact',
        status: 'degraded',
        latencyMs: 1_400,
        candidateCount: 0,
        selectedCount: 0,
        excludedCount: 0,
        selected: [],
        exclusions: [],
        tokenBudget: 100,
        tokenUsed: 100,
        budgetExceeded: false,
        failureReason: 'timeout',
      },
    ]);

    expect(summary).toEqual({
      sampleCount: 2,
      latencyP50Ms: 100,
      latencyP95Ms: 1_400,
      averageBudgetUtilization: 0.9,
      budgetExceededCount: 0,
      degradedCount: 1,
    });
  });
});
