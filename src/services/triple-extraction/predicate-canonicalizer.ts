/**
 * Predicate 정규화기 (Canonicalizer)
 * 동의어/유사 표현을 표준 predicate로 변환합니다.
 * 
 * AriGraph 논문을 참고하여 구현되었으며, 지식 그래프의 일관성을 보장합니다.
 */

import type { PredicateCanonicalizationResult } from '../../shared/types/triple-extraction.js';
import { logger } from '../../shared/utils/logger.js';

/**
 * Predicate 사전
 * 표준 predicate와 동의어 매핑
 * 
 * 구조:
 * - key: 표준 predicate (canonical form)
 * - value: 동의어 배열
 */
interface PredicateDictionary {
  [canonical: string]: string[];
}

/**
 * 기본 Predicate 사전
 * 
 * 한글 predicate 중심으로 구성되며, 향후 확장 가능합니다.
 */
const DEFAULT_PREDICATE_DICTIONARY: PredicateDictionary = {
  // 선호/좋아함 관련
  '좋아함': ['좋아한다', '선호한다', '선호함', '좋아함', '좋아함', '선호', 'like', 'prefer', 'favorite'],
  
  // 사용/활용 관련
  '사용함': ['사용한다', '사용함', '활용한다', '활용함', '쓰다', 'use', 'utilize'],
  
  // 생성/만들기 관련
  '생성함': ['만든다', '생성한다', '생성함', '만들다', 'create', 'generate', 'make'],
  
  // 삭제/제거 관련
  '삭제함': ['삭제한다', '삭제함', '제거한다', '제거함', '지운다', 'delete', 'remove'],
  
  // 업데이트/수정 관련
  '업데이트함': ['업데이트한다', '업데이트함', '수정한다', '수정함', '변경한다', '변경함', 'update', 'modify', 'change'],
  
  // 포함/포함함 관련
  '포함함': ['포함한다', '포함함', '들어있다', 'include', 'contain'],
  
  // 의존/의존함 관련
  '의존함': ['의존한다', '의존함', '따른다', 'depend', 'rely'],
  
  // 원인/원인함 관련
  '원인함': ['원인이다', '원인함', '일으킨다', 'cause', 'lead to'],
  
  // 참조/참조함 관련
  '참조함': ['참조한다', '참조함', '언급한다', '언급함', 'reference', 'refer', 'mention'],
  
  // 소유/소유함 관련
  '소유함': ['소유한다', '소유함', '가지고 있다', 'has', 'own', 'possess'],
  
  // 속함/속함 관련
  '속함': ['속한다', '속함', 'belong to', 'belongs to'],
  
  // 일치/일치함 관련
  '일치함': ['일치한다', '일치함', '같다', '동일하다', 'match', 'equal', 'same'],
  
  // 다름/다름 관련
  '다름': ['다르다', '다름', '다르다', 'different', 'differs'],
  
  // 연결/연결함 관련
  '연결함': ['연결한다', '연결함', '연결되어 있다', 'connect', 'link'],
  
  // 관련/관련함 관련
  '관련함': ['관련한다', '관련함', '연관된다', '연관됨', 'related', 'relate', 'associated'],
  
  // 필요/필요함 관련
  '필요함': ['필요하다', '필요함', '필수이다', 'required', 'need', 'necessary'],
  
  // 지원/지원함 관련
  '지원함': ['지원한다', '지원함', '지지한다', 'support', 'back'],
  
  // 반대/반대함 관련
  '반대함': ['반대한다', '반대함', 'oppose', 'against'],
  
  // 따라옴/따라옴 관련
  '따라옴': ['따라온다', '따라옴', 'follow', 'follows'],
  
  // 선행함/선행함 관련
  '선행함': ['선행한다', '선행함', 'precede', 'precedes', 'before'],
  
  // 후행함/후행함 관련
  '후행함': ['후행한다', '후행함', 'succeed', 'succeeds', 'after']
};

/**
 * Predicate 정규화기
 */
export class PredicateCanonicalizer {
  private dictionary: PredicateDictionary;
  private reverseIndex: Map<string, string> = new Map(); // 동의어 -> 표준 predicate 매핑

  constructor(customDictionary?: PredicateDictionary) {
    this.dictionary = customDictionary || DEFAULT_PREDICATE_DICTIONARY;
    this.buildReverseIndex();
  }

  /**
   * 역인덱스 구축 (동의어 -> 표준 predicate)
   */
  private buildReverseIndex(): void {
    this.reverseIndex = new Map<string, string>();
    
    for (const [canonical, synonyms] of Object.entries(this.dictionary)) {
      // 표준 predicate 자체도 매핑
      this.reverseIndex.set(this.normalizeKey(canonical), canonical);
      
      // 동의어들 매핑
      for (const synonym of synonyms) {
        this.reverseIndex.set(this.normalizeKey(synonym), canonical);
      }
    }
  }

  /**
   * 키 정규화 (검색용)
   * 대소문자 무시, 공백 제거
   */
  private normalizeKey(key: string): string {
    return key.toLowerCase().trim().replace(/\s+/g, '');
  }

  /**
   * Predicate 정규화
   * 
   * @param predicate 원본 predicate
   * @returns 정규화 결과
   */
  canonicalize(predicate: string): PredicateCanonicalizationResult {
    if (!predicate || typeof predicate !== 'string') {
      return {
        canonical: predicate || '',
        original: predicate || '',
        success: false
      };
    }

    const trimmed = predicate.trim();
    if (trimmed.length === 0) {
      return {
        canonical: '',
        original: predicate,
        success: false
      };
    }

    // 정규화된 키로 검색
    const normalizedKey = this.normalizeKey(trimmed);
    const canonical = this.reverseIndex.get(normalizedKey);

    if (canonical) {
      return {
        canonical,
        original: trimmed,
        success: true,
        synonym: canonical !== trimmed ? trimmed : undefined
      };
    }

    // 매칭되지 않은 경우 원본 반환 (정규화 실패)
    return {
      canonical: trimmed,
      original: trimmed,
      success: false
    };
  }

  /**
   * 여러 Predicate 일괄 정규화
   */
  canonicalizeBatch(predicates: string[]): PredicateCanonicalizationResult[] {
    return predicates.map(pred => this.canonicalize(pred));
  }

  /**
   * 사전에 Predicate 추가
   * 
   * @param canonical 표준 predicate
   * @param synonyms 동의어 배열
   */
  addPredicate(canonical: string, synonyms: string[]): void {
    if (!this.dictionary[canonical]) {
      this.dictionary[canonical] = [];
    }
    
    // 중복 제거 후 추가
    const existingSynonyms = new Set(this.dictionary[canonical]);
    for (const synonym of synonyms) {
      existingSynonyms.add(synonym);
    }
    this.dictionary[canonical] = Array.from(existingSynonyms);
    
    // 역인덱스 재구축
    this.buildReverseIndex();
  }

  /**
   * 사전 조회 (테스트/디버깅용)
   */
  getDictionary(): Readonly<PredicateDictionary> {
    return { ...this.dictionary };
  }

  /**
   * 표준 predicate 목록 조회
   */
  getCanonicalPredicates(): string[] {
    return Object.keys(this.dictionary);
  }
}

