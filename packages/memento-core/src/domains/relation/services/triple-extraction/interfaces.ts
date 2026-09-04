/**
 * Triple 추출 서비스를 위한 인터페이스 정의
 * 단일 책임 원칙을 준수하여 TripleExtractionService를 분리하기 위한 인터페이스들
 */

import type {
  NormalizeWithReportResult,
  Triple,
  TripleExtractionOptions,
} from '../../../../shared/types/triple-extraction.js';

export type {
  NormalizeWithReportResult,
  PredicateSkip,
  PredicateSkipReason,
} from '../../../../shared/types/triple-extraction.js';

/**
 * Triple 추출기 인터페이스
 * LLM을 사용하여 텍스트에서 Triple을 추출합니다.
 * 
 * Given: 텍스트와 추출 옵션이 제공됨
 * When: LLM을 사용하여 Triple을 추출함
 * Then: 추출된 Triple 배열을 반환함
 */
export interface ITripleExtractor {
  /**
   * Given: 텍스트와 추출 옵션이 제공됨
   * When: LLM을 사용하여 Triple을 추출함
   * Then: 추출된 Triple 배열을 반환함
   * 
   * @param text - 추출할 텍스트
   * @param options - 추출 옵션
   * @returns 추출된 Triple 배열과 메타데이터
   */
  extract(text: string, options?: TripleExtractionOptions): Promise<{
    triples: Triple[];
    rawResponse: string;
    provider: 'openai' | 'gemini' | 'ollama';
  }>;
}

/**
 * Triple 파서 인터페이스
 * LLM 응답을 파싱하여 Triple 배열을 추출합니다.
 * 
 * Given: LLM 응답 텍스트가 제공됨
 * When: 응답을 파싱하여 Triple 배열을 추출함
 * Then: 파싱된 Triple 배열과 파싱 결과를 반환함
 */
export interface ITripleParser {
  /**
   * Given: LLM 응답 텍스트가 제공됨
   * When: 응답을 파싱하여 Triple 배열을 추출함
   * Then: 파싱된 Triple 배열과 파싱 결과를 반환함
   * 
   * @param responseText - LLM 원본 응답 텍스트
   * @returns 파싱 결과 (success, triples, error)
   */
  parse(responseText: string): {
    success: boolean;
    triples: Triple[];
    error?: string;
    errorType?: 'parse' | 'structure' | 'no_triple';
  };

  /**
   * Given: 텍스트가 제공됨
   * When: JSON 부분을 추출함
   * Then: 추출된 JSON 문자열을 반환함
   * 
   * @param text - JSON이 포함된 텍스트
   * @returns 추출된 JSON 문자열 또는 null
   */
  extractJSON(text: string): string | null;

  /**
   * Given: Triple 객체가 제공됨
   * When: Triple의 유효성을 검증함
   * Then: 유효성 검증 결과를 반환함
   * 
   * @param triple - 검증할 Triple 객체
   * @returns 유효성 검증 결과
   */
  isValidTriple(triple: unknown): boolean;
}

/**
 * Triple 정규화기 인터페이스
 * 추출된 Triple을 정규화하여 일관성을 확보합니다.
 *
 * #813: canonicalize 실패 원본 pass-through 금지. accepted만 반환하며
 * skip reason은 normalizeWithReport로 관측한다.
 *
 * OOV 예외: 공백 없는 한글 종결 단일 토큰 + buildTripleSentence 성공 시에만 원본 수용.
 */
export interface ITripleNormalizer {
  /**
   * Given: Triple 배열이 제공됨
   * When: Triple의 엔티티와 predicate를 정규화·게이트함
   * Then: 게이트를 통과한(accepted) Triple 배열만 반환함
   *
   * @param triples - 정규화할 Triple 배열
   * @returns accepted Triple 배열 (skips 제외)
   */
  normalize(triples: Triple[]): Triple[];

  /**
   * Given: Triple 배열이 제공됨
   * When: predicate 게이트 + 엔티티 정규화를 수행함
   * Then: accepted triples와 PredicateSkip[]를 함께 반환함
   */
  normalizeWithReport(triples: Triple[]): NormalizeWithReportResult;
}
