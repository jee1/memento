import { describe, expect, it } from 'vitest';
import { StartSessionTool } from '../start-session-tool.js';
import { SessionCheckpointService } from '../../services/session-checkpoint-service.js';

describe('StartSessionTool', () => {
  it('start_session should create a working memory checkpoint and return session metadata', async () => {
    const checkpoint = new SessionCheckpointService();
    const tool = new StartSessionTool(checkpoint);
    const def = tool.getDefinition();
    const context = {
      remember: async () => ({ memory_id: 'mem-start-1' }),
    };
    const toolResult = await def.handler(
      {
        project: 'memento',
        process_id: 'cursor',
        session_id: 'sess-1',
        branch: 'feature/resume',
      },
      context
    );
    const result = JSON.parse(toolResult.content[0].text) as { session_id: string; memory_id: string };
    expect(result.session_id).toBe('sess-1');
    expect(result.memory_id).toBeDefined();
  });
});
