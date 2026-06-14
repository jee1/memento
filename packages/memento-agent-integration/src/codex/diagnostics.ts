import { CODEX_HOOK_EVENTS, type CodexHookEvent } from './types.js';

export interface CodexDiagnosticInput {
  versionOutput: string;
  featuresOutput: string;
  configuredEvents: readonly string[];
}

export interface CodexDiagnosticResult {
  compatible: boolean;
  trustApproval: 'unverified';
  version?: string;
  hooksFeature?: {
    stage: string;
    enabled: boolean;
  };
  missingEvents: CodexHookEvent[];
  warnings: string[];
}

export function diagnoseCodex(
  input: CodexDiagnosticInput,
): CodexDiagnosticResult {
  const version = input.versionOutput.match(/(\d+\.\d+\.\d+)/)?.[1];
  const hooksMatch = input.featuresOutput.match(
    /^hooks\s+(\S+)\s+(true|false)\s*$/m,
  );
  const hooksFeature = hooksMatch
    ? { stage: hooksMatch[1], enabled: hooksMatch[2] === 'true' }
    : undefined;
  const configured = new Set(input.configuredEvents);
  const missingEvents = CODEX_HOOK_EVENTS.filter(event => !configured.has(event));
  const warnings: string[] = [];
  if (!version) warnings.push('Unable to parse Codex CLI version.');
  if (version && version !== '0.139.0') {
    warnings.push(`Codex CLI ${version} differs from tested version 0.139.0.`);
  }
  if (!hooksFeature) warnings.push('Codex hooks capability was not reported.');
  else if (!hooksFeature.enabled) warnings.push('Codex hooks capability is disabled.');
  else if (hooksFeature.stage !== 'stable') {
    warnings.push(`Codex hooks capability stage is ${hooksFeature.stage}, not stable.`);
  }
  if (missingEvents.length > 0) {
    warnings.push(`Missing lifecycle hooks: ${missingEvents.join(', ')}.`);
  }
  warnings.push(
    'PostToolUse coverage depends on Codex hook discovery and tool handlers; verify after upgrades.',
  );
  warnings.push(
    'Codex requires hook trust approval after installation; open /hooks and trust the Memento handlers.',
  );
  return {
    trustApproval: 'unverified',
    compatible: Boolean(version)
      && hooksFeature?.enabled === true
      && hooksFeature.stage === 'stable'
      && missingEvents.length === 0,
    ...(version ? { version } : {}),
    ...(hooksFeature ? { hooksFeature } : {}),
    missingEvents,
    warnings,
  };
}
