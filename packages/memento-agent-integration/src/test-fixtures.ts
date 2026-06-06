import type { AgentEventEnvelope, AgentEventType } from './types.js';

const payloads = {
  SESSION_START: { client_version: '1.0.0', initial_context: 'ready' },
  USER_PROMPT: { content: 'Implement the feature', content_format: 'text' },
  TOOL_RESULT: {
    tool_name: 'exec_command',
    outcome: 'success',
    output: { summary: 'tests passed' },
  },
  PRE_COMPACT: { context_summary: 'Implementation context', token_budget: 4096 },
  STOP: { outcome: 'completed', summary: 'Done' },
} as const;

export function eventFixture<TType extends AgentEventType>(
  eventType: TType,
  overrides: Record<string, unknown> = {},
): AgentEventEnvelope<TType> {
  return {
    contract_version: 1,
    event_id: `evt-${eventType.toLowerCase()}`,
    event_type: eventType,
    occurred_at: '2026-06-06T01:02:00.000Z',
    adapter_name: 'codex',
    adapter_version: '1.0.0',
    session_id: 'ses-01',
    sequence_no: 1,
    scope: { project_id: 'github.com/jee1/memento' },
    payload: payloads[eventType],
    ...overrides,
  } as AgentEventEnvelope<TType>;
}
