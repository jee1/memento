/**
 * Triple 추출용 LLM 프로바이더별 원시 텍스트 호출
 */

import type { GoogleGenAI } from '@google/genai';
import OpenAI from 'openai';
import type { IRetryManager } from '../../../../shared/interfaces/retry-manager.interface.js';
import { mementoConfig } from '../../../../shared/config/index.js';
import { resolveLlmModel } from '../../../../shared/config/llm-model-resolver.js';
import { getRetryOptions } from '../../../../shared/config/retry-options-loader.js';
import type { TripleExtractionOptions } from '../../../../shared/types/triple-extraction.js';
import { logger } from '../../../../shared/utils/logger.js';

export interface TripleLlmCallDeps {
  retryManager: IRetryManager;
  shouldRetry: (error: Error) => boolean;
  onTokenUsage: (
    provider: 'openai' | 'gemini' | 'ollama',
    promptTokens: number,
    completionTokens: number
  ) => void;
  defaultTemperature: number;
  defaultMaxTokens: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getStringField(obj: Record<string, unknown>, key: string): string | undefined {
  const v = obj[key];
  return typeof v === 'string' ? v : undefined;
}

export async function extractRawWithOpenAI(
  openaiClient: OpenAI,
  deps: TripleLlmCallDeps,
  prompt: string,
  options: TripleExtractionOptions
): Promise<string> {
  const model = resolveLlmModel('openai', 'triple_extraction');
  const temperature = options.temperature ?? deps.defaultTemperature;
  const maxTokens = options.maxTokens ?? deps.defaultMaxTokens;

  const retryOptions = getRetryOptions();
  const response = await deps.retryManager.retry(
    async () => {
      return await openaiClient.chat.completions.create({
        model,
        messages: [
          {
            role: 'system',
            content:
              'You are a knowledge graph extractor. Extract triples (subject, predicate, object) from observations and return JSON format only.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature,
        max_tokens: maxTokens,
        response_format: { type: 'json_object' },
      });
    },
    {
      maxAttempts: retryOptions.external_api.maxAttempts,
      baseDelay: retryOptions.external_api.baseDelay,
      shouldRetry: (error: Error) => deps.shouldRetry(error),
      onRetry: (error: Error, attempt: number, delay: number) => {
        logger.warn('TripleExtractionService: OpenAI API 호출 재시도', {
          attempt,
          delay,
          error: error.message,
          model,
        });
      },
    }
  );

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error('OpenAI 응답이 비어있습니다.');
  }

  const promptTokens = response.usage?.prompt_tokens || 0;
  const completionTokens = response.usage?.completion_tokens || 0;
  deps.onTokenUsage('openai', promptTokens, completionTokens);

  return content;
}

export async function extractRawWithGemini(
  geminiClient: GoogleGenAI,
  deps: TripleLlmCallDeps,
  prompt: string,
  options: TripleExtractionOptions
): Promise<string> {
  const modelName = resolveLlmModel('gemini', 'triple_extraction');
  const temperature = options.temperature ?? deps.defaultTemperature;
  const maxTokens = options.maxTokens ?? deps.defaultMaxTokens;

  const retryOptions = getRetryOptions();
  const result = await deps.retryManager.retry(
    async () => {
      return await geminiClient.models.generateContent({
        model: modelName,
        contents: [
          {
            role: 'user',
            parts: [{ text: prompt }],
          },
        ],
        config: {
          temperature,
          maxOutputTokens: maxTokens,
          responseMimeType: 'application/json',
        },
      });
    },
    {
      maxAttempts: retryOptions.external_api.maxAttempts,
      baseDelay: retryOptions.external_api.baseDelay,
      shouldRetry: (error: Error) => deps.shouldRetry(error),
      onRetry: (error: Error, attempt: number, delay: number) => {
        logger.warn('TripleExtractionService: Gemini API 호출 재시도', {
          attempt,
          delay,
          error: error.message,
          model: modelName,
        });
      },
    }
  );

  const text = result.text;
  if (!text) {
    throw new Error('Gemini 응답이 비어있습니다.');
  }

  const estimatedPromptTokens = Math.ceil(prompt.length / 4);
  const estimatedCompletionTokens = Math.ceil(text.length / 4);
  deps.onTokenUsage('gemini', estimatedPromptTokens, estimatedCompletionTokens);

  return text;
}

export async function extractRawWithOllama(
  deps: TripleLlmCallDeps,
  prompt: string,
  options: TripleExtractionOptions
): Promise<string> {
  const baseUrl = mementoConfig.ollamaBaseUrl || 'http://localhost:11434';
  const model = resolveLlmModel('ollama', 'triple_extraction');
  const temperature = options.temperature ?? deps.defaultTemperature;
  const maxTokens = options.maxTokens ?? deps.defaultMaxTokens;

  const requestBody = {
    model,
    messages: [
      {
        role: 'system',
        content:
          'You are a knowledge graph extractor. Extract triples (subject, predicate, object) from observations and return JSON format only.',
      },
      {
        role: 'user',
        content: prompt,
      },
    ],
    options: {
      temperature,
      num_predict: maxTokens,
    },
    format: 'json' as const,
  };

  const modelExists = await checkOllamaModelInstalled(baseUrl, model);
  if (!modelExists) {
    throw new Error(
      `Ollama 모델 '${model}'이 설치되지 않았습니다. ` +
        `다음 명령어로 모델을 설치하세요: ollama pull ${model}`
    );
  }

  const retryOptions = getRetryOptions();
  const apiUrl = `${baseUrl}/api/chat`;
  const response = await deps.retryManager.retry(
    async () => {
      const fetchResponse = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(60000),
      });

      if (!fetchResponse.ok) {
        const errorText = await fetchResponse.text().catch(() => '');
        throw new Error(
          `Ollama API 호출 실패: ${fetchResponse.status} ${fetchResponse.statusText}${errorText ? ` - ${errorText}` : ''}`
        );
      }

      return fetchResponse;
    },
    {
      maxAttempts: retryOptions.external_api.maxAttempts,
      baseDelay: retryOptions.external_api.baseDelay,
      shouldRetry: (error: Error) => deps.shouldRetry(error),
      onRetry: (error: Error, attempt: number, delay: number) => {
        logger.warn('TripleExtractionService: Ollama API 호출 재시도', {
          attempt,
          delay,
          error: error.message,
          baseUrl,
          model,
        });
      },
    }
  );

