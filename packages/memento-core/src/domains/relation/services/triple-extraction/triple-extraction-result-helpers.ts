/**
 * Triple 추출 결과 생성·정규화 헬퍼
 */

import type {
  ExtractionInfo,
  ExtractionSteps,
  PredicateSkip,
  PredicateSkipReason,
  Triple,
  TripleExtractionFailureReason,
  TripleExtractionResult,
} from '../../../../shared/types/triple-extraction.js';
import type { EntityLinker } from './entity-linker.js';
import type { PredicateCanonicalizer } from './predicate-canonicalizer.js';

export function countPredicateSkipReasons(
  skips: PredicateSkip[]
): Partial<Record<PredicateSkipReason, number>> {
  const counts: Partial<Record<PredicateSkipReason, number>> = {};
  for (const skip of skips) {
    counts[skip.reason] = (counts[skip.reason] ?? 0) + 1;
  }
  return counts;
}

export function hasPredicateGateSkips(
  info: Pick<ExtractionInfo, 'predicateSkips' | 'predicateSkipCounts'>
): boolean {
  if ((info.predicateSkips?.length ?? 0) > 0) {
    return true;
  }
  return Object.values(info.predicateSkipCounts ?? {}).some(
    (n) => typeof n === 'number' && n > 0
  );
}

export function trackTripleExtractionSteps(
  triples: Triple[],
  canonicalizer: PredicateCanonicalizer,
  entityLinker: EntityLinker
): ExtractionSteps {
  if (triples.length === 0) {
    return {
      canonicalization: false,
      entityLinking: false,
    };
  }

  let canonicalizationSuccess = false;
  let entityLinkingSuccess = false;

  for (const triple of triples) {
    if (!canonicalizationSuccess) {
      canonicalizationSuccess = canonicalizer.canonicalize(triple.predicate).success;
    }

    if (!entityLinkingSuccess) {
      entityLinkingSuccess =
        entityLinker.link(triple.subject).success || entityLinker.link(triple.object).success;
    }

    if (canonicalizationSuccess && entityLinkingSuccess) {
      break;
    }
  }

  return {
    canonicalization: canonicalizationSuccess,
    entityLinking: entityLinkingSuccess,
  };
}

export function normalizeTripleExtractionResult(
  result: TripleExtractionResult,
  trackSteps: (triples: Triple[]) => ExtractionSteps
): TripleExtractionResult {
  const rawTriples = Array.isArray(result.triples) ? result.triples : [];
  const normalizedTriples = rawTriples
    .filter((triple) => {
      if (!triple) {
        return false;
      }
      const subject = typeof triple.subject === 'string' ? triple.subject.trim() : '';
      const predicate = typeof triple.predicate === 'string' ? triple.predicate.trim() : '';
      const object = typeof triple.object === 'string' ? triple.object.trim() : '';
      return subject.length > 0 && predicate.length > 0 && object.length > 0;
    })
    .map((triple) => ({
      ...triple,
      subject: triple.subject.trim(),
      predicate: triple.predicate.trim(),
      object: triple.object.trim(),
    }));

  const steps = result.extractionInfo?.steps ?? trackSteps(normalizedTriples);
  const extractionInfo: ExtractionInfo = {
    ...(result.extractionInfo ?? {}),
    steps,
  };

  if (normalizedTriples.length > 0) {
    extractionInfo.failureReason = undefined;
  } else if (!extractionInfo.failureReason && !hasPredicateGateSkips(extractionInfo)) {
    // #813: all-gated soft success keeps skips without stamping no_triple
    extractionInfo.failureReason = 'no_triple';
  }

  return {
    ...result,
    triples: normalizedTriples,
    extractionInfo,
  };
}

export function createTripleExtractionFailureResult(
  failureReason: TripleExtractionFailureReason,
  rawLLMOutput?: string
): TripleExtractionResult {
  const extractionInfo: ExtractionInfo = {
    failureReason,
    steps: {
      canonicalization: false,
      entityLinking: false,
    },
    rawLLMOutput,
  };

  return {
    triples: [],
    extractionInfo,
  };
}
