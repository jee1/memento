/**
 * TripleNormalizer 게이트 테스트 (#813)
 * TDD: FR-001 시나리오 — pass-through 금지, skip reason 고정 집합
 */

import { describe, it, expect, vi } from 'vitest';
import { TripleNormalizer } from '../triple-normalizer.js';
import type { Triple } from '../../../../../shared/types/triple-extraction.js';
import { PredicateCanonicalizer } from '../predicate-canonicalizer.js';
import * as tripleSentence from '../../../../memory/semantic/triple-sentence.js';

describe('TripleNormalizer', () => {
  describe('normalize / normalizeWithReport (#813 gate)', () => {
    it('Given: 빈 Triple 배열, When: normalize, Then: 빈 배열', () => {
      const normalizer = new TripleNormalizer();
      expect(normalizer.normalize([])).toEqual([]);
      expect(normalizer.normalizeWithReport([])).toEqual({ triples: [], skips: [] });
    });

    it('Given: predicate `관련 작업`(구), When: normalizeWithReport, Then: drop predicate_canonicalize_failed', () => {
      const triples: Triple[] = [
        { subject: '시스템', predicate: '관련 작업', object: '기능' },
      ];
      const report = new TripleNormalizer().normalizeWithReport(triples);
      expect(report.triples).toEqual([]);
      expect(report.skips).toEqual([
        { index: 0, predicate: '관련 작업', reason: 'predicate_canonicalize_failed' },
      ]);
      expect(new TripleNormalizer().normalize(triples)).toEqual([]);
    });

    it('Given: 사전 미매칭 영문 `xyzuse`(미등재), When: gate, Then: drop predicate_canonicalize_failed', () => {
      const triples: Triple[] = [
        { subject: '시스템', predicate: 'xyzuse', object: '기능' },
      ];
      const report = new TripleNormalizer().normalizeWithReport(triples);
      expect(report.triples).toEqual([]);
      expect(report.skips[0]).toMatchObject({
        predicate: 'xyzuse',
        reason: 'predicate_canonicalize_failed',
      });
    });

    it('Given: 사전 매칭 `use`, When: gate, Then: accept canonical `사용함`', () => {
      const triples: Triple[] = [
        { subject: '시스템', predicate: 'use', object: '기능' },
      ];
      const report = new TripleNormalizer().normalizeWithReport(triples);
      expect(report.skips).toEqual([]);
      expect(report.triples).toHaveLength(1);
      expect(report.triples[0].predicate).toBe('사용함');
      expect(tripleSentence.buildTripleSentence(
        report.triples[0].subject,
        report.triples[0].predicate,
        report.triples[0].object,
      )).not.toBeNull();
    });

    it('Given: canonical `사용함`, When: gate, Then: accept + 재조립 가능', () => {
      const triples: Triple[] = [
        { subject: '시스템', predicate: '사용함', object: '기능' },
      ];
      const report = new TripleNormalizer().normalizeWithReport(triples);
      expect(report.triples).toHaveLength(1);
      expect(report.triples[0].predicate).toBe('사용함');
      expect(report.skips).toEqual([]);
    });

    it('Given: OOV 한글 단일 토큰 `배포함` + 재조립 OK, When: gate, Then: accept 원본', () => {
      const triples: Triple[] = [
        { subject: '패키지', predicate: '배포함', object: '모듈' },
      ];
      const report = new TripleNormalizer().normalizeWithReport(triples);
      expect(report.skips).toEqual([]);
      expect(report.triples).toHaveLength(1);
      expect(report.triples[0].predicate).toBe('배포함');
    });

    it('Given: 한글 종결이나 buildTripleSentence null, When: gate, Then: predicate_reassembly_failed', () => {
      // `음` alone → conjugatePredicate returns null (empty stem)
      const triples: Triple[] = [
        { subject: '시스템', predicate: '음', object: '기능' },
      ];
      const report = new TripleNormalizer().normalizeWithReport(triples);
      expect(report.triples).toEqual([]);
      expect(report.skips).toEqual([
        { index: 0, predicate: '음', reason: 'predicate_reassembly_failed' },
      ]);
    });

    it('Given: canonicalize OK but reassembly null, When: gate, Then: predicate_reassembly_failed', () => {
      const spy = vi.spyOn(tripleSentence, 'buildTripleSentence').mockReturnValue(null);
      try {
        const triples: Triple[] = [
          { subject: '시스템', predicate: '사용함', object: '기능' },
        ];
        const report = new TripleNormalizer().normalizeWithReport(triples);
        expect(report.triples).toEqual([]);
        expect(report.skips[0]?.reason).toBe('predicate_reassembly_failed');
      } finally {
        spy.mockRestore();
      }
    });

    it('Given: empty/whitespace predicate, When: gate, Then: predicate_empty', () => {
      const triples: Triple[] = [
        { subject: '시스템', predicate: '', object: '기능' },
        { subject: '시스템', predicate: '   ', object: '기능' },
      ];
      const report = new TripleNormalizer().normalizeWithReport(triples);
      expect(report.triples).toEqual([]);
      expect(report.skips.map((s) => s.reason)).toEqual([
        'predicate_empty',
        'predicate_empty',
      ]);
    });

    it('Given: mixed batch, When: gate, Then: partial accept + skips', () => {
      const triples: Triple[] = [
        { subject: '시스템', predicate: '관련 작업', object: '기능' },
        { subject: '시스템', predicate: '사용함', object: '기능' },
        { subject: '패키지', predicate: '배포함', object: '모듈' },
        { subject: '시스템', predicate: 'xyzlatin', object: '기능' },
      ];
      const report = new TripleNormalizer().normalizeWithReport(triples);
      expect(report.triples.map((t) => t.predicate)).toEqual(['사용함', '배포함']);
      expect(report.skips).toEqual([
        { index: 0, predicate: '관련 작업', reason: 'predicate_canonicalize_failed' },
        { index: 3, predicate: 'xyzlatin', reason: 'predicate_canonicalize_failed' },
      ]);
      expect(new TripleNormalizer().normalize(triples)).toEqual(report.triples);
    });

    it('Given: unknown Latin predicate, When: normalize, Then: pass-through 금지(drop)', () => {
      const triples: Triple[] = [
        { subject: 'UnknownEntity', predicate: 'unknownPredicate', object: 'UnknownObject' },
      ];
      const result = new TripleNormalizer().normalize(triples);
      expect(result).toEqual([]);
      const report = new TripleNormalizer().normalizeWithReport(triples);
      expect(report.skips[0]?.reason).toBe('predicate_canonicalize_failed');
    });

    it('Given: 좋아한다 synonym, When: normalize, Then: 좋아함 + entity link', () => {
      const triples: Triple[] = [
        { subject: 'user', predicate: '좋아한다', object: 'system' },
      ];
      const result = new TripleNormalizer().normalize(triples);
      expect(result).toHaveLength(1);
      expect(result[0].subject).toBe('사용자');
      expect(result[0].predicate).toBe('좋아함');
      expect(result[0].object).toBe('시스템');
    });

    it('Given: dictionary without use mapping, When: `use`, Then: drop', () => {
      const emptyDict = new PredicateCanonicalizer({});
      const normalizer = new TripleNormalizer(emptyDict);
      const triples: Triple[] = [
        { subject: '시스템', predicate: 'use', object: '기능' },
      ];
      const report = normalizer.normalizeWithReport(triples);
      expect(report.triples).toEqual([]);
      expect(report.skips[0]?.reason).toBe('predicate_canonicalize_failed');
    });
  });
});
