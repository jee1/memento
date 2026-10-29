import type { IRetryManager } from '../../interfaces/retry-manager.interface.js';
import { logger } from '../../utils/logger.js';
import type { ChatLlmPort, ChatLlmRequest, ChatLlmResult } from './chat-llm-port.js';
import { retryChatLlmCall } from './chat-llm-retry.js';
import {
  buildOllamaErrorLogContext,
  checkOllamaModel,
  parseOllamaChatResponsePayload,
} from './ollama-chat-llm-support.js';

const REQUEST_TIMEOUT_MS = 60_000;

export class OllamaChatLlm implements ChatLlmPort {
  readonly provider = 'ollama' as const;

  constructor(
    private readonly baseUrl: string,
    private readonly retryManager: IRetryManager,
  ) {}

  async complete(request: ChatLlmRequest): Promise<ChatLlmResult> {
    const requestBody = {
      model: request.model,
      messages: request.messages.map((message) => ({ role: message.role, content: message.content })),
      options: {
        temperature: request.temperature,
        num_predict: request.maxOutputTokens,
      },
      ...(request.json ? { format: 'json' as const } : {}),
    };
    const apiUrl = `${this.baseUrl}/api/chat`;

    try {
      const modelExists = await checkOllamaModel(this.retryManager, this.baseUrl, request.model);
      if (!modelExists) {
        throw new Error(
          `Ollama 모델 '${request.model}'이 설치되지 않았습니다. ` +
            `다음 명령어로 모델을 설치하세요: ollama pull ${request.model}`
        );
      }

      let response: Response;
      try {
        response = await retryChatLlmCall(
          this.retryManager,
          { provider: this.provider, model: request.model, transient: 'local' },
          () =>
            fetch(apiUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(requestBody),
              signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            }),
        );
      } catch (fetchError) {
        logger.error('Ollama API fetch 실패', {
          error: fetchError instanceof Error ? fetchError.message : String(fetchError),
          url: apiUrl,
          baseUrl: this.baseUrl,
          model: request.model,
          ...buildOllamaErrorLogContext(requestBody),
        });
        throw fetchError;
      }

      if (!response.ok) {
        throw new Error(await this.describeHttpFailure(response, apiUrl, request.model));
      }

      const contentType = response.headers.get('content-type') || '';
      const headerRecord = Object.fromEntries(response.headers.entries());

      let responseText = '';
      let data: Record<string, unknown>;
      let content = '';
      try {
        responseText = await response.text();
        const parsed = parseOllamaChatResponsePayload(responseText, contentType, {
          status: response.status,
          statusText: response.statusText,
          headers: headerRecord,
        });
        data = parsed.data;
        content = parsed.content;
      } catch (textError) {
        logger.error('Ollama API 응답 본문 읽기 실패', {
          textError: textError instanceof Error ? textError.message : String(textError),
          status: response.status,
          statusText: response.statusText,
          headers: headerRecord,
          contentType,
          responseTextLength: responseText.length,
          responseTextPreview: responseText.substring(0, 500),
          responseTextFull: responseText,
        });
        throw textError;
      }

      if (!content) {
        logger.error('Ollama 응답이 비어있습니다', {
          status: response.status,
          statusText: response.statusText,
          headers: headerRecord,
          contentType,
          responseTextLength: responseText.length,
          responseTextPreview: responseText.substring(0, 500),
          responseTextFull: responseText,
          fullResponse: data,
        });
        throw new Error('Ollama 응답이 비어있습니다.');
      }

      return {
        content,
        usage: {
          promptTokens: typeof data.prompt_eval_count === 'number' ? data.prompt_eval_count : 0,
          completionTokens: typeof data.eval_count === 'number' ? data.eval_count : 0,
        },
      };
    } catch (error) {
      logger.error('Ollama 호출 실패', {
        error: error instanceof Error ? error.message : String(error),
        baseUrl: this.baseUrl,
        model: request.model,
        ...buildOllamaErrorLogContext(requestBody),
      });
      throw error;
    }
  }

  private async describeHttpFailure(response: Response, apiUrl: string, model: string): Promise<string> {
    let errorText = '';
    try {
      errorText = await response.text();
      logger.error('Ollama API 에러 응답', {
        status: response.status,
        statusText: response.statusText,
        errorText,
        url: apiUrl,
      });
    } catch (textError) {
      logger.error('Ollama API 에러 응답 텍스트 읽기 실패', {
        status: response.status,
        statusText: response.statusText,
        textError: textError instanceof Error ? textError.message : String(textError),
      });
    }

    if (response.status === 404) {
      return `Ollama 모델 '${model}'을 찾을 수 없습니다. 모델이 설치되어 있는지 확인하세요: ollama pull ${model}`;
    }
    if (!errorText) {
      return `Ollama API 호출 실패: ${response.status} ${response.statusText}`;
    }
    try {
      const errorData = JSON.parse(errorText) as { error?: string };
      return errorData.error || `Ollama API 호출 실패: ${response.status} ${response.statusText}`;
    } catch {
      return errorText;
    }
  }
}
