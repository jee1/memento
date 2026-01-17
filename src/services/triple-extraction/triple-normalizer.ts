/**
 * Triple 정규화기 클래스
 * 추출된 Triple을 정규화하여 일관성을 확보합니다.
 * 
 * Given: Triple 배열이 제공됨
 * When: Triple의 엔티티와 predicate를 정규화함
 * Then: 정규화된 Triple 배열을 반환함
 */

import type { ITripleNormalizer } from './interfaces.js';
import type { Triple } from '../../shared/types/triple-extraction.js';
import { PredicateCanonicalizer } from './predicate-canonicalizer.js';
import { EntityLinker } from './entity-linker.js';

/**
 * Triple 정규화기 클래스
 * 추출된 Triple을 정규화하여 일관성을 확보합니다.
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
   * Given: Triple 배열이 제공됨
   * When: Triple의 엔티티와 predicate를 정규화함
   * Then: 정규화된 Triple 배열을 반환함
   * 
   * @param triples - 정규화할 Triple 배열
   * @returns 정규화된 Triple 배열
   */
  normalize(triples: Triple[]): Triple[] {
    if (!triples || triples.length === 0) {
      return [];
    }

    return triples.map(triple => {
      // Predicate 정규화
      const canonicalResult = this.canonicalizer.canonicalize(triple.predicate);
      const normalizedPredicate = canonicalResult.success 
        ? canonicalResult.canonical 
        : triple.predicate;

      // Subject Entity Linking 및 정규화
      const subjectResult = this.entityLinker.link(triple.subject);
      const normalizedSubject = subjectResult.linked;

      // Object Entity Linking 및 정규화
      const objectResult = this.entityLinker.link(triple.object);
      const normalizedObject = objectResult.linked;

      return {
        subject: normalizedSubject,
        predicate: normalizedPredicate,
        object: normalizedObject
      };
    });
  }
}
