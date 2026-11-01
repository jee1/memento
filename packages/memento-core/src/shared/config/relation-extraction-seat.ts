import type { LLMProvider } from '../types/memory.types.js';
import { isChatLlmProvider } from './llm-provider-override.js';

/**
 * Raw result of LLM_PROVIDER_RELATION_EXTRACTION only.
 * 'jev' is valid here and nowhere else.
 */
export type RelationExtractionOverride =
  | { readonly kind: 'unset' }
  | { readonly kind: 'invalid'; readonly raw: string }
  | { readonly kind: 'chat'; readonly provider: LLMProvider }
  | { readonly kind: 'jev' };

/** Resolved engine. Invalid and unset collapse to chat(global) inside the resolver. */
export type RelationExtractionSeat =
  | { readonly kind: 'chat'; readonly provider: LLMProvider }
  | { readonly kind: 'jev' };

const RELATION_EXTRACTION_ENV_KEY = 'LLM_PROVIDER_RELATION_EXTRACTION';

export function parseRelationExtractionOverride(raw: string | undefined): RelationExtractionOverride {
  if (raw === undefined) {
    return { kind: 'unset' };
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return { kind: 'unset' };
  }
  const normalized = trimmed.toLowerCase();
  if (normalized === 'jev') {
    return { kind: 'jev' };
  }
  if (isChatLlmProvider(normalized)) {
    return { kind: 'chat', provider: normalized };
  }
  return { kind: 'invalid', raw: trimmed };
}

/** chat 만 provider 맵에 둔다. jev, unset, invalid 는 키를 지워 전역 LLM_PROVIDER 를 따르게 한다. */
export function syncRelationExtractionProvider(
  overrides: { relation_extraction?: LLMProvider },
  override: RelationExtractionOverride,
): void {
  if (override.kind === 'chat') {
    overrides.relation_extraction = override.provider;
  } else {
    delete overrides.relation_extraction;
  }
}

export function resolveRelationExtractionSeat(config: {
  readonly llmProvider: LLMProvider;
  readonly relationExtractionOverride: RelationExtractionOverride;
}): RelationExtractionSeat {
  const override = config.relationExtractionOverride;
  if (override.kind === 'jev') {
    return { kind: 'jev' };
  }
  if (override.kind === 'chat') {
    return { kind: 'chat', provider: override.provider };
  }
  return { kind: 'chat', provider: config.llmProvider };
}

export function warnInvalidRelationExtractionOverride(
  override: RelationExtractionOverride,
  warnedKeys: Set<string>,
): void {
  if (override.kind !== 'invalid' || warnedKeys.has(RELATION_EXTRACTION_ENV_KEY)) {
    return;
  }
  warnedKeys.add(RELATION_EXTRACTION_ENV_KEY);
  process.stderr.write(
    `[CONFIG WARN] Invalid ${RELATION_EXTRACTION_ENV_KEY}="${override.raw}"; ignoring per-job LLM provider override.\n`,
  );
}
