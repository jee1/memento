import { describe, expect, it } from 'vitest';
import { SaveContextTool } from '../save-context-tool.js';
import { SessionCheckpointService } from '../../services/session-checkpoint-service.js';

describe('SaveContextTool', () => {
  it('save_context should persist checkpoint and return memory_id', async () => {
    const checkpoint = new SessionCheckpointService();
    const tool = new SaveContextTool(checkpoint);
    const def = tool.getDefinition();
    const context = {
      remember: async () => ({ memory_id: 'mem-save-1' }),
    };
    const toolResult = await def.handler(
      {
        kind: 'decision',
        content: 'Use recall for resume',
        project: 'memento',
        session_id: 'sess-1',
      },
      context
    );
    const result = JSON.parse(toolResult.content[0].text) as { memory_id: string };
    expect(result.memory_id).toBe('mem-save-1');
  });
});
