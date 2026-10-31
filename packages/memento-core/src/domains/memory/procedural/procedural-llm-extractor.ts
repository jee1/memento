/**
 * LLM 기반 Procedural Memory 추출기
 * Reflexion 결과를 LLM으로 구조화 추출하고, 실패 시 null을 반환하여 규칙 기반 fallback을 유도한다.
 */

import { logger } from '../../../shared/utils/logger.js';
import { mementoConfig } from '../../../shared/config/index.js';
import {
  resolveBoundLlmProvider,
  resolveLlmModel,
  resolveLlmProvider,
} from '../../../shared/config/llm-model-resolver.js';
import type { IProceduralMemoryExtractor, ExtractedProceduralMemory, ReflectionNotes } from './procedural-memory-extractor.types.js';
import type { FailureEvent } from '../../../shared/types/failure-event.js';
import { LLMClientInitializer } from '../../../shared/services/llm-client-initializer.js';
import { RetryManager } from '../../../shared/utils/retry-manager.js';
import type { RetryConfig } from '../../../shared/utils/retry-manager.js';
import { getRetryOptions } from '../../../shared/config/retry-options-loader.js';
import OpenAI from 'openai';
import { classifyLlmAttemptOutcome, coerceUsageField } from '../../../shared/services/llm-usage/llm-usage-classify.js';
import {
  recordLlmUsageAttempt,
  recordLlmUsageLogicalFinal,
} from '../../../shared/services/llm-usage/llm-usage-recorder.js';
import { runWithLlmUsageLogicalContext } from '../../../shared/services/llm-usage/llm-usage-logical-context.js';

type ConcreteLlmProvider = 'openai' | 'gemini' | 'ollama';

function pickProceduralProvider(
  requested: 'openai' | 'gemini' | 'ollama' | 'auto',
  availability: Record<ConcreteLlmProvider, boolean>
): ConcreteLlmProvider | null {
  const order: ConcreteLlmProvider[] =
    requested === 'auto'
      ? ['openai', 'gemini', 'ollama']
      : requested === 'openai'
        ? ['openai', 'gemini', 'ollama']
        : requested === 'gemini'
          ? ['gemini', 'openai', 'ollama']
          : ['ollama', 'openai', 'gemini'];
  return order.find((provider) => availability[provider]) ?? null;
}

const SYSTEM_PROMPT = `Reflexion 결과에서 절차적 기억(workflow, skill, steps, trigger_conditions)만 추출한다.
다른 설명 없이 아래 JSON 형태 한 개만 출력한다.
필드가 없으면 null 또는 빈 문자열을 사용한다.

예시: {"workflow_name":"...","skill_name":"...","steps":"[...]","trigger_conditions":"{...}","task_goal":"..."}`;

interface LlmProceduralExtractorOptions {
  /** 테스트용: 주입 시 실제 LLM 호출 없이 이 함수로 응답 대체 */
  completion?: (messages: Array<{ role: string; content: string }>) => Promise<string>;
}

/**
 * LLM을 사용해 reflection_notes에서 ExtractedProceduralMemory를 추출한다.
 * 파싱/네트워크 실패 시 null을 반환하여 호출자가 규칙 기반 fallback을 사용할 수 있게 한다.
 */
export class LlmProceduralExtractor implements IProceduralMemoryExtractor {
  private readonly completionFn?: (messages: Array<{ role: string; content: string }>) => Promise<string>;
  private readonly retryManager: RetryManager;
  private initResult: Awaited<ReturnType<LLMClientInitializer['initialize']>> | null = null;
  private initPromise: Promise<Awaited<ReturnType<LLMClientInitializer['initialize']>>> | null = null;

  constructor(options?: LlmProceduralExtractorOptions) {
    this.completionFn = options?.completion;
    const retryOptions = getRetryOptions();
    const retryConfig: RetryConfig = {
      maxAttempts: retryOptions.external_api.maxAttempts,
      baseDelay: retryOptions.external_api.baseDelay
    };
    this.retryManager = new RetryManager(retryConfig);
  }

