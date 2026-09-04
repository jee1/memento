/**
 * #813: TripleExtractionService predicate gate wiring + result-helper soft-success
 */

import { describe, expect, it, vi } from 'vitest';
import type { Triple, TripleExtractionResult } from '../../../../shared/types/triple-extraction.js';
import {
  countPredicateSkipReasons,
  hasPredicateGateSkips,
  normalizeTripleExtractionResult,
  trackTripleExtractionSteps,
} from './triple-extraction-result-helpers.js';
import { TripleNormalizer } from './triple-normalizer.js';
import { PredicateCanonicalizer } from './predicate-canonicalizer.js';
import { EntityLinker } from './entity-linker.js';
import { logger } from '../../../../shared/utils/logger.js';

describe('predicate gate extraction wiring (#813)', () => {
  it('countPredicateSkipReasons aggregates by reason', () => {
    expect(
      countPredicateSkipReasons([
        { index: 0, predicate: 'a', reason: 'predicate_empty' },
        { index: 1, predicate: 'b', reason: 'predicate_canonicalize_failed' },
        { index: 2, predicate: 'c', reason: 'predicate_empty' },
      ])
    ).toEqual({
      predicate_empty: 2,
      predicate_canonicalize_failed: 1,
    });
  });

  it('normalizeTripleExtractionResult does not stamp no_triple when skips present', () => {
    const result: TripleExtractionResult = {
      triples: [],
      extractionInfo: {
        steps: { canonicalization: false, entityLinking: false },
        predicateSkips: [
          { index: 0, predicate: '관련 작업', reason: 'predicate_canonicalize_failed' },
        ],
        predicateSkipCounts: { predicate_canonicalize_failed: 1 },
      },
    };

    const normalized = normalizeTripleExtractionResult(result, () => ({
      canonicalization: false,
      entityLinking: false,
    }));

    expect(normalized.triples).toEqual([]);
    expect(normalized.extractionInfo.failureReason).toBeUndefined();
    expect(hasPredicateGateSkips(normalized.extractionInfo)).toBe(true);
  });

  it('normalizeTripleExtractionResult still stamps no_triple for true empty', () => {
    const result: TripleExtractionResult = {
      triples: [],
      extractionInfo: {
        steps: { canonicalization: false, entityLinking: false },
      },
    };

    const normalized = normalizeTripleExtractionResult(result, () => ({
      canonicalization: false,
      entityLinking: false,
    }));

    expect(normalized.extractionInfo.failureReason).toBe('no_triple');
  });

  it('service-shaped fold: accepted only + skips on ExtractionInfo', () => {
    const raw: Triple[] = [
      { subject: '시스템', predicate: '관련 작업', object: '기능' },
      { subject: '시스템', predicate: '사용함', object: '기능' },
    ];
    const report = new TripleNormalizer().normalizeWithReport(raw);
    const skipCounts = countPredicateSkipReasons(report.skips);
    const steps = trackTripleExtractionSteps(
      report.triples,
      new PredicateCanonicalizer(),
      new EntityLinker()
    );

    const extractionInfo = {
      steps,
      predicateSkips: report.skips,
      predicateSkipCounts: skipCounts,
    };

    expect(report.triples).toHaveLength(1);
    expect(report.triples[0].predicate).toBe('사용함');
    expect(extractionInfo.predicateSkips).toEqual([
      { index: 0, predicate: '관련 작업', reason: 'predicate_canonicalize_failed' },
    ]);
    expect(extractionInfo.predicateSkipCounts).toEqual({
      predicate_canonicalize_failed: 1,
    });

    const folded = normalizeTripleExtractionResult(
      { triples: report.triples, extractionInfo },
      () => steps
    );
    expect(folded.triples).toHaveLength(1);
    expect(folded.extractionInfo.failureReason).toBeUndefined();
  });

  it('logs structured skip reasons when folding skips (FR-007)', () => {
    const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => undefined);
    try {
      const report = new TripleNormalizer().normalizeWithReport([
        { subject: '시스템', predicate: '관련 작업', object: '기능' },
      ]);
      const skipCounts = countPredicateSkipReasons(report.skips);
      logger.info('TripleExtractionService: predicate gate skips', {
        skipCount: report.skips.length,
        reasons: skipCounts,
      });
      expect(infoSpy).toHaveBeenCalledWith(
        'TripleExtractionService: predicate gate skips',
        expect.objectContaining({
          skipCount: 1,
          reasons: { predicate_canonicalize_failed: 1 },
        })
      );
    } finally {
      infoSpy.mockRestore();
    }
  });
});
