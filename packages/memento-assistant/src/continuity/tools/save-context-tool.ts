import { z } from 'zod';
import { BaseTool } from './base-tool.js';
import type { AssistantToolContext, AssistantToolResult } from './types.js';
import { SessionCheckpointService } from '../services/session-checkpoint-service.js';

const SaveContextSchema = z.object({
  kind: z.enum(['task', 'decision', 'blocker', 'next-step']),
  content: z.string().min(1),
  project: z.string().min(1),
  session_id: z.string().min(1),
  process_id: z.string().optional(),
  branch: z.string().optional(),
});

export type SaveContextParams = z.infer<typeof SaveContextSchema>;

export class SaveContextTool extends BaseTool {
  constructor(private readonly checkpoint: SessionCheckpointService) {
    super(
      'save_context',
      'Save a continuity checkpoint (task, decision, blocker, or next-step).',
      SaveContextSchema
    );
  }

  async handle(params: unknown, context: AssistantToolContext): Promise<AssistantToolResult> {
    const parsed = SaveContextSchema.parse(params);
    if (!context.remember) throw new Error('context.remember is required');
    const payload = this.checkpoint.buildCheckpointPayload({
      kind: parsed.kind,
      content: parsed.content,
      project: parsed.project,
      sessionId: parsed.session_id,
      processId: parsed.process_id,
      branch: parsed.branch,
    });
    const { memory_id } = await context.remember(payload);
    return this.createSuccessResult({ memory_id });
  }
}
