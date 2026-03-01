import { z } from 'zod';
import { BaseTool } from './base-tool.js';
import type { AssistantToolContext, AssistantToolResult } from './types.js';
import { SessionCheckpointService } from '../services/session-checkpoint-service.js';

const EndSessionSchema = z.object({
  project: z.string().min(1),
  session_id: z.string().min(1),
  process_id: z.string().optional(),
  branch: z.string().optional(),
  summary: z.string().optional(),
});

export type EndSessionParams = z.infer<typeof EndSessionSchema>;

export class EndSessionTool extends BaseTool {
  constructor(private readonly checkpoint: SessionCheckpointService) {
    super('end_session', 'End a continuity session and save an optional summary.', EndSessionSchema);
  }

  async handle(params: unknown, context: AssistantToolContext): Promise<AssistantToolResult> {
    const parsed = EndSessionSchema.parse(params);
    if (!context.remember) throw new Error('context.remember is required');
    const payload = this.checkpoint.buildCheckpointPayload({
      kind: 'next-step',
      content: parsed.summary ?? 'Session ended',
      project: parsed.project,
      sessionId: parsed.session_id,
      processId: parsed.process_id,
      branch: parsed.branch,
    });
    const { memory_id } = await context.remember(payload);
    return this.createSuccessResult({ session_id: parsed.session_id, memory_id });
  }
}
