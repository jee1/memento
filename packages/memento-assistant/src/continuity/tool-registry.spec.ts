import { describe, expect, it } from 'vitest';
import { AssistantToolRegistry } from './tool-registry.js';
import { SessionCheckpointService } from './services/session-checkpoint-service.js';
import { ResumeSnapshotService } from './services/resume-snapshot-service.js';
import { StartSessionTool } from './tools/start-session-tool.js';
import { SaveContextTool } from './tools/save-context-tool.js';
import { EndSessionTool } from './tools/end-session-tool.js';
import { ResumeSessionTool } from './tools/resume-session-tool.js';

describe('AssistantToolRegistry', () => {
  it('registers and lists the four continuity tools', () => {
    const registry = new AssistantToolRegistry();
    const checkpoint = new SessionCheckpointService();
    const resumeService = new ResumeSnapshotService({ queryContinuityMemories: async () => [] });
    registry.registerAll([
      new StartSessionTool(checkpoint).getDefinition(),
      new SaveContextTool(checkpoint).getDefinition(),
      new EndSessionTool(checkpoint).getDefinition(),
      new ResumeSessionTool(resumeService).getDefinition(),
    ]);
    const all = registry.getAll();
    const names = all.map((t) => t.name).sort();
    expect(names).toEqual(['end_session', 'resume_session', 'save_context', 'start_session']);
  });
});
