/**
 * Triple 파서 클래스
 * LLM 응답을 파싱하여 Triple 배열을 추출합니다.
 * 
 * Given: LLM 응답 텍스트가 제공됨
 * When: 응답을 파싱하여 Triple 배열을 추출함
 * Then: 파싱된 Triple 배열과 파싱 결과를 반환함
 */

import type { ITripleParser } from './interfaces.js';
import type { Triple } from '../../shared/types/triple-extraction.js';

/**
 * Triple 파서 클래스
 * LLM 응답을 파싱하여 Triple 배열을 추출합니다.
 */
export class TripleParser implements ITripleParser {
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
  } {
    try {
      // JSON 추출 (마크다운 코드 블록 제거)
      let jsonText = this.extractJSON(responseText);
      if (!jsonText) {
        jsonText = responseText.trim();
      }

      // JSON 파싱
      const parsed = JSON.parse(jsonText);

      // triples 배열 추출
      if (!parsed.triples || !Array.isArray(parsed.triples)) {
        return {
          success: false,
          triples: [],
          error: 'triples 배열이 없거나 유효하지 않습니다.',
          errorType: 'parse'
        };
      }

      // Triple 유효성 검증
      const validTriples: Triple[] = [];
      
      for (const triple of parsed.triples) {
        if (this.isValidTriple(triple)) {
          validTriples.push({
            subject: String(triple.subject).trim(),
            predicate: String(triple.predicate).trim(),
            object: String(triple.object).trim()
          });
        }
      }

      // 모든 triple이 유효하지 않은 경우
      if (validTriples.length === 0 && parsed.triples.length > 0) {
        return {
          success: false,
          triples: [],
          error: '모든 triple이 유효하지 않습니다.',
          errorType: 'no_triple'
        };
      }

      // 일부 triple만 유효한 경우 (유효한 것만 반환, ambiguous_structure는 별도 감지)
      // 대부분이 유효하지 않으면 ambiguous_structure로 분류
      const invalidRatio = (parsed.triples.length - validTriples.length) / parsed.triples.length;
      if (invalidRatio > 0.5 && parsed.triples.length > 1) {
        // 유효한 triple은 반환하되, 구조가 모호함을 표시
        return {
          success: true,
          triples: validTriples,
          error: `일부 triple이 유효하지 않습니다. (유효: ${validTriples.length}/${parsed.triples.length})`,
          errorType: 'structure'
        };
      }

      return {
        success: true,
        triples: validTriples
      };
    } catch (error) {
      return {
        success: false,
        triples: [],
        error: error instanceof Error ? error.message : 'JSON 파싱 실패',
        errorType: 'parse'
      };
    }
  }

  /**
   * Given: 텍스트가 제공됨
   * When: JSON 부분을 추출함
   * Then: 추출된 JSON 문자열을 반환함
   * 
   * @param text - JSON이 포함된 텍스트
   * @returns 추출된 JSON 문자열 또는 null
   */
  extractJSON(text: string): string | null {
    if (!text || typeof text !== 'string') {
      return null;
    }

    let jsonText = text.trim();

    // 마크다운 코드 블록 제거
    if (jsonText.startsWith('```json')) {
      jsonText = jsonText.replace(/^```json\s*/, '').replace(/\s*```.*$/s, '');
    } else if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/^```\s*/, '').replace(/\s*```.*$/s, '');
    }

    // 첫 번째 '{'부터 마지막 '}'까지 추출
    const firstBrace = jsonText.indexOf('{');
    const lastBrace = jsonText.lastIndexOf('}');

    if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
      return null;
    }

    return jsonText.substring(firstBrace, lastBrace + 1).trim();
  }

  /**
   * Given: Triple 객체가 제공됨
   * When: Triple의 유효성을 검증함
   * Then: 유효성 검증 결과를 반환함
   * 
   * @param triple - 검증할 Triple 객체
   * @returns 유효성 검증 결과
   */
  isValidTriple(triple: any): boolean {
    if (!triple || typeof triple !== 'object') {
      return false;
    }
    
    return (
      typeof triple.subject === 'string' &&
      typeof triple.predicate === 'string' &&
      typeof triple.object === 'string' &&
      triple.subject.trim().length > 0 &&
      triple.predicate.trim().length > 0 &&
      triple.object.trim().length > 0
    );
  }
}
