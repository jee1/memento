/**
 * Agent 설정
 * 하는 일: MEMENTO_BASE_URL, AGENT_PORT, LLM/검색 관련 환경 변수 로드
 * 주의: Core import 금지. 연관: mementoClient, server.ts
 */

export const config = {
  mementoBaseUrl: process.env.MEMENTO_BASE_URL ?? 'http://localhost:9001',
  agentPort: parseInt(process.env.AGENT_PORT ?? '3001', 10),
  llmProvider: (process.env.AGENT_LLM_PROVIDER ?? 'ollama') as 'openai' | 'gemini' | 'ollama',
  openaiApiKey: process.env.OPENAI_API_KEY ?? '',
  geminiApiKey: process.env.GEMINI_API_KEY ?? '',
  ollamaBaseUrl: process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434'
};
