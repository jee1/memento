import type { IRetryManager } from '../../../../shared/interfaces/retry-manager.interface.js';
import { getRetryOptions } from '../../../../shared/config/retry-options-loader.js';
import { logger } from '../../../../shared/utils/logger.js';

export async function checkOllamaModel(
  retryManager: IRetryManager,
  baseUrl: string,
  model: string
): Promise<boolean> {
    try {
      const retryOptions = getRetryOptions();
      const response = await retryManager.retry(
        async () => {
          return await fetch(`${baseUrl}/api/tags`, {
            method: 'GET',
            signal: AbortSignal.timeout(3000)
          });
        },
        {
          maxAttempts: retryOptions.external_api.maxAttempts,
          baseDelay: retryOptions.external_api.baseDelay,
          shouldRetry: (error: Error) => {
            const message = error.message.toLowerCase();
            return message.includes('network') || 
                   message.includes('timeout') || 
                   message.includes('fetch failed');
          }
        }
      );

      if (!response.ok) {
        return false;
      }

      const data = (await response.json()) as { models?: Array<{ name?: string }> };
      const models = data.models || [];
      return models.some(
        (m: { name?: string }) => m.name === model || (m.name?.startsWith(`${model}:`) ?? false)
      );
    } catch (error) {
      logger.warn('Ollama 모델 확인 실패', { 
        error: error instanceof Error ? error.message : String(error),
        baseUrl,
        model
      });
      return false;
    }
  }

export function buildOllamaErrorLogContext(
    requestBody: {
      model: string;
      messages: Array<{ role: string; content: string }>;
      options: { temperature: number; num_predict: number };
      format: 'json';
    },
    prompt: string
  ): Record<string, unknown> {
    return {
      requestBody: {
        ...requestBody,
        messages: requestBody.messages.map(msg => ({
          role: msg.role,
          contentLength: msg.content.length,
          contentPreview: msg.content.substring(0, 500),
          contentFull:
            msg.content.length < 2000
              ? msg.content
              : msg.content.substring(0, 1000) + '...' + msg.content.substring(msg.content.length - 1000)
        }))
      },
      promptLength: prompt.length,
      promptPreview: prompt.substring(0, 500),
      promptFull:
        prompt.length < 2000 ? prompt : prompt.substring(0, 1000) + '...' + prompt.substring(prompt.length - 1000)
    };
  }

export function parseOllamaChatResponsePayload(
    responseText: string,
    contentType: string,
    http: { status: number; statusText: string; headers: Record<string, string> }
  ): { content: string; data: Record<string, unknown> } {
    const isNDJSON =
      contentType.includes('application/x-ndjson') || contentType.includes('ndjson');

    if (isNDJSON) {
      const lines = responseText.trim().split('\n').filter((line): line is string => line.trim().length > 0);
      const contentParts: string[] = [];
      let lastData: Record<string, unknown> | null = null;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line) continue;
        try {
          const lineData = JSON.parse(line) as Record<string, unknown>;
          lastData = lineData;
          const message = lineData.message;
          if (message && typeof message === 'object' && message !== null && 'content' in message) {
            const c = (message as { content?: unknown }).content;
            if (typeof c === 'string' && c.length > 0) {
              contentParts.push(c);
            }
          }
          if (lineData.done === true) {
            break;
          }
        } catch (lineParseError) {
          logger.warn('Ollama NDJSON 라인 파싱 실패', {
            lineIndex: i,
            linePreview: line.substring(0, 200),
            error: lineParseError instanceof Error ? lineParseError.message : String(lineParseError),
            responseTextLength: responseText.length,
            responseTextPreview: responseText.substring(0, 500),
            responseTextFull: responseText
          });
        }
      }

      const content = contentParts.join('');
      const data: Record<string, unknown> = lastData ?? {};
      if (data.message && typeof data.message === 'object' && data.message !== null) {
        (data.message as { content: string }).content = content;
      } else {
        data.message = { role: 'assistant', content };
      }
      return { content, data };
    }

    try {
      const data = JSON.parse(responseText) as Record<string, unknown>;
      const message = data.message;
      let content = '';
      if (message && typeof message === 'object' && message !== null && 'content' in message) {
        const c = (message as { content?: unknown }).content;
        content = typeof c === 'string' ? c : '';
      }
      return { content, data };
    } catch (parseError) {
      logger.error('Ollama API 응답 JSON 파싱 실패', {
        parseError: parseError instanceof Error ? parseError.message : String(parseError),
        contentType,
        isNDJSON,
        responseTextLength: responseText.length,
        responseTextPreview: responseText.substring(0, 500),
        responseTextFull: responseText,
        status: http.status,
        statusText: http.statusText,
        headers: http.headers
      });
      throw new Error(
        `Ollama 응답 JSON 파싱 실패: ${parseError instanceof Error ? parseError.message : String(parseError)}`
      );
    }
  }
