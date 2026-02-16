/**
 * LLM 클라이언트 (Agent 전용)
 * 하는 일: chat, summarize. Provider 추상화(OpenAI/Gemini/Ollama).
 * 주의: Core LLM 설정과 독립. 연관: config, actionableLoop
 */

import { GoogleGenAI } from '@google/genai';
import { config } from '../config.js';

export interface LLMProvider {
  chat(message: string, context: { injectionText: string }): Promise<string>;
  summarize(content: string): Promise<string>;
}

/** Ollama 로컬 — 기본값 */
async function ollamaChat(message: string, context: { injectionText: string }): Promise<string> {
  const url = `${config.ollamaBaseUrl.replace(/\/$/, '')}/api/generate`;
  const prompt = context.injectionText
    ? `다음 관련 맥락:\n${context.injectionText}\n\n사용자: ${message}\n\n응답:`
    : `사용자: ${message}\n\n응답:`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.ollamaModel,
      prompt,
      stream: false
    })
  });
  if (!res.ok) throw new Error(`Ollama failed: ${res.status}`);
  const data = (await res.json()) as { response?: string };
  return (data.response ?? '').trim();
}

async function ollamaSummarize(content: string): Promise<string> {
  const url = `${config.ollamaBaseUrl.replace(/\/$/, '')}/api/generate`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.ollamaModel,
      prompt: `다음 내용을 2~3문장으로 요약해주세요:\n\n${content}\n\n요약:`,
      stream: false
    })
  });
  if (!res.ok) throw new Error(`Ollama summarize failed: ${res.status}`);
  const data = (await res.json()) as { response?: string };
  return (data.response ?? content.slice(0, 300)).trim();
}

/** OpenAI */
async function openaiChat(message: string, context: { injectionText: string }): Promise<string> {
  const sys = context.injectionText
    ? `관련 맥락:\n${context.injectionText}`
    : 'You are a helpful assistant.';
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.openaiApiKey}`
    },
    body: JSON.stringify({
      model: 'gpt-3.5-turbo',
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: message }
      ]
    })
  });
  if (!res.ok) throw new Error(`OpenAI failed: ${res.status}`);
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content ?? '';
  return content.trim();
}

async function openaiSummarize(content: string): Promise<string> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.openaiApiKey}`
    },
    body: JSON.stringify({
      model: 'gpt-3.5-turbo',
      messages: [
        { role: 'user', content: `다음 내용을 2~3문장으로 요약:\n\n${content}` }
      ]
    })
  });
  if (!res.ok) throw new Error(`OpenAI summarize failed: ${res.status}`);
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return (data.choices?.[0]?.message?.content ?? content.slice(0, 300)).trim();
}

/** Gemini (GoogleGenAI 사용) */
let geminiClient: GoogleGenAI | null = null;

function getGeminiClient(): GoogleGenAI {
  if (!geminiClient) {
    if (!config.geminiApiKey) {
      throw new Error('GEMINI_API_KEY가 설정되지 않았습니다.');
    }
    geminiClient = new GoogleGenAI({ apiKey: config.geminiApiKey });
  }
  return geminiClient;
}

async function geminiChat(message: string, context: { injectionText: string }): Promise<string> {
  const prompt = context.injectionText
    ? `맥락:\n${context.injectionText}\n\n질문: ${message}`
    : message;
  
  try {
    const client = getGeminiClient();
    const response = await client.models.generateContent({
      model: 'gemini-pro',
      contents: prompt
    });
    
    const text = response.text ?? '';
    return text.trim();
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    throw new Error(`Gemini chat failed: ${errorMsg}`);
  }
}

async function geminiSummarize(content: string): Promise<string> {
  const prompt = `요약해주세요 (2~3문장):\n\n${content}`;
  
  try {
    const client = getGeminiClient();
    const response = await client.models.generateContent({
      model: 'gemini-pro',
      contents: prompt
    });
    
    const text = response.text ?? '';
    return text.trim() || content.slice(0, 300);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    throw new Error(`Gemini summarize failed: ${errorMsg}`);
  }
}

export function getLLMProvider(): LLMProvider {
  switch (config.llmProvider) {
    case 'openai':
      return { chat: openaiChat, summarize: openaiSummarize };
    case 'gemini':
      return { chat: geminiChat, summarize: geminiSummarize };
    default:
      return { chat: ollamaChat, summarize: ollamaSummarize };
  }
}