  const contentType = response.headers.get('content-type') || '';
  const isNDJSON =
    contentType.includes('application/x-ndjson') || contentType.includes('ndjson');

  let content = '';
  const responseText = await response.text();

  if (isNDJSON) {
    const lines = responseText.trim().split('\n').filter((line) => line.trim().length > 0);
    const contentParts: string[] = [];

    for (const line of lines) {
      try {
        const lineData: unknown = JSON.parse(line);
        if (!isRecord(lineData)) {
          continue;
        }
        const message = lineData.message;
        const piece = isRecord(message) ? getStringField(message, 'content') : undefined;
        if (piece) {
          contentParts.push(piece);
        }
        if (lineData.done === true) {
          break;
        }
      } catch {
        // 라인 파싱 실패 시 무시
      }
    }
    content = contentParts.join('');
  } else {
    const data: unknown = JSON.parse(responseText);
    if (isRecord(data)) {
      const message = data.message;
      if (isRecord(message)) {
        content = getStringField(message, 'content') || '';
      }
    }
  }

  if (!content) {
    throw new Error('Ollama 응답이 비어있습니다.');
  }

  const estimatedPromptTokens = Math.ceil(prompt.length / 4);
  const estimatedCompletionTokens = Math.ceil(content.length / 4);
  deps.onTokenUsage('ollama', estimatedPromptTokens, estimatedCompletionTokens);

  return content;
}

export async function checkOllamaModelInstalled(baseUrl: string, model: string): Promise<boolean> {
  try {
    const response = await fetch(`${baseUrl}/api/tags`, {
      method: 'GET',
      signal: AbortSignal.timeout(3000),
    });

    if (!response.ok) {
      return false;
    }

    const data: unknown = await response.json();
    if (!isRecord(data)) {
      return false;
    }
    const modelsRaw = data.models;
    const models = Array.isArray(modelsRaw) ? modelsRaw : [];

    return models.some((entry) => {
      const name = isRecord(entry) ? getStringField(entry, 'name') : undefined;
      return name !== undefined && (name === model || name.startsWith(`${model}:`));
    });
  } catch {
    return false;
  }
}
