import type { ContinuityOriginSource } from '../types.js';

export function buildContinuityTags(primary: string[], base: string[] = []): string[] {
  return [...new Set([...base, ...primary])];
}

export function buildOriginSource(input: ContinuityOriginSource): string {
  return JSON.stringify(input);
}

export function parseOriginSource(raw?: string | null): ContinuityOriginSource {
  if (!raw) return {};
  return JSON.parse(raw) as ContinuityOriginSource;
}