  async extract(
    notes: ReflectionNotes | Record<string, unknown>,
    event?: FailureEvent
  ): Promise<ExtractedProceduralMemory | null> {
    return runWithLlmUsageLogicalContext('procedural_extraction', null, async () => {
      const messages = this.buildMessages(notes, event);
      let provider: string | null = null;
      let model: string | null = null;
      let raw: string;
      try {
        if (this.completionFn) {
          raw = await this.completionFn(messages);
        } else {
          const llm = await this.callLLM(messages);
          raw = llm.raw;
          provider = llm.provider;
          model = llm.model;
        }
      } catch (err) {
        recordLlmUsageLogicalFinal({
          finalPath: 'deferred',
          finalReason: 'llm_failed',
          provider,
          model,
        });
        logger.warn('Procedural LLM 추출 실패, fallback 사용', {
          error: err instanceof Error ? err.message : String(err)
        });
        return null;
      }
      const parsed = this.parseResponse(raw);
      if (!parsed) {
        recordLlmUsageLogicalFinal({
          finalPath: 'deferred',
          finalReason: 'parse_failed',
          provider,
          model,
        });
        return null;
      }
      recordLlmUsageLogicalFinal({
        finalPath: 'llm',
        provider,
        model,
      });
      return parsed;
    });
  }

