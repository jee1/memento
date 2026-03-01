import type { ContinuityOriginSource } from '../types.js';

export function buildContinuityTags(primary: string[], base: string[] = []): string[] {
  return [...new Set([...base, ...primary])];
}

export function buildOriginSource(input: ContinuityOriginSource): string {
  return JSON.stringify(input);
}

export function parseOriginSource(
  raw?: string | ContinuityOriginSource | null
): ContinuityOriginSource {
  if (!raw) return {};
  if (typeof raw === 'string') return JSON.parse(raw) as ContinuityOriginSource;
  return raw;
}
