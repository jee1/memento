/**
 * triple-text-chunker 단위 테스트
 *
 * Given/When/Then 패턴을 따릅니다.
 */

import { describe, it, expect } from 'vitest';
import { splitTextIntoChunks } from './triple-text-chunker.js';

describe('splitTextIntoChunks', () => {
  it('빈 문자열이면 빈 배열을 반환한다', () => {
    const result = splitTextIntoChunks('', 10, 2);

    expect(result).toEqual([]);
  });

  it('chunkSize가 0 이하면 RangeError', () => {
    expect(() => splitTextIntoChunks('abc', 0, 0)).toThrow(RangeError);
  });

  it('chunkSize가 음수면 RangeError', () => {
    expect(() => splitTextIntoChunks('abc', -1, 0)).toThrow(RangeError);
  });

  it('overlap이 0 미만이면 RangeError', () => {
    expect(() => splitTextIntoChunks('abc', 3, -1)).toThrow(RangeError);
  });

  it('overlap이 chunkSize 이상이면 RangeError', () => {
    expect(() => splitTextIntoChunks('abc', 3, 3)).toThrow(RangeError);
    expect(() => splitTextIntoChunks('abc', 3, 4)).toThrow(RangeError);
  });

  it('overlap 0이면 길이 chunkSize 블록으로 나눈다', () => {
    const result = splitTextIntoChunks('abcdef', 3, 0);

    expect(result).toEqual(['abc', 'def']);
  });

  it('텍스트가 chunkSize보다 짧으면 한 덩어리로 반환한다', () => {
    const result = splitTextIntoChunks('ab', 10, 0);

    expect(result).toEqual(['ab']);
  });

  it('슬라이딩 윈도: 다음 시작은 이전 시작 + (chunkSize - overlap)', () => {
    const result = splitTextIntoChunks('abcdefghij', 4, 1);

    expect(result).toEqual(['abcd', 'defg', 'ghij']);
  });

  it('끝에서 남은 글자를 덮는 마지막 청크를 포함한다', () => {
    const result = splitTextIntoChunks('abcde', 4, 1);

    expect(result).toEqual(['abcd', 'de']);
  });

  it('overlap이 chunkSize-1이면 한 글자씩 밀린다', () => {
    const result = splitTextIntoChunks('abcd', 2, 1);

    expect(result).toEqual(['ab', 'bc', 'cd']);
  });
});
