import {
  AgentIntegrationError,
  type AgentContextInjectionBundle,
  type AgentContextInjectionRequest,
  AgentLifecycleService,
  AgentMemoryPromotionService,
  AgentSessionSummaryService,
  createPersonalAgentLlmPort,
  createToolContext,
  GeminiChatLlmAdapter,
  mementoConfig,
  OllamaChatLlmAdapter,
  OpenAiChatLlmAdapter,
  parsePersonalAgentLlmEnv,
  PersonalAgentLlmError,
  PersonalKnowledgeAgentService,
  ToolContextKnowledgeContextAdapter,
  ToolContextRememberPersistenceAdapter,
  SqliteAgentIntegrationRepository,
  TelemetryRepository,
  type ILLMPort,
} from '@memento/core';
import type Database from 'better-sqlite3';
import { AgentTranscriptImporter } from './agent-transcript-import.js';
import { prepareEvent } from './agent.routes.events.js';
import type { AgentRouterCtx, AgentRouterOptions } from './agent.routes.types.js';

function createDefaultPersonalAgentLlm(): ILLMPort {
  const parsed = parsePersonalAgentLlmEnv(process.env, {
    openaiApiKey: mementoConfig.openaiApiKey,
    geminiApiKey: mementoConfig.geminiApiKey,
  });
  return createPersonalAgentLlmPort(parsed, {
    createOpenAi: (cfg) => new OpenAiChatLlmAdapter({
      apiKey: mementoConfig.openaiApiKey ?? '',
      model: cfg.model,
    }),
    createGemini: (cfg) => new GeminiChatLlmAdapter({
      apiKey: mementoConfig.geminiApiKey ?? '',
      model: cfg.model,
    }),
    createOllama: (cfg) => new OllamaChatLlmAdapter({
      baseUrl: cfg.baseUrl,
      model: cfg.model,
    }),
  });
}

export function createPersonalKnowledgeAgent(ctx: AgentRouterCtx): PersonalKnowledgeAgentService {
  if (!ctx.db || !ctx.options.serverServices) {
    throw new AgentIntegrationError('Personal knowledge agent runtime is not initialized', 'SERVER_UNAVAILABLE', 503, true);
  }
  try {
    const toolContext = createToolContext(ctx.db, ctx.options.serverServices);
    return new PersonalKnowledgeAgentService({
      llm: ctx.options.personalAgentLlm ?? createDefaultPersonalAgentLlm(),
      context: new ToolContextKnowledgeContextAdapter(toolContext),
      persistence: new ToolContextRememberPersistenceAdapter(toolContext),
    });
  } catch (error) {
    if (error instanceof PersonalAgentLlmError) {
      throw new AgentIntegrationError(error.message, 'INVALID_PAYLOAD', 400);
    }
    throw error;
  }
}

function buildInjectionExtraData(
  bundle: AgentContextInjectionBundle,
  sessionId: string,
): Record<string, unknown> {
  return {
    injection_id: bundle.injectionId,
    session_id: sessionId,
    trigger: bundle.trigger,
    candidate_count: bundle.selected.length + bundle.excluded.length,
    selected_count: bundle.selected.length,
    exclusion_count: bundle.excluded.length,
    selected: bundle.selected.map(item => ({
      memory_id: item.id,
      score: item.score,
      token_estimate: item.tokenEstimate,
      selection_reason: item.selectionReason,
      scope_level: item.scopeLevel,
    })),
    exclusions: bundle.excluded.map(item => ({
      memory_id: item.id,
      reason: item.reason,
      score: item.score,
      token_estimate: item.tokenEstimate,
      ...(item.duplicateOf ? { duplicate_of: item.duplicateOf } : {}),
    })),
    token_budget: bundle.tokenUsage.budget,
    token_used: bundle.tokenUsage.used,
    budget_exceeded: bundle.tokenUsage.used > bundle.tokenUsage.budget,
    degraded_reasons: bundle.degradedReasons,
  };
}

function promotionEventType(action: string): string {
  const map: Record<string, string> = {
    extracted: 'agent.promotion.extracted',
    approved: 'agent.promotion.approved',
    rejected: 'agent.promotion.rejected',
    usage: 'agent.promotion.usage',
  };
  return map[action] ?? 'agent.promotion.unknown';
}

function promotionOutcome(
  action: string,
  usageOutcome?: string,
): 'success' | 'failure' | 'empty' {
  if (action === 'rejected' || (action === 'usage' && usageOutcome === 'negative')) {
    return 'failure';
  }
  if (action === 'usage' && usageOutcome === 'unused') return 'empty';
  return 'success';
}

function promotionRequestId(event: {
  action: string;
  sessionId?: string;
  memoryId?: string;
  candidateId?: string;
}): string {
  if (event.action === 'extracted') return `agent-promotion:${event.sessionId}`;
  if (event.action === 'usage') return `agent-promotion-usage:${event.memoryId}`;
  return `agent-promotion-review:${event.candidateId}`;
}

function clampTokenBudget(value: number | undefined): number {
  return Number.isSafeInteger(value) ? Math.min(32_768, Math.max(1, value!)) : 2_048;
}

