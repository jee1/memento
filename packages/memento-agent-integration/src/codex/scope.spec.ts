import { describe, expect, it } from 'vitest';

import { detectCodexScope } from './scope.js';

describe('Codex scope detection', () => {
  it('prefers explicit scope', () => {
    expect(detectCodexScope('/repo', {
      env: {
        MEMENTO_OWNER_ID: 'owner',
        MEMENTO_PROJECT_ID: 'project',
        MEMENTO_PROCESS_ID: 'process',
      },
      git: () => 'ignored',
    })).toEqual({
      owner_id: 'owner',
      project_id: 'project',
      process_id: 'process',
    });
  });

  it('normalizes git remote and issue branch', () => {
    const git = (args: readonly string[]) =>
      args[0] === 'config'
        ? 'https://github.com/jee1/memento.git'
        : 'feature/issue-459-codex-adapter';
    expect(detectCodexScope('/repo', { env: {}, git })).toEqual({
      project_id: 'github.com/jee1/memento',
      process_id: 'issue-459',
    });
  });
});
