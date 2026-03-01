import { describe, expect, it } from 'vitest';
import { EndSessionTool } from '../end-session-tool.js';
import { SessionCheckpointService, type CheckpointPayload } from '../../services/session-checkpoint-service.js';

describe('EndSessionTool', () => {
  it('end_session should save summary and return session_id and memory_id', async () => {
    const checkpoint = new SessionCheckpointService();
    const tool = new EndSessionTool(checkpoint);
    const def = tool.getDefinition();
    const context = {
      remember: async () => ({ memory_id: 'mem-end-1' }),
    };
    const toolResult = await def.handler(
      { project: 'memento', session_id: 'sess-1', summary: 'Resume draft done' },
      context
    );
    const result = JSON.parse(toolResult.content[0].text) as { session_id: string; memory_id: string };
    expect(result.session_id).toBe('sess-1');
    expect(result.memory_id).toBeDefined();
  });

  it('end_session stores branch in origin_source when provided', async () => {
    const checkpoint = new SessionCheckpointService();
    const tool = new EndSessionTool(checkpoint);
    const def = tool.getDefinition();
    let capturedPayload: CheckpointPayload | undefined;

    const context = {
      remember: async (payload: CheckpointPayload) => {
        capturedPayload = payload;
        return { memory_id: 'mem-end-1' };
      },
    };

    await def.handler(
      {
        project: 'memento',
        session_id: 'sess-1',
        branch: 'feature/resume',
        summary: 'Resume draft done',
      },
      context
    );

    expect(capturedPayload?.origin_source).toContain('feature/resume');
  });
});
