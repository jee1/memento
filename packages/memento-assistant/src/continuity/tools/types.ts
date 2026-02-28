/**
 * Assistant continuity tools - minimal types (no dependency on root src/tools).
 */
import type { z } from 'zod';
import type { CheckpointPayload } from '../services/session-checkpoint-service.js';

export interface AssistantToolResult {
  content: Array<{ type: 'text'; text: string }>;
  [key: string]: unknown;
}

export interface AssistantToolContext {
  /** Called to persist checkpoint via core remember API. Injected by assistant runtime. */
  remember?(payload: CheckpointPayload): Promise<{ memory_id: string }>;
}

export type AssistantToolHandler = (
  params: unknown,
  context: AssistantToolContext
) => Promise<AssistantToolResult>;

export interface AssistantToolDefinition {
  name: string;
  description: string;
  inputSchema: z.ZodTypeAny | Record<string, unknown>;
  handler: AssistantToolHandler;
}
