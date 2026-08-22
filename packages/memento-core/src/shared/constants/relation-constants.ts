/**
 * 관계 추출 엔진 관련 상수
 * 매직 넘버를 상수로 추출하여 유지보수성을 향상시킵니다.
 */
import { DAY_MS } from '../utils/date.js';

/**
 * 신뢰도 관련 상수
 */
export const CONFIDENCE = {
  /** 기본 신뢰도 (관계 추가 시 기본값) */
  DEFAULT: 0.7,
  /** 최소 신뢰도 (규칙 기반 추출 기본값) */
  MIN_RULE_BASED: 0.5,
  /** 최소 신뢰도 (LLM 기반 추출 기본값) */
  MIN_LLM_BASED: 0.6,
  /** 최대 신뢰도 (규칙 기반 추출 최대값) */
  MAX_RULE_BASED: 0.8,
  /** 최소 신뢰도 (규칙 기반 패턴 매칭 최소값) */
  MIN_PATTERN_MATCH: 0.5,
  /** 최대 신뢰도 (규칙 기반 패턴 매칭 최대값) */
  MAX_PATTERN_MATCH: 0.8
} as const;

/**
 * 제한값 관련 상수
 */
export const LIMITS = {
  /** LLM 후보 제한 (기본값) */
  LLM_CANDIDATE_DEFAULT: 30,
  /** 규칙 기반 후보 제한 (기본값) */
  RULE_CANDIDATE_DEFAULT: 50,
  /** 배치 처리 크기 (기본값) */
  BATCH_SIZE_DEFAULT: 10,
  /** 최대 배치 크기 */
  MAX_BATCH_SIZE: 1000,
  /** 순환 참조 감지 최대 깊이 (기본값) */
  MAX_CYCLE_DEPTH: 10,
  /** LLM 프롬프트 최대 토큰 수 */
  MAX_PROMPT_TOKENS: 500,
  /** LLM 응답 최대 토큰 수 */
  MAX_RESPONSE_TOKENS: 1000,
  /** 비용 로그 출력 주기 (호출 횟수) */
  COST_LOG_INTERVAL: 100
} as const;

/**
 * 캐시 관련 상수
 */
export const CACHE = {
  /** L1 캐시 크기 (항목 수) */
  L1_SIZE: 1000,
  /** L2 캐시 크기 (항목 수) */
  L2_SIZE: 5000,
  /** L1 캐시 TTL (밀리초) - 10분 */
  L1_TTL_MS: 10 * 60 * 1000,
  /** L2 캐시 TTL (밀리초) - 7일 */
  L2_TTL_MS: 7 * DAY_MS,
  /** 관계 추출 캐시 크기 (항목 수) */
  EXTRACTION_SIZE: 1000,
  /** 관계 추출 캐시 TTL (밀리초) - 7일 */
  EXTRACTION_TTL_MS: 7 * DAY_MS
} as const;

/**
 * LLM 비용 관련 상수 (USD per 1K tokens)
 */
export const LLM_COST = {
  /** OpenAI 입력 비용 (gpt-4o-mini) */
  OPENAI_INPUT: 0.15,
  /** OpenAI 출력 비용 (gpt-4o-mini) */
  OPENAI_OUTPUT: 0.6,
  /** Gemini 입력 비용 (gemini-1.5-flash) */
  GEMINI_INPUT: 0.075,
  /** Gemini 출력 비용 (gemini-1.5-flash) */
  GEMINI_OUTPUT: 0.30
} as const;

/**
 * Rate Limiter 관련 상수
 */
export const RATE_LIMITER = {
  /** 토큰 버킷 용량 */
  CAPACITY: 1,
  /** 토큰 리필 속도 (초당 토큰 수) */
  REFILL_RATE: 1
} as const;

/**
 * 시간 관련 상수 (밀리초)
 */
export const TIME = {
  /** 1초 */
  SECOND_MS: 1000,
  /** 1분 */
  MINUTE_MS: 60 * 1000,
  /** 1시간 */
  HOUR_MS: 60 * 60 * 1000,
  /** 1일 */
  DAY_MS
} as const;
