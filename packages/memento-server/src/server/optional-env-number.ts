/**
 * Reads a numeric env var. Empty, whitespace-only or non-numeric values return undefined.
 * compose injects unset keys as `${KEY:-}` (empty string), and `Number('')` is 0 (#1136).
 */
export function optionalEnvNumber(key: string, env: NodeJS.ProcessEnv = process.env): number | undefined {
  const raw = env[key]?.trim();
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}
