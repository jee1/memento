import { describe, it, expect } from 'vitest';
import { extractKnowledgeCandidates } from './knowledge-candidate-extractor.js';

describe('extractKnowledgeCandidates', () => {
  describe('preference', () => {
    it('앞으로는 신호가 있으면 semantic 후보를 만든다', () => {
      const msg = '앞으로는 코드 리뷰할 때 타입스크립트를 우선했으면 좋겠어';
      const r = extractKnowledgeCandidates(msg);
      expect(r.length).toBeGreaterThanOrEqual(1);
      const p = r.find((x) => x.category === 'preference');
      expect(p).toBeDefined();
      expect(p!.suggestedMemoryType).toBe('semantic');
      expect(p!.reason.length).toBeGreaterThan(0);
      expect(p!.confidence).toBeGreaterThan(0);
      expect(p!.tags).toContain('personal-agent');
      expect(p!.tags).toContain('preference');
    });

    it('질문형만 있으면 선호 후보를 만들지 않는다', () => {
      expect(extractKnowledgeCandidates('앞으로는 뭘 쓸까?')).toEqual([]);
    });

    it('선호 표현이 명시되면 후보를 만든다', () => {
      const r = extractKnowledgeCandidates('나는 탭을 선호해');
      expect(r.some((x) => x.category === 'preference')).toBe(true);
    });
  });

  describe('decision', () => {
    it('하기로 했 신호가 있으면 episodic 후보를 만든다', () => {
      const r = extractKnowledgeCandidates('타입체크를 먼저 하기로 했다');
      const d = r.find((x) => x.category === 'decision');
      expect(d).toBeDefined();
      expect(d!.suggestedMemoryType).toBe('episodic');
      expect(d!.reason).toContain('하기로');
    });

    it('결정했: 형태를 인식한다', () => {
      const r = extractKnowledgeCandidates('결정했: 배포는 금요일로 고정');
      expect(r.some((x) => x.category === 'decision')).toBe(true);
    });

    it('모호한 질문은 결정 후보를 만들지 않는다', () => {
      expect(extractKnowledgeCandidates('하기로 했나?')).toEqual([]);
    });
  });

  describe('learning', () => {
    it('TIL 신호를 인식한다', () => {
      const r = extractKnowledgeCandidates('TIL: SQLite는 단일 파일이다');
      const x = r.find((c) => c.category === 'learning');
      expect(x).toBeDefined();
      expect(x!.suggestedMemoryType).toBe('semantic');
    });

    it('기억해둬 본문이 짧으면 후보를 만들지 않는다', () => {
      expect(extractKnowledgeCandidates('기억해둬')).toEqual([]);
    });

    it('알게 됐 신호를 인식한다', () => {
      const r = extractKnowledgeCandidates('알게 됐다: JWT는 만료가 중요하다');
      expect(r.some((x) => x.category === 'learning')).toBe(true);
    });
  });

  describe('procedure', () => {
    it('번호 목록 2단계 이상이면 procedural 후보', () => {
      const msg = '1. 빌드한다\n2. 테스트한다';
      const r = extractKnowledgeCandidates(msg);
      const p = r.find((x) => x.category === 'procedure');
      expect(p).toBeDefined();
      expect(p!.suggestedMemoryType).toBe('procedural');
    });

    it('단일 번호만 있으면 절차 후보를 만들지 않는다', () => {
      expect(extractKnowledgeCandidates('1. 빌드만 한다')).toEqual([]);
    });

    it('먼저 그다음 패턴을 인식한다', () => {
      const r = extractKnowledgeCandidates('먼저 설치하고 그다음 실행해');
      expect(r.some((x) => x.category === 'procedure')).toBe(true);
    });
  });

  describe('edge', () => {
    it('빈 문자열은 빈 배열', () => {
      expect(extractKnowledgeCandidates('')).toEqual([]);
      expect(extractKnowledgeCandidates('   ')).toEqual([]);
    });

    it('신호 없는 일반 문장', () => {
      expect(extractKnowledgeCandidates('그냥 잡담이야')).toEqual([]);
    });
  });
});
