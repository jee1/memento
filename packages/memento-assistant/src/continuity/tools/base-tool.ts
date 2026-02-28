import type { AssistantToolDefinition, AssistantToolContext, AssistantToolResult } from './types.js';
import type { z } from 'zod';

export abstract class BaseTool {
  constructor(
    protected name: string,
    protected description: string,
    protected inputSchema: z.ZodTypeAny | Record<string, unknown>
  ) {}

  getDefinition(): AssistantToolDefinition {
    return {
      name: this.name,
      description: this.description,
      inputSchema: this.inputSchema,
      handler: this.handle.bind(this),
    };
  }

  abstract handle(params: unknown, context: AssistantToolContext): Promise<AssistantToolResult>;

  protected createSuccessResult(data: unknown): AssistantToolResult {
    return {
      content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    };
  }
}
