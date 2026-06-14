import { describe, expect, it } from 'vitest';

import { diagnoseCodex } from './diagnostics.js';

const CODEX_EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PostToolUse',
  'PreCompact',
  'Stop',
] as const;

describe('Codex diagnostics', () => {
  it('reports local 0.139.0 capabilities and activation requirements', () => {
    const result = diagnoseCodex({
      versionOutput: 'codex-cli 0.139.0',
      featuresOutput: 'hooks stable true',
      configuredEvents: CODEX_EVENTS,
    });

    expect(result.version).toBe('0.139.0');
    expect(result.hooksFeature).toEqual({ stage: 'stable', enabled: true });
    expect(result.missingEvents).toEqual([]);
    expect(result.compatible).toBe(true);
    expect(result.trustApproval).toBe('unverified');
    expect(result.warnings.join(' ')).toContain('PostToolUse');
    expect(result.warnings.join(' ')).toContain('/hooks');
  });

  it('does not throw for old or malformed versions', () => {
    expect(diagnoseCodex({
      versionOutput: 'unknown',
      featuresOutput: 'hooks stable false',
      configuredEvents: ['SessionStart'],
    }).compatible).toBe(false);
  });

  it('rejects missing or disabled hooks capability', () => {
    const disabled = diagnoseCodex({
      versionOutput: 'codex-cli 0.139.0',
      featuresOutput: 'hooks stable false',
      configuredEvents: CODEX_EVENTS,
    });
    const missing = diagnoseCodex({
      versionOutput: 'codex-cli 0.139.0',
      featuresOutput: 'apps stable true',
      configuredEvents: CODEX_EVENTS,
    });

    expect(disabled.compatible).toBe(false);
    expect(disabled.warnings.join(' ')).toContain('disabled');
    expect(missing.compatible).toBe(false);
    expect(missing.warnings.join(' ')).toContain('not reported');
  });
});
