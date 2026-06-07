import { randomUUID } from 'crypto';
import type {
  AgentContextRecallRequest,
  AgentContextRecallResult,
  AgentContextRecallService,
  AgentContextScope,
  ExcludedAgentContextItem,
  SelectedAgentContextItem,
} from './agent-context-recall-service.js';

export type AgentContextInjectionTrigger = 'session_start' | 'pre_compact';
export type AgentContextInjectionFailureReason = 'timeout' | 'internal_error';

export interface AgentContextInjectionRequest {
  trigger: AgentContextInjectionTrigger;
  query?: string;
  currentContextSummary?: string;
  scope: AgentContextScope;
  tokenBudget: number;
  maxItems?: number;
}

export interface AgentContextInjectionBundle {
  bundleVersion: 1;
  injectionId: string;
  trigger: AgentContextInjectionTrigger;
  status: 'ok' | 'empty' | 'degraded';
  generatedAt: string;
  query: string;
  contextText: string;
  selected: SelectedAgentContextItem[];
  excluded: ExcludedAgentContextItem[];
  tokenUsage: AgentContextRecallResult['tokenUsage'];
  degradedReasons: AgentContextRecallResult['degradedReasons'];
  failureReason: AgentContextInjectionFailureReason | null;
  latencyMs: number;
}

export interface AgentInjectionBuiltTelemetryEvent {
  kind: 'injection_built';
  injectionId: string;
  trigger: AgentContextInjectionTrigger;
  status: AgentContextInjectionBundle['status'];
  latencyMs: number;
  candidateCount: number;
  selectedCount: number;
  excludedCount: number;
  selected: Array<{
    memoryId: string;
    score: number;
    tokenEstimate: number;
    reason: SelectedAgentContextItem['selectionReason'];
  }>;
  exclusions: Array<{
    memoryId: string;
    score: number;
    tokenEstimate: number;
    reason: ExcludedAgentContextItem['reason'];
  }>;
  tokenBudget: number;
  tokenUsed: number;
  budgetExceeded: boolean;
  failureReason: AgentContextInjectionFailureReason | null;
}

export interface AgentInjectionUsageTelemetryEvent {
  kind: 'injection_used';
  injectionId: string;
  sessionId: string;
  observationId?: string;
  toolName?: string;
  usedMemoryIds: string[];
}

export type AgentInjectionTelemetryEvent =
  | AgentInjectionBuiltTelemetryEvent
  | AgentInjectionUsageTelemetryEvent;

export interface AgentInjectionTelemetrySummary {
  sampleCount: number;
  latencyP50Ms: number | null;
  latencyP95Ms: number | null;
  averageBudgetUtilization: number;
  budgetExceededCount: number;
  degradedCount: number;
}

export interface AgentContextInjectionServiceOptions {
  recallService: Pick<AgentContextRecallService, 'buildContext'>;
  timeoutMs?: number;
  now?: () => Date;
  nowMs?: () => number;
  createId?: () => string;
  recordTelemetry?: (event: AgentInjectionTelemetryEvent) => void;
}

class InjectionTimeoutError extends Error {}

export class AgentContextInjectionService {
  private readonly timeoutMs: number;
  private readonly now: () => Date;
  private readonly nowMs: () => number;
  private readonly createId: () => string;

  constructor(private readonly options: AgentContextInjectionServiceOptions) {
    this.timeoutMs = boundedTimeout(options.timeoutMs);
    this.now = options.now ?? (() => new Date());
    this.nowMs = options.nowMs ?? (() => performance.now());
    this.createId = options.createId ?? randomUUID;
  }

