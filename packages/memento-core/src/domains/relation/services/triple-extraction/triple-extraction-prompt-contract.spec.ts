/**
 * #1137: 추출 프롬프트가 predicate 형태를 강제하는지 고정한다.
 *
 * 게이트(#813)의 실질 통과 조건은 사전 등재가 아니라 「공백 없는 한글 종결 단일 토큰 +
 * buildTripleSentence 성공」이다(triple-normalizer.ts:88-95). 프롬프트가 그 형태를 요구하지
 * 않으면 LLM이 영문 predicate를 뱉고 게이트가 전량 drop한다.
 */

import { describe, expect, it } from 'vitest';
import { PromptTemplateLoader } from '../../../../shared/utils/prompt-template-loader.js';
import { PredicateCanonicalizer } from './predicate-canonicalizer.js';

const prompt = PromptTemplateLoader.loadTemplate('triple-extraction');

describe('triple-extraction 프롬프트 predicate 계약 (#1137)', () => {
  it('한글 ㅁ 명사화형을 명시적으로 요구한다', () => {
    expect(prompt).toContain('ㅁ 명사화형');
  });

  it('영문 predicate 금지를 명시한다', () => {
    expect(prompt).toContain('영문 predicate를 쓰지 마세요');
  });

  it('모든 canonical predicate가 프롬프트 목록에 있다', () => {
    const canonicals = new PredicateCanonicalizer().getCanonicalPredicates();
    const missing = canonicals.filter((canonical) => !prompt.includes(canonical));

    expect(missing, `프롬프트에 없는 canonical: ${missing.join(', ')}`).toEqual([]);
  });

  it('적절한 동사가 없는 관계는 추출하지 말라고 지시한다', () => {
    expect(prompt).toContain('적절한 동사가 없는 관계');
  });

  it('영문 predicate 금지를 대조 예시로 보여준다', () => {
    expect(prompt).toContain('stores');
    expect(prompt).toContain('저장함');
  });

  it('observation 플레이스홀더를 유지한다', () => {
    expect(prompt).toContain('{observation}');
  });
});
