import { describe, expect, it } from 'vitest';
import { PredicateCanonicalizer } from '../../relation/services/triple-extraction/predicate-canonicalizer.js';
import { buildTripleSentence, hasBrokenTripleConjugation } from './triple-sentence.js';

/**
 * #768: triple → 문장 재조립 손상 회귀 테스트.
 * 아래 입력들은 2026-08-15 memory_injection 응답에서 실제로 관측된 손상 문장의 원본 triple이다.
 */
describe('buildTripleSentence (#768)', () => {
  it('사전 canonical predicate에 합니다를 덧붙이지 않는다', () => {
    expect(
      buildTripleSentence('memento mcp server 하이브리드 자동 설치 시스템', '구현함', '완료'),
    ).toBe('memento mcp server 하이브리드 자동 설치 시스템은 완료를 구현합니다');
  });

  it('됨 형태는 됩니다로 활용한다', () => {
    expect(buildTripleSentence('serverservices 인터페이스', '정의됨', '모든 서비스 타입')).toBe(
      'serverservices 인터페이스는 모든 서비스 타입을 정의됩니다',
    );
  });

  it('받침에 따라 은/는·을/를을 고른다', () => {
    expect(buildTripleSentence('시스템', '사용함', '기능')).toBe('시스템은 기능을 사용합니다');
    expect(buildTripleSentence('스키마', '사용함', '테스트')).toBe('스키마는 테스트를 사용합니다');
  });

  it('한글이 아닌 종결(영문·숫자)은 받침 없음으로 취급한다', () => {
    expect(buildTripleSentence('server-factory.spec.ts', '생성함', '타입 검증 테스트')).toBe(
      'server-factory.spec.ts는 타입 검증 테스트를 생성합니다',
    );
  });

  it('음 형태는 습니다로 활용한다', () => {
    expect(buildTripleSentence('테스트', '확인했음', '커버리지')).toBe(
      '테스트는 커버리지를 확인했습니다',
    );
  });

  it('다로 끝나는 서술형은 그대로 둔다', () => {
    expect(buildTripleSentence('스키마', '가지고 있다', '인덱스')).toBe(
      '스키마는 인덱스를 가지고 있다',
    );
  });

  it('구성 요소가 비었거나 줄바꿈이 섞이면 null을 돌려준다 (원문 폴백 신호)', () => {
    expect(buildTripleSentence('', '사용함', '기능')).toBeNull();
    expect(buildTripleSentence('시스템', '   ', '기능')).toBeNull();
    expect(buildTripleSentence('시스템', '사용함', 'a\nb')).toBeNull();
  });

  it('한글로 끝나지 않는 predicate는 활용할 수 없으므로 null을 돌려준다', () => {
    expect(buildTripleSentence('시스템', 'use', '기능')).toBeNull();
  });

  it('사전의 모든 canonical predicate가 이중 활용 없이 종결된다', () => {
    const canonicals = new PredicateCanonicalizer().getCanonicalPredicates();
    expect(canonicals.length).toBeGreaterThan(0);

    for (const canonical of canonicals) {
      const sentence = buildTripleSentence('주체', canonical, '대상');
      expect(sentence, `canonical=${canonical}`).not.toBeNull();
      // canonical을 그대로 두고 합니다를 덧붙이는 옛 동작을 정확히 배제한다.
      expect(sentence, `canonical=${canonical}`).not.toContain(`${canonical}합니다`);
      expect(sentence, `canonical=${canonical}`).toMatch(/(니다|다)$/);
    }
  });
});

describe('hasBrokenTripleConjugation (#768)', () => {
  it('구 템플릿이 만든 이중 활용을 잡아낸다', () => {
    expect(hasBrokenTripleConjugation('인터페이스는 타입을 정의됨합니다')).toBe(true);
    expect(hasBrokenTripleConjugation('릴리스는 절차를 다름합니다')).toBe(true);
    expect(hasBrokenTripleConjugation('테스트는 커버리지를 확인했음합니다')).toBe(true);
  });

  it('정상 문장은 통과시킨다', () => {
    expect(hasBrokenTripleConjugation('시스템은 완료를 구현합니다')).toBe(false);
    expect(hasBrokenTripleConjugation('오늘 회의에서 배포 일정을 정했다')).toBe(false);
  });

  it('함합니다는 정상 문장과 구분되지 않으므로 신호로 쓰지 않는다', () => {
    // 새 렌더러가 canonical 포함함으로 만드는 정상 문장.
    expect(hasBrokenTripleConjugation('시스템은 기능을 포함합니다')).toBe(false);
    // 같은 이유로 손상된 구현함합니다도 여기서는 잡히지 않는다 — 복구 스크립트가 처리한다.
    expect(hasBrokenTripleConjugation('시스템는 완료를 구현함합니다')).toBe(false);
  });
});
