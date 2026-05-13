import { describe, it, expect } from 'vitest';
import { isAmbiguousUserMessage } from './knowledge-candidate-text-ambiguity.js';

describe('isAmbiguousUserMessage', () => {
  it('ASCII 또는 전각 물음표로 끝나면 true', () => {
    expect(isAmbiguousUserMessage('하기로 했나?')).toBe(true);
    expect(isAmbiguousUserMessage('확인？')).toBe(true);
  });

  it('한국어 질문 어미로 끝나면 true', () => {
    expect(isAmbiguousUserMessage('앞으로는 뭘 쓸까')).toBe(true);
    expect(isAmbiguousUserMessage('이게 맞나요')).toBe(true);
  });

  it('가정절(하기로 했다면 / …다면)이면 true', () => {
    expect(isAmbiguousUserMessage('배포하기로 했다면 회의에서 정하자')).toBe(true);
    expect(isAmbiguousUserMessage('만약 어제 배포했다면 위험했다')).toBe(true);
  });

  it('확정 서술이면 false', () => {
    expect(isAmbiguousUserMessage('타입체크를 먼저 하기로 했다')).toBe(false);
    expect(isAmbiguousUserMessage('앞으로는 PR 설명은 한국어로 쓰고 싶어')).toBe(false);
  });
});
