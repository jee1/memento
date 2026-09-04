/**
 * Triple 정규화기 클래스
 * 추출된 Triple을 정규화하여 일관성을 확보합니다.
 *
 * #813: predicate 게이트 — canonicalize 실패 원본 pass-through 금지.
 * Hangul OOV 단일 토큰은 buildTripleSentence 성공 시에만 수용.
 */

import type { ITripleNormalizer } from './interfaces.js';
import type {
  NormalizeWithReportResult,
  PredicateSkip,
  Triple,
} from '../../../../shared/types/triple-extraction.js';
import { PredicateCanonicalizer } from './predicate-canonicalizer.js';
import { EntityLinker } from './entity-linker.js';
import { buildTripleSentence } from '../../../memory/semantic/triple-sentence.js';

const HANGUL_START = 0xac00;
const HANGUL_END = 0xd7a3;

function endsWithHangulSyllable(value: string): boolean {
  const last = value.slice(-1);
  const code = last.codePointAt(0);
  return code !== undefined && code >= HANGUL_START && code <= HANGUL_END;
}

/** 공백 없는 한글 종결 단일 토큰 (OOV 후보). */
function isHangulOovSingleToken(predicate: string): boolean {
  return predicate.length > 0 && !/\s/.test(predicate) && endsWithHangulSyllable(predicate);
}

/**
 * Triple 정규화기 클래스
 */
export class TripleNormalizer implements ITripleNormalizer {
  private readonly canonicalizer: PredicateCanonicalizer;
  private readonly entityLinker: EntityLinker;

  constructor(
    canonicalizer?: PredicateCanonicalizer,
    entityLinker?: EntityLinker
  ) {
    this.canonicalizer = canonicalizer || new PredicateCanonicalizer();
    this.entityLinker = entityLinker || new EntityLinker();
  }

  /**
   * accepted triples만 반환 (skips 제외).
   */
  normalize(triples: Triple[]): Triple[] {
    return this.normalizeWithReport(triples).triples;
  }

  /**
   * FR-001/002 게이트 + entity linking. pass-through 금지.
   */
  normalizeWithReport(triples: Triple[]): NormalizeWithReportResult {
    if (!triples || triples.length === 0) {
      return { triples: [], skips: [] };
    }

    const accepted: Triple[] = [];
    const skips: PredicateSkip[] = [];

    for (let index = 0; index < triples.length; index++) {
      const triple = triples[index]!;
      const subject = this.entityLinker.link(triple.subject).linked;
      const object = this.entityLinker.link(triple.object).linked;
      const rawPredicate = typeof triple.predicate === 'string' ? triple.predicate : '';
      const trimmed = rawPredicate.trim();

      if (trimmed.length === 0) {
        skips.push({ index, predicate: rawPredicate, reason: 'predicate_empty' });
        continue;
      }

      const canonicalResult = this.canonicalizer.canonicalize(trimmed);

      if (canonicalResult.success) {
        const canonical = canonicalResult.canonical;
        if (buildTripleSentence(subject, canonical, object) !== null) {
          accepted.push({ subject, predicate: canonical, object });
        } else {
          skips.push({ index, predicate: trimmed, reason: 'predicate_reassembly_failed' });
        }
        continue;
      }

      // canonicalize FAIL — Hangul OOV single-token iff reassembly OK
      if (isHangulOovSingleToken(trimmed)) {
        if (buildTripleSentence(subject, trimmed, object) !== null) {
          accepted.push({ subject, predicate: trimmed, object });
        } else {
          skips.push({ index, predicate: trimmed, reason: 'predicate_reassembly_failed' });
        }
        continue;
      }

      skips.push({ index, predicate: trimmed, reason: 'predicate_canonicalize_failed' });
    }

    return { triples: accepted, skips };
  }
}
