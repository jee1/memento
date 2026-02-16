/**
 * Agent 설정
 * 하는 일: MEMENTO_BASE_URL, AGENT_PORT, LLM/검색 관련 환경 변수 로드
 * 주의: Core import 금지. 연관: mementoClient, server.ts
 */

import { config as loadEnv } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// services/agent/.env 로드 (CLI/서버 공통, 실행 CWD와 무관하게 패키지 루트 기준)
const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(__dirname, '..', '.env') });

function normalizeBaseUrl(url: string): string {
  const u = url.trim().replace(/\/$/, '');
  if (/^https?:\/\//i.test(u)) return u;
  return `http://${u}`;
}

export const config = {
  mementoBaseUrl: normalizeBaseUrl(process.env.MEMENTO_BASE_URL ?? 'http://localhost:9001'),
  agentPort: parseInt(process.env.AGENT_PORT ?? '3001', 10),
  llmProvider: (process.env.AGENT_LLM_PROVIDER ?? 'ollama') as 'openai' | 'gemini' | 'ollama',
  openaiApiKey: process.env.OPENAI_API_KEY ?? '',
  geminiApiKey: process.env.GEMINI_API_KEY ?? '',
  ollamaBaseUrl: process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434',
  ollamaModel: process.env.AGENT_OLLAMA_MODEL ?? 'llama2'
};
