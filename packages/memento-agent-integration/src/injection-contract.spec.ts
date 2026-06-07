import { describe, expect, it } from 'vitest';
import {
  INJECTION_BUNDLE_VERSION,
  claudeCodeInjectionFixture,
  codexInjectionFixture,
  injectionBundleFixture,
  validateInjectionBundle,
} from './injection-contract.js';

describe('injection bundle contract', () => {
  it('provides a reusable adapter-independent v1 fixture', () => {
    const bundle = injectionBundleFixture();

    expect(bundle.bundle_version).toBe(INJECTION_BUNDLE_VERSION);
    expect(bundle.trigger).toBe('session_start');
    expect(bundle.status).toBe('ok');
    expect(bundle.items[0]).toMatchObject({
      memory_id: 'memory-decision-1',
      selection_reason: 'selected_by_score',
      scope_level: 'project',
    });
    expect(validateInjectionBundle(bundle)).toEqual({ valid: true });
  });

  it('rejects incompatible versions and token budget overflow', () => {
    expect(validateInjectionBundle({
      ...injectionBundleFixture(),
      bundle_version: 2,
    })).toEqual({
      valid: false,
      reason: 'UNSUPPORTED_BUNDLE_VERSION',
    });

    expect(validateInjectionBundle({
      ...injectionBundleFixture(),
      token_usage: { budget: 10, used: 11, remaining: 0 },
    })).toEqual({
      valid: false,
      reason: 'INVALID_TOKEN_USAGE',
    });
  });

  it('provides reusable Codex and Claude lifecycle integration fixtures', () => {
    const codex = codexInjectionFixture();
    const claude = claudeCodeInjectionFixture();

    expect(codex.adapter).toBe('codex');
    expect(codex.session_start.event_type).toBe('SESSION_START');
    expect(codex.pre_compact.payload.context_summary).toContain('scope-aware');
    expect(validateInjectionBundle(codex.expected_bundle)).toEqual({ valid: true });

    expect(claude.adapter).toBe('claude-code');
    expect(claude.session_start.adapter_name).toBe('claude-code');
    expect(claude.expected_bundle.bundle_version).toBe(INJECTION_BUNDLE_VERSION);
    expect(validateInjectionBundle(claude.expected_bundle)).toEqual({ valid: true });
  });
});
