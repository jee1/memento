import { describe, expect, it } from 'vitest';

import { diagnoseClaudeCode } from './diagnostics.js';

describe('Claude Code diagnostics', () => {
  it('accepts local Claude Code 2.1.153 capability fixture', () => {
    expect(diagnoseClaudeCode({
      versionOutput: '2.1.153 (Claude Code)',
      helpOutput: '--include-hook-events Include all hook lifecycle events',
      configuredEvents: [
        'SessionStart',
        'UserPromptSubmit',
        'PostToolUse',
        'PreCompact',
        'Stop',
      ],
    })).toEqual({
      compatible: true,
      version: '2.1.153',
      includeHookEvents: true,
      missingEvents: [],
      warnings: [],
    });
  });

  it('reports version and capability mismatch without throwing', () => {
    const result = diagnoseClaudeCode({
      versionOutput: '2.0.0 (Claude Code)',
      helpOutput: 'usage',
      configuredEvents: ['SessionStart'],
    });

    expect(result.compatible).toBe(false);
    expect(result.includeHookEvents).toBe(false);
    expect(result.missingEvents).toContain('Stop');
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});
