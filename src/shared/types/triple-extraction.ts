/**
 * Triple 추출 관련 타입 정의
 * AriGraph 파이프라인에서 사용되는 타입들
 */

/**
 * Triple 구조 (subject, predicate, object)
 */
export interface Triple {
  subject: string;
  predicate: string;
  object: string;
}

/**
 * Triple 추출 실패 사유
 */
export type TripleExtractionFailureReason =
  | 'no_triple'           // 트리플이 추출되지 않음
  | 'ambiguous_structure' // 구조가 모호함
  | 'llm_parse_fail'      // LLM 응답 파싱 실패
  | 'llm_api_error';      // LLM API 호출 실패

/**
 * Triple 추출 단계별 성공 여부
 */
export interface ExtractionSteps {
  canonicalization: boolean; // Predicate 정규화 성공 여부
  entityLinking: boolean;     // Entity Linking 성공 여부
}

/**
 * Triple 추출 정보
 * 각 triple별로 독립적으로 저장됨
 */
export interface ExtractionInfo {
  failureReason?: TripleExtractionFailureReason; // 실패 시에만 존재
  steps: ExtractionSteps;
  rawLLMOutput?: string; // 디버깅용 (로그 파일에만 저장, DB에는 저장하지 않음)
}

/**
 * Triple 추출 결과
 */
export interface TripleExtractionResult {
  triples: Triple[];
  extractionInfo: ExtractionInfo;
}

/**
 * Triple 추출 옵션
 */
export interface TripleExtractionOptions {
  /**
   * LLM Provider 선택
   * 'auto'인 경우 사용 가능한 provider 자동 선택
   */
  provider?: 'openai' | 'gemini' | 'ollama' | 'auto';

  /**
   * Temperature 설정 (기본값: 0.3)
   */
  temperature?: number;

  /**
   * 최대 토큰 수 (기본값: 2000)
   */
  maxTokens?: number;

  /**
   * rawLLMOutput 저장 여부 (기본값: false)
   * true인 경우에도 로그 파일에만 저장 (DB에는 저장하지 않음)
   */
  includeRawOutput?: boolean;
}

/**
 * Predicate 정규화 결과
 */
export interface PredicateCanonicalizationResult {
  canonical: string;      // 정규화된 predicate
  original: string;       // 원본 predicate
  success: boolean;       // 정규화 성공 여부
  synonym?: string;       // 사용된 동의어 (있는 경우)
}

/**
 * Entity Linking 결과
 */
export interface EntityLinkingResult {
  linked: string;         // 정규화된 엔티티
  original: string;       // 원본 엔티티
  success: boolean;       // Linking 성공 여부
  normalized: boolean;    // 정규화 적용 여부 (숫자/날짜 등은 false)
}

/**
 * Triple 유효성 검증 결과
 */
export interface TripleValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Triple 추출 통계
 */
export interface TripleExtractionStats {
  totalAttempts: number;
  successfulExtractions: number;
  failedExtractions: number;
  failureReasons: Record<TripleExtractionFailureReason, number>;
  averageTriplesPerExtraction: number;
  averageExtractionTime: number; // milliseconds
}