function buildSummarizer(
  summaryService: InstanceType<typeof AgentSessionSummaryService> | null,
  promotionService: InstanceType<typeof AgentMemoryPromotionService> | null,
): AgentRouterCtx['summarizer'] {
  if (!summaryService) return null;
  return {
    summarize(sessionId: string) {
      const result = summaryService.summarize(sessionId);
      if (result.status !== 'SKIPPED') {
        promotionService?.extractCandidates(sessionId);
      }
      return result;
    },
  };
}

function makeRecordInjection(
  telemetryRepository: InstanceType<typeof TelemetryRepository> | null,
) {
  return function recordInjection(
    bundle: AgentContextInjectionBundle,
    ownerId: string | null,
    sessionId: string,
  ) {
    try {
      telemetryRepository?.insertEventSync({
        eventType: 'agent.injection.completed',
        requestId: `agent-injection:${bundle.injectionId}`,
        ownerId,
        latencyMs: bundle.latencyMs,
        outcome: bundle.status === 'ok'
          ? 'success'
          : bundle.status === 'empty'
            ? 'empty'
            : 'failure',
        errorCode: bundle.failureReason ?? undefined,
        extraData: buildInjectionExtraData(bundle, sessionId),
      });
    } catch {
      return;
    }
  };
}

function makeBuildInjection(
  injectionService: Pick<{ build(request: AgentContextInjectionRequest): Promise<AgentContextInjectionBundle> }, 'build'> | undefined,
) {
  return async function buildInjection(
    request: AgentContextInjectionRequest,
  ): Promise<AgentContextInjectionBundle | null> {
    try {
      return await injectionService?.build(request) ?? null;
    } catch {
      return null;
    }
  };
}

function makePromotionTelemetryCallback(
  repository: InstanceType<typeof SqliteAgentIntegrationRepository>,
  telemetryRepository: InstanceType<typeof TelemetryRepository> | null,
) {
  return function recordPromotionTelemetry(event: { action: string; sessionId?: string; memoryId?: string; candidateId?: string; usageOutcome?: string }) {
    const sessionId = event.action === 'extracted' ? event.sessionId ?? null : null;
    const session = sessionId ? repository.getSession(sessionId) : null;
    telemetryRepository?.insertEventSync({
      eventType: promotionEventType(event.action) as Parameters<typeof telemetryRepository.insertEventSync>[0]['eventType'],
      requestId: promotionRequestId(event),
      ownerId: session?.ownerId ?? null,
      outcome: promotionOutcome(event.action, event.usageOutcome) as Parameters<typeof telemetryRepository.insertEventSync>[0]['outcome'],
      extraData: { ...event },
    });
  };
}

function makeSummaryTelemetryCallback(
  repository: InstanceType<typeof SqliteAgentIntegrationRepository>,
  telemetryRepository: InstanceType<typeof TelemetryRepository> | null,
) {
  return function recordSummaryTelemetry(event: { outcome: string; sessionId: string; latencyMs?: number; reason?: string; observationCount?: number }) {
    const eventType = event.outcome === 'success'
      ? 'agent.summary.completed'
      : event.outcome === 'empty'
        ? 'agent.summary.skipped'
        : 'agent.summary.failed';
    telemetryRepository?.insertEventSync({
      eventType,
      requestId: `agent-summary:${event.sessionId}`,
      ownerId: repository.getSession(event.sessionId)?.ownerId ?? null,
      latencyMs: event.latencyMs,
      outcome: event.outcome as Parameters<typeof telemetryRepository.insertEventSync>[0]['outcome'],
      errorCode: event.reason,
      extraData: {
        session_id: event.sessionId,
        observation_count: event.observationCount,
        ...(event.reason ? { reason: event.reason } : {}),
      },
    });
  };
}

export function buildRouterCtx(
  db: Database.Database | null,
  options: AgentRouterOptions,
): AgentRouterCtx {
  const repository = db ? new SqliteAgentIntegrationRepository(db) : null;
  const telemetryRepository = db ? new TelemetryRepository(db) : null;
  const promotionService = repository
    ? new AgentMemoryPromotionService(repository, {
        now: options.now,
        recordTelemetry: makePromotionTelemetryCallback(repository, telemetryRepository),
      })
    : null;
  const summaryService = repository
    ? new AgentSessionSummaryService(repository, {
        now: options.now,
        recordTelemetry: makeSummaryTelemetryCallback(repository, telemetryRepository),
      })
    : null;
  const summarizer = buildSummarizer(summaryService, promotionService);
  const service = repository
    ? new AgentLifecycleService(repository, options, summarizer ?? undefined)
    : null;
  const transcriptImporter = repository && service
    ? new AgentTranscriptImporter({
        prepareEvent,
        lifecycleService: service,
        repository,
      })
    : null;
  const injectionService = options.contextInjectionService;
  const initialInjectionTokenBudget = clampTokenBudget(options.initialInjectionTokenBudget);

  return {
    db,
    options,
    service,
    repository,
    telemetryRepository,
    promotionService,
    injectionService,
    initialInjectionTokenBudget,
    summarizer,
    transcriptImporter,
    recordInjection: makeRecordInjection(telemetryRepository),
    buildInjection: makeBuildInjection(injectionService),
  };
}
