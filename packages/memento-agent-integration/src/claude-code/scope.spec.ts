import { describe, expect, it } from 'vitest';

import { detectClaudeCodeScope } from './scope.js';

describe('Claude Code scope detection', () => {
  it('prefers explicit environment scope', () => {
    expect(detectClaudeCodeScope('/workspace/repo', {
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
    const git = (args: readonly string[]) => {
      if (args.join(' ') === 'config --get remote.origin.url') {
        return 'git@github.com:jee1/memento.git';
      }
      if (args.join(' ') === 'branch --show-current') {
        return 'feature/issue-457-claude-code-adapter';
      }
      return undefined;
    };

    expect(detectClaudeCodeScope('/workspace/repo', { env: {}, git })).toEqual({
      project_id: 'github.com/jee1/memento',
      process_id: 'issue-457',
    });
  });

  it('falls back to cwd when git is unavailable', () => {
    expect(detectClaudeCodeScope('/workspace/repo', {
      env: {},
      git: () => undefined,
    })).toEqual({ project_id: '/workspace/repo' });
  });
});
