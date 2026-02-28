import { describe, expect, it } from 'vitest';
import { SessionCheckpointService } from '../session-checkpoint-service.js';

describe('SessionCheckpointService', () => {
  const service = new SessionCheckpointService();

  it('save checkpoint는 continuity tags와 origin_source를 포함해 memory payload를 만든다', async () => {
    const payload = service.buildCheckpointPayload({
      kind: 'decision',
      content: 'resume 엔진은 recall 기반으로 간다',
      project: 'memento',
      sessionId: 'sess-1',
      processId: 'cursor',
      branch: 'feature/resume',
    });

    expect(payload.tags).toContain('decision');
    expect(payload.tags).toContain('continuity');
    expect(payload.session_id).toBe('sess-1');
    expect(payload.origin_source).toContain('feature/resume');
  });
});
