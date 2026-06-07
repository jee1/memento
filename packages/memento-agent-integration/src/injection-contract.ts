import type { AgentEventEnvelope } from './types.js';

export const INJECTION_BUNDLE_VERSION = 1 as const;

export type InjectionTrigger = 'session_start' | 'pre_compact';
export type InjectionStatus = 'ok' | 'empty' | 'degraded';

export interface InjectionBundleItem {
  memory_id: string;
  content: string;
  memory_type: 'working' | 'episodic' | 'semantic' | 'procedural';
  score: number;
  scope_level: 'session' | 'process' | 'project' | 'owner';
  token_estimate: number;
  selection_reason: 'selected_by_score' | 'selected_for_diversity';
}

export interface InjectionBundleExclusion {
  memory_id: string;
  reason:
    | 'privacy_scope_mismatch'
    | 'scope_mismatch'
    | 'duplicate'
    | 'diversity_deferred'
    | 'token_budget_exceeded'
    | 'max_items_reached';
  score: number;
  token_estimate: number;
  duplicate_of?: string;
}

export interface InjectionBundle {
  bundle_version: typeof INJECTION_BUNDLE_VERSION;
  injection_id: string;
  trigger: InjectionTrigger;
  status: InjectionStatus;
  generated_at: string;
  query: string;
  context_text: string;
  items: InjectionBundleItem[];
  exclusions: InjectionBundleExclusion[];
  token_usage: {
    budget: number;
    used: number;
    remaining: number;
  };
  degraded_reasons: Array<{
    source: string;
    code: 'source_failed' | 'search_fallback';
    message: string;
  }>;
  failure_reason?: 'timeout' | 'internal_error';
}

export interface AgentInjectionIntegrationFixture {
  adapter: 'codex' | 'claude-code';
  session_start: AgentEventEnvelope<'SESSION_START'>;
  pre_compact: AgentEventEnvelope<'PRE_COMPACT'>;
  expected_bundle: InjectionBundle;
}

export type InjectionBundleValidation =
  | { valid: true }
  | {
      valid: false;
      reason:
        | 'INVALID_BUNDLE'
        | 'UNSUPPORTED_BUNDLE_VERSION'
        | 'INVALID_TOKEN_USAGE';
    };

export function validateInjectionBundle(input: unknown): InjectionBundleValidation {
  if (!isRecord(input)) {
    return { valid: false, reason: 'INVALID_BUNDLE' };
  }
  if (input.bundle_version !== INJECTION_BUNDLE_VERSION) {
    return { valid: false, reason: 'UNSUPPORTED_BUNDLE_VERSION' };
  }
  if (
    typeof input.injection_id !== 'string'
    || !['session_start', 'pre_compact'].includes(String(input.trigger))
    || !['ok', 'empty', 'degraded'].includes(String(input.status))
    || typeof input.generated_at !== 'string'
    || typeof input.query !== 'string'
    || typeof input.context_text !== 'string'
    || !Array.isArray(input.items)
    || !Array.isArray(input.exclusions)
    || !Array.isArray(input.degraded_reasons)
    || !isRecord(input.token_usage)
  ) {
    return { valid: false, reason: 'INVALID_BUNDLE' };
  }
  const { budget, used, remaining } = input.token_usage;
  if (
    !isNonNegativeInteger(budget)
    || !isNonNegativeInteger(used)
    || !isNonNegativeInteger(remaining)
    || used > budget
    || remaining !== budget - used
  ) {
    return { valid: false, reason: 'INVALID_TOKEN_USAGE' };
  }
  return { valid: true };
}

export function injectionBundleFixture(
  overrides: Partial<InjectionBundle> = {},
): InjectionBundle {
  return {
    bundle_version: INJECTION_BUNDLE_VERSION,
    injection_id: 'injection-fixture-1',
    trigger: 'session_start',
    status: 'ok',
    generated_at: '2026-06-07T00:00:00.000Z',
    query: 'Continue the agent-memory integration work',
    context_text: 'Use the existing scope-aware context packer.',
    items: [{
      memory_id: 'memory-decision-1',
      content: 'Use the existing scope-aware context packer.',
      memory_type: 'procedural',
      score: 0.92,
      scope_level: 'project',
      token_estimate: 18,
      selection_reason: 'selected_by_score',
    }],
    exclusions: [{
      memory_id: 'memory-duplicate-1',
      reason: 'duplicate',
      score: 0.81,
      token_estimate: 16,
      duplicate_of: 'memory-decision-1',
    }],
    token_usage: { budget: 128, used: 18, remaining: 110 },
    degraded_reasons: [],
    ...overrides,
  };
}

export function codexInjectionFixture(): AgentInjectionIntegrationFixture {
  return agentInjectionIntegrationFixture('codex');
}

export function claudeCodeInjectionFixture(): AgentInjectionIntegrationFixture {
  return agentInjectionIntegrationFixture('claude-code');
}

function agentInjectionIntegrationFixture(
  adapter: AgentInjectionIntegrationFixture['adapter'],
): AgentInjectionIntegrationFixture {
  const common = {
    contract_version: 1 as const,
    occurred_at: '2026-06-07T00:00:00.000Z',
    adapter_name: adapter,
    adapter_version: '1.0.0',
    session_id: `${adapter}-session-1`,
    scope: {
      owner_id: 'owner-1',
      project_id: 'github.com/jee1/memento',
      process_id: 'issue-466',
    },
  };
  return {
    adapter,
    session_start: {
      ...common,
      event_id: `${adapter}-session-start-1`,
      event_type: 'SESSION_START',
      sequence_no: 0,
      payload: {
        client_version: '1.0.0',
        initial_context: 'Continue the scope-aware context injection work',
      },
    },
    pre_compact: {
      ...common,
      event_id: `${adapter}-pre-compact-1`,
      event_type: 'PRE_COMPACT',
      sequence_no: 1,
      payload: {
        context_summary: 'Preserve the scope-aware current implementation context',
        token_budget: 128,
      },
    },
    expected_bundle: injectionBundleFixture({
      injection_id: `${adapter}-injection-1`,
    }),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}
