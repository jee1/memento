import { describe, expect, it } from 'vitest';
import { ResumeSessionTool } from '../resume-session-tool.js';
import { ResumeSnapshotService } from '../../services/resume-snapshot-service.js';

describe('ResumeSessionTool', () => {
  it('resume_session should return Resume/Recent Decisions/Open Threads/Next Actions sections', async () => {
    const resumeService = new ResumeSnapshotService({
      queryContinuityMemories: async () => [
        { id: 'm1', content: 'Task one', tags: ['continuity', 'task'] },
        { id: 'm2', content: 'Decision: use recall', tags: ['continuity', 'decision'] },
      ],
    });
    const tool = new ResumeSessionTool(resumeService);
    const def = tool.getDefinition();
    const toolResult = await def.handler(
      { project: 'memento', process_id: 'cursor', session_id: 'sess-1' },
      {}
    );
    const result = JSON.parse(toolResult.content[0].text) as { snapshot: { resume: unknown[]; recentDecisions: unknown[]; openThreads: unknown[]; nextActions: unknown[] } };
    expect(result.snapshot).toHaveProperty('resume');
    expect(result.snapshot).toHaveProperty('recentDecisions');
    expect(result.snapshot).toHaveProperty('openThreads');
    expect(result.snapshot).toHaveProperty('nextActions');
  });
});
