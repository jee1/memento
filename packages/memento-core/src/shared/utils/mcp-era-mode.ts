/**
 * HTTP MCP dual-era rollback gate (#840).
 * Env: MEMENTO_MCP_ERA — dual (default) | legacy | modern
 */

export type McpEraMode = 'dual' | 'legacy' | 'modern';

export function parseMcpEraMode(envValue: string | undefined): McpEraMode {
  if (!envValue) {
    return 'dual';
  }

  const normalized = envValue.toLowerCase().trim();
  if (normalized === 'dual' || normalized === 'legacy' || normalized === 'modern') {
    return normalized;
  }

  process.stderr.write(
    `[CONFIG WARN] Invalid MEMENTO_MCP_ERA value: ${envValue}. Using default 'dual'.\n`,
  );
  return 'dual';
}

export function isModernMcpServiceEnabled(mode: McpEraMode): boolean {
  return mode === 'dual' || mode === 'modern';
}

export function isLegacyMcpServiceEnabled(mode: McpEraMode): boolean {
  return mode === 'dual' || mode === 'legacy';
}
