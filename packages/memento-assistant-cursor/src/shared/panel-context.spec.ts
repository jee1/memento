import { describe, expect, it } from 'vitest';

import { buildPanelContext } from './panel-context.js';

describe('buildPanelContext', () => {
  it('builds a minimal panel context from workspace and branch inputs', () => {
    expect(
      buildPanelContext({
        workspaceName: 'memento',
        branch: 'feature/host-adapter',
        sessionId: 'sess-1',
      })
    ).toEqual({
      project: 'memento',
      branch: 'feature/host-adapter',
      session_id: 'sess-1',
      process_id: 'cursor',
    });
  });

  it('allows process_id override for non-cursor hosts', () => {
    expect(
      buildPanelContext({
        workspaceName: 'memento',
        processId: 'web',
      })
    ).toEqual({
      project: 'memento',
      process_id: 'web',
    });
  });
});
