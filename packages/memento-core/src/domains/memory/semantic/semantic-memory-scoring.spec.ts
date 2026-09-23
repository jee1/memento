import { describe, expect, it } from 'vitest';
import { SemanticMemoryScoring } from './semantic-memory-scoring.js';

describe('SemanticMemoryScoring semantic quality helpers', () => {
  const scoring = new SemanticMemoryScoring();

  it('scores completeness, canonical predicate, and linked entities as 0.3/0.3/0.4', () => {
    const snapshot = scoring.prepareNormalizedTriple(
      { subject: 'system', predicate: 'use', object: 'feature' },
      7,
    );

    expect(snapshot).toEqual({
      index: 7,
      subject: '시스템',
      predicate: '사용함',
      object: 'feature',
      predicateCanonicalized: true,
      subjectLinked: true,
      objectLinked: true,
      confidence: 1,
    });
  });

  it('calls predicate canonicalization and entity linking once while preparing one snapshot', () => {
    const localScoring = new SemanticMemoryScoring();
    const internals = localScoring as unknown as {
      canonicalizer: { canonicalize: (predicate: string) => unknown };
      entityLinker: { link: (entity: string) => unknown };
    };
    let canonicalizeCalls = 0;
    let linkCalls = 0;
    const canonicalize = internals.canonicalizer.canonicalize.bind(internals.canonicalizer);
    const link = internals.entityLinker.link.bind(internals.entityLinker);
    internals.canonicalizer.canonicalize = (predicate: string) => {
      canonicalizeCalls += 1;
      return canonicalize(predicate);
    };
    internals.entityLinker.link = (entity: string) => {
      linkCalls += 1;
      return link(entity);
    };

    localScoring.prepareNormalizedTriple(
      { subject: 'system', predicate: 'use', object: 'feature' },
      0,
    );

    expect(canonicalizeCalls).toBe(1);
    expect(linkCalls).toBe(2);
  });

  it('preserves fallback predicate text with canonicalization success false', () => {
    const snapshot = scoring.prepareNormalizedTriple(
      { subject: 'system', predicate: 'bespoke relation', object: 'feature' },
      0,
    );

    expect(snapshot.predicate).toBe('bespoke relation');
    expect(snapshot.predicateCanonicalized).toBe(false);
    expect(snapshot.confidence).toBe(0.7);
  });

  it('excludes confidence equal to the threshold', () => {
    expect(scoring.passesConfidenceThreshold(0.7, 0.7)).toBe(false);
  });

  it('rejects non-finite confidence and values outside the unit range', () => {
    expect(scoring.passesConfidenceThreshold(Number.NaN, 0.7)).toBe(false);
    expect(scoring.passesConfidenceThreshold(Number.POSITIVE_INFINITY, 0.7)).toBe(false);
    expect(scoring.passesConfidenceThreshold(-0.1, 0.7)).toBe(false);
    expect(scoring.passesConfidenceThreshold(1.1, 0.7)).toBe(false);
  });

  it('uses the next confidence when the stored aggregate is NULL', () => {
    expect(scoring.calculateAggregateConfidence(null, 4, 0.6)).toBe(0.6);
  });

  it('weights aggregate confidence by the existing evidence count', () => {
    expect(scoring.calculateAggregateConfidence(0.8, 2, 0.5)).toBeCloseTo(0.7, 12);
  });

  it('keeps mathematically sub-one aggregate confidence representably below one', () => {
    expect(scoring.calculateAggregateConfidence(1, 9, 0.9999999999999999)).toBeLessThan(1);
  });

  it('keeps explicit episodic importance zero at zero', () => {
    expect(scoring.calculateImportance(0, 1, 99)).toBe(0);
  });

  it('multiplies episodic importance by aggregate confidence without boost below aggregate one', () => {
    expect(scoring.calculateImportance(0.8, 0.75, 99)).toBeCloseTo(0.6, 12);
  });

  it('boosts importance only when aggregate confidence is exactly one', () => {
    expect(scoring.calculateImportance(0.8, 1, 2)).toBeGreaterThan(0.8);
    expect(scoring.calculateImportance(0.8, 0.9999999999999999, 2)).toBeLessThan(0.8);
  });
});

describe('SemanticMemoryScoring.tripleToNaturalLanguage (#768 → #1137)', () => {
  const scoring = new SemanticMemoryScoring();

  it('재조립 가능한 triple은 문장으로 만든다', () => {
    expect(scoring.tripleToNaturalLanguage('시스템', '사용함', '기능')).toBe(
      '시스템은 기능을 사용합니다',
    );
  });

  it('재조립할 수 없으면 triple 구성 요소를 남긴다 — 원문을 복사하지 않는다', () => {
    expect(scoring.tripleToNaturalLanguage('시스템', 'use', '기능')).toBe('시스템 · use · 기능');
  });

  it('같은 원본에서 나온 서로 다른 triple은 서로 다른 content가 된다 (#1137 SC-002)', () => {
    const contents = [
      scoring.tripleToNaturalLanguage('llmbasedrelationextractor', 'stores', 'initializedproviders'),
      scoring.tripleToNaturalLanguage('isollamaavailable', 'uses', "initializedproviders.includes('ollama')"),
      scoring.tripleToNaturalLanguage('tests', 'cover', 'relation determineprovider'),
    ];

    expect(new Set(contents).size).toBe(3);
  });

  it('빈 구성 요소는 빼고 남은 것만 이어붙인다', () => {
    expect(scoring.tripleToNaturalLanguage('', 'use', '  ')).toBe('use');
  });
});
