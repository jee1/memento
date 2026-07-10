import type OpenAI from 'openai';
import type { GoogleGenAI } from '@google/genai';

/**
 * LLM 클라이언트 초기화 결과
 */
export interface LLMClientInitializationResult {
  /** 선택된 provider (null이면 사용 가능한 provider 없음) */
  preferredProvider: 'openai' | 'gemini' | 'ollama' | null;
  /** OpenAI 클라이언트 인스턴스 (초기화 실패 시 null) */
  openaiClient: OpenAI | null;
  /** Gemini 클라이언트 인스턴스 (초기화 실패 시 null) */
  geminiClient: GoogleGenAI | null;
  /** 성공적으로 초기화된 provider 목록 */
  initializedProviders: ('openai' | 'gemini' | 'ollama')[];
  /** 초기화 과정에서 발생한 경고 메시지 목록 */
  warnings: string[];
}
