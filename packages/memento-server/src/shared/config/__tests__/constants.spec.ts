/**
 * 상수 파일 구조 테스트
 * 
 * 3.3.1: constants.ts 파일 구조 검증
 */

import { describe, it, expect } from 'vitest';
import * as constants from '../constants.js';

describe('3.3.1 constants.ts 파일 구조', () => {
  it('constants 모듈이 올바르게 export됨', () => {
    // Given: constants 모듈
    // When: 모듈 import
    // Then: 모듈이 정의됨
    expect(constants).toBeDefined();
  });

  it('검색 랭킹 관련 상수 정의', () => {
    // Given: constants 모듈
    // When: 검색 랭킹 상수 조회
    // Then: 상수가 정의됨
    expect(constants.SEARCH_RANKING).toBeDefined();
    expect(constants.SEARCH_RANKING.DEFAULT_WEIGHTS).toBeDefined();
  });

  it('벡터 검색 관련 상수 정의', () => {
    // Given: constants 모듈
    // When: 벡터 검색 상수 조회
    // Then: 상수가 정의됨
    expect(constants.VECTOR_SEARCH).toBeDefined();
  });

  it('하이브리드 검색 관련 상수 정의', () => {
    // Given: constants 모듈
    // When: 하이브리드 검색 상수 조회
    // Then: 상수가 정의됨
    expect(constants.HYBRID_SEARCH).toBeDefined();
  });
});

