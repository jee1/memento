import { z } from 'zod';
import { BaseTool } from './base-tool.js';
import type { AssistantToolContext, AssistantToolResult } from './types.js';
import type { ResumeSnapshotService } from '../services/resume-snapshot-service.js';

const ResumeSessionSchema = z.object({
  project: z.string().min(1),
  process_id: z.string().optional(),
  session_id: z.string().optional(),
  branch: z.string().optional(),
});

export type ResumeSessionParams = z.infer<typeof ResumeSessionSchema>;

export class ResumeSessionTool extends BaseTool {
  constructor(private readonly resumeSnapshotService: ResumeSnapshotService) {
    super(
      'resume_session',
      'Return resume snapshot (Resume, Recent Decisions, Open Threads, Next Actions).',
      ResumeSessionSchema
    );
  }

  async handle(params: unknown, _context: AssistantToolContext): Promise<AssistantToolResult> {
    const parsed = ResumeSessionSchema.parse(params);
    const snapshot = await this.resumeSnapshotService.build({
      project: parsed.project,
      processId: parsed.process_id,
      sessionId: parsed.session_id,
      branch: parsed.branch,
    });
    return this.createSuccessResult({ snapshot });
  }
}