  private buildMessages(
    notes: ReflectionNotes | Record<string, unknown>,
    event?: FailureEvent
  ): Array<{ role: string; content: string }> {
    const payload: Record<string, unknown> = {
      reflection_notes: notes,
      ...(event && { event: { tool_name: event.tool_name, error_type: event.error_type, original_task: event.original_task } })
    };
    const userContent = JSON.stringify(payload, null, 2);
    return [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userContent }
    ];
  }

  private async callLLM(messages: Array<{ role: string; content: string }>): Promise<{
    raw: string;
    provider: string;
    model: string;
  }> {
    if (!this.initPromise) {
      this.initPromise = new LLMClientInitializer().initialize();
    }
    const result = await this.initPromise;
    this.initResult = result;

    const timeoutMs = mementoConfig.proceduralLlmExtractorTimeoutMs ?? 10000;
    const requested = resolveLlmProvider('procedural');
    const actual = pickProceduralProvider(requested, {
      openai: result.openaiClient !== null,
      gemini: result.geminiClient !== null,
      ollama: result.initializedProviders.includes('ollama'),
    });

    if (actual === 'openai' && result.openaiClient) {
      const model = resolveLlmModel('openai', 'procedural', mementoConfig, {
        boundProvider: resolveBoundLlmProvider('procedural', this.initResult?.preferredProvider ?? null),
      });
      const raw = await this.callOpenAI(result.openaiClient, messages, timeoutMs);
      return { raw, provider: 'openai', model };
    }
    if (actual === 'gemini' && result.geminiClient) {
      const model = resolveLlmModel('gemini', 'procedural', mementoConfig, {
        boundProvider: resolveBoundLlmProvider('procedural', this.initResult?.preferredProvider ?? null),
      });
      const raw = await this.callGemini(result.geminiClient, messages, timeoutMs);
      return { raw, provider: 'gemini', model };
    }
    if (actual === 'ollama') {
      const model = resolveLlmModel('ollama', 'procedural', mementoConfig, {
        boundProvider: resolveBoundLlmProvider('procedural', this.initResult?.preferredProvider ?? null),
      });
      const raw = await this.callOllama(messages, timeoutMs);
      return { raw, provider: 'ollama', model };
    }

    throw new Error('사용 가능한 LLM provider 없음');
  }

  private async callOpenAI(
    client: NonNullable<Awaited<ReturnType<LLMClientInitializer['initialize']>>['openaiClient']>,
    messages: Array<{ role: string; content: string }>,
    timeoutMs: number
  ): Promise<string> {
    const retryOptions = getRetryOptions();
    const model = resolveLlmModel('openai', 'procedural', mementoConfig, {
      boundProvider: resolveBoundLlmProvider('procedural', this.initResult?.preferredProvider ?? null),
    });
    const res = await this.retryManager.retry(
      async () => {
        try {
          return await client.chat.completions.create({
            model,
            messages: messages as OpenAI.ChatCompletionMessageParam[],
            temperature: 0.3,
            max_tokens: 1024,
            response_format: { type: 'json_object' }
          }, { timeout: timeoutMs });
        } catch (error) {
          recordLlmUsageAttempt({
            provider: 'openai',
            model,
            outcome: classifyLlmAttemptOutcome(error),
            failureReason: error instanceof Error ? error.message.slice(0, 120) : String(error).slice(0, 120),
            attemptCoverage: 'full',
            inputTokens: 'unknown',
            outputTokens: 'unknown',
          });
          throw error;
        }
      },
      {
        maxAttempts: retryOptions.external_api.maxAttempts,
        baseDelay: retryOptions.external_api.baseDelay,
        shouldRetry: (error: Error) => {
          const msg = error.message.toLowerCase();
          return msg.includes('network') || msg.includes('timeout') || msg.includes('rate limit') || msg.includes('503');
        }
      }
    );
    const content = res.choices[0]?.message?.content;
    if (!content) throw new Error('OpenAI 응답 내용 없음');
    const providerReported = res.usage != null;
    recordLlmUsageAttempt({
      provider: 'openai',
      model,
      outcome: 'success',
      attemptCoverage: 'full',
      inputTokens: coerceUsageField(res.usage?.prompt_tokens, providerReported),
      outputTokens: coerceUsageField(res.usage?.completion_tokens, providerReported),
    });
    return content;
  }

  private async callGemini(
    client: NonNullable<Awaited<ReturnType<LLMClientInitializer['initialize']>>['geminiClient']>,
    messages: Array<{ role: string; content: string }>,
    timeoutMs: number
  ): Promise<string> {
    const retryOptions = getRetryOptions();
    const model = resolveLlmModel('gemini', 'procedural', mementoConfig, {
      boundProvider: resolveBoundLlmProvider('procedural', this.initResult?.preferredProvider ?? null),
    });
    return await this.retryManager.retry(
      async () => {
        const prompt = messages.map(m => `${m.role}: ${m.content}`).join('\n\n');
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const gen = await client.models.generateContent({
            model,
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            config: { temperature: 0.3, maxOutputTokens: 1024, thinkingConfig: { thinkingBudget: 0 } },
          });
          const text = gen.text || '{}';
          recordLlmUsageAttempt({
            provider: 'gemini',
            model,
            outcome: 'success',
            attemptCoverage: 'full',
            inputTokens: 'unknown',
            outputTokens: 'unknown',
          });
          return text;
        } catch (error) {
          recordLlmUsageAttempt({
            provider: 'gemini',
            model,
            outcome: classifyLlmAttemptOutcome(error),
            failureReason: error instanceof Error ? error.message.slice(0, 120) : String(error).slice(0, 120),
            attemptCoverage: 'full',
            inputTokens: 'unknown',
            outputTokens: 'unknown',
          });
          throw error;
        } finally {
          clearTimeout(timeoutId);
        }
      },
      {
        maxAttempts: retryOptions.external_api.maxAttempts,
        baseDelay: retryOptions.external_api.baseDelay,
        shouldRetry: (error: Error) => {
          const msg = error.message.toLowerCase();
          return msg.includes('network error') || msg.includes('rate limit') || msg.includes('503');
        }
      }
    );
  }

  private async callOllama(
    messages: Array<{ role: string; content: string }>,
    timeoutMs: number
  ): Promise<string> {
    const retryOptions = getRetryOptions();
    const baseUrl = mementoConfig.ollamaBaseUrl || 'http://localhost:11434';
    const model = resolveLlmModel('ollama', 'procedural', mementoConfig, {
      boundProvider: resolveBoundLlmProvider('procedural', this.initResult?.preferredProvider ?? null),
    });
    const prompt = messages.map((m) => `${m.role}: ${m.content}`).join('\n\n');

    return await this.retryManager.retry(
      async () => {
        try {
          const response = await fetch(`${baseUrl}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model,
              prompt,
              stream: false,
              format: 'json',
              options: { temperature: 0.3 },
            }),
            signal: AbortSignal.timeout(timeoutMs),
          });
          if (!response.ok) {
            const err = new Error(`Ollama HTTP ${response.status}`);
            recordLlmUsageAttempt({
              provider: 'ollama',
              model,
              outcome: response.status === 429 ? 'rate_limited' : 'failure',
              failureReason: `http_${response.status}`,
              attemptCoverage: 'unknown',
              inputTokens: 'unknown',
              outputTokens: 'unknown',
            });
            throw err;
          }
          const payload = (await response.json()) as { response?: string };
          if (!payload.response) {
            throw new Error('Ollama 응답 내용 없음');
          }
          recordLlmUsageAttempt({
            provider: 'ollama',
            model,
            outcome: 'success',
            attemptCoverage: 'unknown',
            inputTokens: 'unknown',
            outputTokens: 'unknown',
          });
          return payload.response;
        } catch (error) {
          if (!(error instanceof Error) || !error.message.startsWith('Ollama HTTP')) {
            recordLlmUsageAttempt({
              provider: 'ollama',
              model,
              outcome: classifyLlmAttemptOutcome(error),
              failureReason: error instanceof Error ? error.message.slice(0, 120) : String(error).slice(0, 120),
              attemptCoverage: 'unknown',
              inputTokens: 'unknown',
              outputTokens: 'unknown',
            });
          }
          throw error;
        }
      },
      {
        maxAttempts: retryOptions.external_api.maxAttempts,
        baseDelay: retryOptions.external_api.baseDelay,
        shouldRetry: (error: Error) => {
          const msg = error.message.toLowerCase();
          return msg.includes('network') || msg.includes('timeout') || msg.includes('503');
        },
      }
    );
  }

  /**
   * LLM 응답 문자열을 ExtractedProceduralMemory로 파싱.
   * 동작: 코드블록 제거 → JSON 파싱 → 필드 타입 정규화, 실패 시 null.
   */
  private parseResponse(raw: string): ExtractedProceduralMemory | null {
    try {
      let text = raw.trim();
      const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (codeBlock && codeBlock[1] !== undefined) {
        text = codeBlock[1].trim();
      }
      const parsed = JSON.parse(text) as Record<string, unknown>;
      const workflow_name = typeof parsed.workflow_name === 'string' ? parsed.workflow_name : undefined;
      const skill_name = typeof parsed.skill_name === 'string' ? parsed.skill_name : undefined;
      const steps = typeof parsed.steps === 'string' ? parsed.steps : (Array.isArray(parsed.steps) ? JSON.stringify(parsed.steps) : undefined);
      const trigger_conditions = typeof parsed.trigger_conditions === 'string' ? parsed.trigger_conditions : (parsed.trigger_conditions && typeof parsed.trigger_conditions === 'object' ? JSON.stringify(parsed.trigger_conditions) : undefined);
      const task_goal = typeof parsed.task_goal === 'string' ? parsed.task_goal : undefined;
      return { workflow_name, skill_name, steps, trigger_conditions, task_goal };
    } catch (err) {
      logger.debug('Procedural LLM 응답 파싱 실패', { rawPrefix: raw?.substring(0, 100), error: err });
      return null;
    }
  }
}