  async build(request: AgentContextInjectionRequest): Promise<AgentContextInjectionBundle> {
    const startedAt = this.nowMs();
    const injectionId = this.createId();
    const query = request.query ?? request.currentContextSummary ?? '';
    let bundle: AgentContextInjectionBundle;
    try {
      const result = await withTimeout(
        this.options.recallService.buildContext(toRecallRequest(request, query)),
        this.timeoutMs,
      );
      bundle = {
        bundleVersion: 1,
        injectionId,
        trigger: request.trigger,
        status: result.status,
        generatedAt: this.now().toISOString(),
        query,
        contextText: result.contextText,
        selected: result.selected,
        excluded: result.excluded,
        tokenUsage: result.tokenUsage,
        degradedReasons: result.degradedReasons,
        failureReason: null,
        latencyMs: elapsedMs(startedAt, this.nowMs()),
      };
    } catch (error) {
      bundle = {
        bundleVersion: 1,
        injectionId,
        trigger: request.trigger,
        status: 'degraded',
        generatedAt: this.now().toISOString(),
        query,
        contextText: '',
        selected: [],
        excluded: [],
        tokenUsage: {
          budget: nonNegativeInteger(request.tokenBudget),
          used: 0,
          remaining: nonNegativeInteger(request.tokenBudget),
        },
        degradedReasons: [],
        failureReason: error instanceof InjectionTimeoutError ? 'timeout' : 'internal_error',
        latencyMs: elapsedMs(startedAt, this.nowMs()),
      };
    }

    this.recordTelemetry(bundle);
    return bundle;
  }

  recordUsage(event: Omit<AgentInjectionUsageTelemetryEvent, 'kind'>): void {
    try {
      this.options.recordTelemetry?.({
        kind: 'injection_used',
        ...event,
        usedMemoryIds: [...event.usedMemoryIds],
      });
    } catch {
      return;
    }
  }

  private recordTelemetry(bundle: AgentContextInjectionBundle): void {
    try {
      this.options.recordTelemetry?.({
        kind: 'injection_built',
        injectionId: bundle.injectionId,
        trigger: bundle.trigger,
        status: bundle.status,
        latencyMs: bundle.latencyMs,
        candidateCount: bundle.selected.length + bundle.excluded.length,
        selectedCount: bundle.selected.length,
        excludedCount: bundle.excluded.length,
        selected: bundle.selected.map(item => ({
          memoryId: item.id,
          score: item.score,
          tokenEstimate: item.tokenEstimate,
          reason: item.selectionReason,
        })),
        exclusions: bundle.excluded.map(item => ({
          memoryId: item.id,
          score: item.score,
          tokenEstimate: item.tokenEstimate,
          reason: item.reason,
        })),
        tokenBudget: bundle.tokenUsage.budget,
        tokenUsed: bundle.tokenUsage.used,
        budgetExceeded: bundle.tokenUsage.used > bundle.tokenUsage.budget,
        failureReason: bundle.failureReason,
      });
    } catch {
      return;
    }
  }
}

export function summarizeAgentInjectionTelemetry(
  events: readonly AgentInjectionTelemetryEvent[],
): AgentInjectionTelemetrySummary {
  const built = events.filter(
    (event): event is AgentInjectionBuiltTelemetryEvent => event.kind === 'injection_built',
  );
  const latencies = built.map(event => event.latencyMs).sort((a, b) => a - b);
  const utilization = built.map(event =>
    event.tokenBudget === 0 ? 0 : Math.min(1, event.tokenUsed / event.tokenBudget)
  );
  return {
    sampleCount: built.length,
    latencyP50Ms: percentile(latencies, 0.5),
    latencyP95Ms: percentile(latencies, 0.95),
    averageBudgetUtilization: utilization.length === 0
      ? 0
      : utilization.reduce((sum, value) => sum + value, 0) / utilization.length,
    budgetExceededCount: built.filter(event => event.budgetExceeded).length,
    degradedCount: built.filter(event => event.status === 'degraded').length,
  };
}

function toRecallRequest(
  request: AgentContextInjectionRequest,
  query: string,
): AgentContextRecallRequest {
  return {
    query,
    scope: request.scope,
    tokenBudget: request.tokenBudget,
    maxItems: request.maxItems,
  };
}

function percentile(sorted: readonly number[], ratio: number): number | null {
  if (sorted.length === 0) return null;
  return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)]!;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new InjectionTimeoutError()), timeoutMs);
    timer.unref?.();
    promise.then(
      value => {
        clearTimeout(timer);
        resolve(value);
      },
      error => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function boundedTimeout(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return 1_250;
  }
  return Math.min(10_000, Math.max(1, Math.floor(value!)));
}

function nonNegativeInteger(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function elapsedMs(startedAt: number, endedAt: number): number {
  return Math.max(0, Math.round(endedAt - startedAt));
}
