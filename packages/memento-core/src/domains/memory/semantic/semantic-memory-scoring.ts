/**
 * Semantic Memory confidence·importance·정규화
 */

import type { ExtractionInfo, Triple } from '../../../shared/types/triple-extraction.js';
import { EntityLinker } from '../../relation/services/triple-extraction/entity-linker.js';
import { PredicateCanonicalizer } from '../../relation/services/triple-extraction/predicate-canonicalizer.js';
import { buildTripleSentence } from './triple-sentence.js';
import type { NormalizedTripleSnapshot } from './semantic-memory-update-types.js';

/** 폴백으로 원문을 보존할 때의 최대 길이 (episodic 원문은 길 수 있다) */
const FALLBACK_TEXT_MAX_LENGTH = 500;

export class SemanticMemoryScoring {
  private readonly canonicalizer = new PredicateCanonicalizer();
  private readonly entityLinker = new EntityLinker();

  /**
   * triple을 문장으로 만든다. 재조립할 수 없으면 합성 문장 대신 원문(`fallbackText`)을 보존한다 (#768).
   */
  tripleToNaturalLanguage(
    subject: string,
    predicate: string,
    object: string,
    fallbackText?: string
  ): string {
    const sentence = buildTripleSentence(subject, predicate, object);
    if (sentence) {
      return sentence;
    }

    const fallback = (fallbackText ?? '').trim();
    if (fallback) {
      return fallback.length > FALLBACK_TEXT_MAX_LENGTH
        ? `${fallback.slice(0, FALLBACK_TEXT_MAX_LENGTH)}…`
        : fallback;
    }

    return [subject, predicate, object]
      .map((part) => (part ?? '').trim())
      .filter((part) => part.length > 0)
      .join(' · ');
  }

  normalizeTripleForKg(triple: Triple): { subject: string; predicate: string; object: string } {
    const snapshot = this.prepareNormalizedTriple(triple, 0);
    return {
      subject: snapshot.subject,
      predicate: snapshot.predicate,
      object: snapshot.object
    };
  }

  prepareNormalizedTriple(triple: Triple, index: number): NormalizedTripleSnapshot {
    let confidence = 0.0;

    if (triple.subject && triple.predicate && triple.object) {
      confidence += 0.3;
    }

    const predicateResult = this.canonicalizer.canonicalize(triple.predicate);
    if (predicateResult.success) {
      confidence += 0.3;
    }

    const subjectResult = this.entityLinker.link(triple.subject);
    const objectResult = this.entityLinker.link(triple.object);

    if (subjectResult.success && objectResult.success) {
      confidence += 0.4;
    } else if (subjectResult.success || objectResult.success) {
      confidence += 0.2;
    }

    return {
      index,
      subject: subjectResult.linked,
      predicate: predicateResult.canonical,
      object: objectResult.linked,
      predicateCanonicalized: predicateResult.success,
      subjectLinked: subjectResult.success,
      objectLinked: objectResult.success,
      confidence: Math.min(1.0, Math.max(0.0, confidence))
    };
  }

  passesConfidenceThreshold(confidence: number, threshold: number): boolean {
    return Number.isFinite(confidence) && confidence >= 0 && confidence <= 1 && confidence > threshold;
  }

  calculateAggregateConfidence(existing: number | null, numTimes: number, next: number): number {
    if (existing === null) {
      return next;
    }

    const aggregate = (existing * numTimes + next) / (numTimes + 1);
    return aggregate === 1 && (existing < 1 || next < 1) ? 1 - Number.EPSILON / 2 : aggregate;
  }

  calculateConfidence(triple: Triple, _extractionInfo: ExtractionInfo): number {
    return this.prepareNormalizedTriple(triple, 0).confidence;
  }

  calculateImportance(episodicImportance: number, aggregateConfidence: number, finalNumTimes?: number): number {
    if (finalNumTimes === undefined) {
      return this.calculateLegacyImportance(episodicImportance, aggregateConfidence);
    }

    const base = episodicImportance * aggregateConfidence;
    const importance = aggregateConfidence === 1 && base > 0 && finalNumTimes > 1
      ? Math.min(1, base + Math.log(finalNumTimes + 1) / Math.log(10) * 0.1)
      : base;

    return Math.min(1.0, Math.max(0.0, importance));
  }

  private calculateLegacyImportance(episodicImportance: number, episodeCount: number): number {
    let importance = episodicImportance;

    if (episodeCount > 1) {
      const boost = Math.log(episodeCount + 1) / Math.log(10);
      importance = Math.min(1.0, importance + (boost * 0.1));
    }

    return Math.min(1.0, Math.max(0.0, importance));
  }

  canonicalizeAndLink(triple: Triple): {
    normalizedSubject: string;
    normalizedPredicate: string;
    normalizedObject: string;
  } {
    const snapshot = this.prepareNormalizedTriple(triple, 0);
    return {
      normalizedSubject: snapshot.subject,
      normalizedPredicate: snapshot.predicate,
      normalizedObject: snapshot.object
    };
  }
}
