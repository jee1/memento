import { z } from 'zod';
import { BaseTool } from './base-tool.js';
import type { AssistantToolContext, AssistantToolResult } from './types.js';
import { SessionCheckpointService } from '../services/session-checkpoint-service.js';

const StartSessionSchema = z.object({
  project: z.string().min(1),
  process_id: z.string().optional(),
  session_id: z.string().min(1),
  branch: z.string().optional(),
});

export type StartSessionParams = z.infer<typeof StartSessionSchema>;

export class StartSessionTool extends BaseTool {
  constructor(private readonly checkpoint: SessionCheckpointService) {
    super(
      'start_session',
      'Start a continuity session and create a working memory checkpoint.',
      StartSessionSchema
    );
  }

  async handle(params: unknown, context: AssistantToolContext): Promise<AssistantToolResult> {
    const parsed = StartSessionSchema.parse(params);
    if (!context.remember) throw new Error('context.remember is required');
    const payload = this.checkpoint.buildCheckpointPayload({
      kind: 'task',
      content: 'Session started',
      project: parsed.project,
      sessionId: parsed.session_id,
      processId: parsed.process_id,
      branch: parsed.branch,
    });
    const { memory_id } = await context.remember(payload);
    return this.createSuccessResult({ session_id: parsed.session_id, memory_id });
  }
}
