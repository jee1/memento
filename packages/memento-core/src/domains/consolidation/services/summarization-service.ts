/**
 * 클러스터 요약 — LLM 성공 시에만 통합 본문을 만든다 (#1549).
 *
 * LLM 미설정·실패·429·빈 응답은 extractive 로 끝내지 않고 defer 한다.
 * FR-009(한 클러스터 실패 시 나머지 계속)와 429 시 남은 클러스터 중단은
 * `SleepConsolidationService` 루프에서 처리한다.
 */

import { resolveLlmModel, resolveLlmProvider } from '../../../shared/config/llm-model-resolver.js';
import type {
  LlmModelConfigSlice,
  LlmProviderConfigSlice,
} from '../../../shared/config/llm-model-resolver.js';
import type { MementoConfig } from '../../../shared/types/memory.types.js';
import { mementoConfig } from '../../../shared/config/index.js';
import { coerceUsageField } from '../../../shared/services/llm-usage/llm-usage-classify.js';
import {
  recordLlmUsageAttempt,
  recordLlmUsageLogicalFinal,
} from '../../../shared/services/llm-usage/llm-usage-recorder.js';
import { runWithLlmUsageLogicalContext } from '../../../shared/services/llm-usage/llm-usage-logical-context.js';
import { OllamaChatLlmAdapter } from '../../personal-agent/index.js';
import type { EpisodicCandidateRow } from '../repositories/consolidation-repository.js';

export type SummarizationDeferReason =
  | 'no_llm_configured'
  | 'llm_failed'
  | 'quota_exceeded'
  | 'empty_response';

export type SummarizeClusterResult =
  | { ok: true; content: string; method: 'llm' }
  | { ok: false; reason: SummarizationDeferReason };

/** 테스트 주입용 설정 슬라이스. 생략 시 mementoConfig 를 쓴다. */
export type SummarizationLlmConfig = LlmModelConfigSlice &
  LlmProviderConfigSlice &
  Pick<MementoConfig, 'ollamaBaseUrl'>;

interface SummarizeClusterInput {
  clusterEpisodes: EpisodicCandidateRow[];
}

const SYSTEM_PROMPT = 'You compress episodic traces into durable semantic knowledge.';

function deferFromHttpStatus(status: number): SummarizationDeferReason {
  return status === 429 ? 'quota_exceeded' : 'llm_failed';
}

function textFromOpenAiResponse(data: {
  choices?: Array<{ message?: { content?: string } }>;
}): string {
  return data.choices?.[0]?.message?.content?.trim() ?? '';
}

function textFromGeminiResponse(data: {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
}): string {
  return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? '';
}

export class SummarizationService {
  constructor(private readonly llmConfig: SummarizationLlmConfig = mementoConfig) {}

  hasLlmConfigured(): boolean {
    const provider = resolveLlmProvider('consolidation', this.llmConfig);
    if (provider === 'ollama') {
      return true;
    }
    const openai = process.env.OPENAI_API_KEY?.trim();
    const gemini = process.env.GEMINI_API_KEY?.trim();
    if (provider === 'openai') {
      return Boolean(openai);
    }
    if (provider === 'gemini') {
      return Boolean(gemini);
    }
    return Boolean(openai || gemini);
  }

  private defer(reason: SummarizationDeferReason): SummarizeClusterResult {
    return { ok: false, reason };
  }

  private recordLogical(result: SummarizeClusterResult, provider: string | null, model: string | null): void {
    if (result.ok) {
      recordLlmUsageLogicalFinal({ finalPath: 'llm', provider, model });
      return;
    }
    if (result.ok === false && result.reason === 'no_llm_configured') {
      recordLlmUsageLogicalFinal({
        finalPath: 'not_configured',
        finalReason: result.reason,
        provider,
        model,
      });
      return;
    }
    if (result.ok === false) {
      recordLlmUsageLogicalFinal({
        finalPath: 'deferred',
        finalReason: result.reason,
        provider,
        model,
      });
    }
  }

  private async callOpenAi(prompt: string): Promise<SummarizeClusterResult> {
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) {
      return this.defer('llm_failed');
    }
    const model = resolveLlmModel('openai', 'consolidation', undefined, {
      boundProvider: 'openai',
    });
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: prompt }
        ],
        temperature: 0.3
      })
    });
    if (!res.ok) {
      recordLlmUsageAttempt({
        provider: 'openai',
        model,
        outcome: res.status === 429 ? 'rate_limited' : 'failure',
        failureReason: `http_${res.status}`,
        attemptCoverage: 'full',
        inputTokens: 'unknown',
        outputTokens: 'unknown',
      });
      return this.defer(deferFromHttpStatus(res.status));
    }
    const payload = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const text = textFromOpenAiResponse(payload);
    if (text) {
      const providerReported = payload.usage != null;
      recordLlmUsageAttempt({
        provider: 'openai',
        model,
        outcome: 'success',
        attemptCoverage: 'full',
        inputTokens: coerceUsageField(payload.usage?.prompt_tokens, providerReported),
        outputTokens: coerceUsageField(payload.usage?.completion_tokens, providerReported),
      });
      return { ok: true, content: text, method: 'llm' };
    }
    recordLlmUsageAttempt({
      provider: 'openai',
      model,
      outcome: 'failure',
      failureReason: 'empty_response',
      attemptCoverage: 'full',
      inputTokens: 'unknown',
      outputTokens: 'unknown',
    });
    return this.defer('empty_response');
  }

  private async callGemini(prompt: string): Promise<SummarizeClusterResult> {
    const geminiKey = process.env.GEMINI_API_KEY?.trim();
    if (!geminiKey) {
      return this.defer('llm_failed');
    }
    const model = resolveLlmModel('gemini', 'consolidation', undefined, {
      boundProvider: 'gemini',
    });
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }]
      })
    });
    if (!res.ok) {
      recordLlmUsageAttempt({
        provider: 'gemini',
        model,
        outcome: res.status === 429 ? 'rate_limited' : 'failure',
        failureReason: `http_${res.status}`,
        attemptCoverage: 'full',
        inputTokens: 'unknown',
        outputTokens: 'unknown',
      });
      return this.defer(deferFromHttpStatus(res.status));
    }
    const payload = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    };
    const text = textFromGeminiResponse(payload);
    if (text) {
      const providerReported = payload.usageMetadata != null;
      recordLlmUsageAttempt({
        provider: 'gemini',
        model,
        outcome: 'success',
        attemptCoverage: 'full',
        inputTokens: coerceUsageField(payload.usageMetadata?.promptTokenCount, providerReported),
        outputTokens: coerceUsageField(payload.usageMetadata?.candidatesTokenCount, providerReported),
      });
      return { ok: true, content: text, method: 'llm' };
    }
    recordLlmUsageAttempt({
      provider: 'gemini',
      model,
      outcome: 'failure',
      failureReason: 'empty_response',
      attemptCoverage: 'full',
      inputTokens: 'unknown',
      outputTokens: 'unknown',
    });
    return this.defer('empty_response');
  }

  private async callOllama(prompt: string): Promise<SummarizeClusterResult> {
    const model = resolveLlmModel('ollama', 'consolidation', this.llmConfig, {
      boundProvider: 'ollama',
    });
    const adapter = new OllamaChatLlmAdapter({
      baseUrl: this.llmConfig.ollamaBaseUrl,
      model,
    });
    const result = await adapter.complete([
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: prompt },
    ]);
    const text = result.content.trim();
    if (text) {
      recordLlmUsageAttempt({
        provider: 'ollama',
        model,
        outcome: 'success',
        attemptCoverage: 'unknown',
        inputTokens: 'unknown',
        outputTokens: 'unknown',
      });
      return { ok: true, content: text, method: 'llm' };
    }
    recordLlmUsageAttempt({
      provider: 'ollama',
      model,
      outcome: 'failure',
      failureReason: 'empty_response',
      attemptCoverage: 'unknown',
      inputTokens: 'unknown',
      outputTokens: 'unknown',
    });
    return this.defer('empty_response');
  }

  /**
   * LLM 키가 있으면 OpenAI / Gemini / Ollama 호출. 실패·429·빈 응답은 defer.
   */
  async summarizeCluster(input: SummarizeClusterInput): Promise<SummarizeClusterResult> {
    return runWithLlmUsageLogicalContext('consolidation_summarize', null, async () => {
      const provider = resolveLlmProvider('consolidation', this.llmConfig);
      let model: string | null = null;
      if (provider === 'openai' || provider === 'auto') {
        model = resolveLlmModel('openai', 'consolidation', undefined, { boundProvider: 'openai' });
      } else if (provider === 'gemini') {
        model = resolveLlmModel('gemini', 'consolidation', undefined, { boundProvider: 'gemini' });
      } else if (provider === 'ollama') {
        model = resolveLlmModel('ollama', 'consolidation', this.llmConfig, { boundProvider: 'ollama' });
      }

      const result = await this.summarizeClusterInner(input);
      this.recordLogical(result, provider, model);
      return result;
    });
  }

  private async summarizeClusterInner(input: SummarizeClusterInput): Promise<SummarizeClusterResult> {
    const { clusterEpisodes } = input;
    if (clusterEpisodes.length === 0) {
      return this.defer('empty_response');
    }

    if (!this.hasLlmConfigured()) {
      return this.defer('no_llm_configured');
    }

    const body = clusterEpisodes.map(e => `- (${e.id}) ${e.content}`).join('\n');
    const prompt =
      'Summarize the following episodic memories into one concise semantic memory paragraph. ' +
      'Use the same language as the sources. Do not list IDs.\n\n' +
      body;

    try {
      const provider = resolveLlmProvider('consolidation', this.llmConfig);
      const apiKey = process.env.OPENAI_API_KEY?.trim();
      if (apiKey && (provider === 'openai' || provider === 'auto')) {
        return await this.callOpenAi(prompt);
      }

      const geminiKey = process.env.GEMINI_API_KEY?.trim();
      if (geminiKey && (provider === 'gemini' || provider === 'auto')) {
        return await this.callGemini(prompt);
      }
      if (provider === 'ollama') {
        return await this.callOllama(prompt);
      }
    } catch (err) {
      if (err instanceof Error && /429|quota|rate limit/i.test(err.message)) {
        return this.defer('quota_exceeded');
      }
    }

    return this.defer('llm_failed');
  }

  /**
   * 기존 시맨틱 본문 + 신규 에피소딕 묶음을 하나의 시맨틱으로 재요약 (병합 경로)
   */
  async summarizeMergeForConsolidation(input: {
    existingSemanticContent: string;
    clusterEpisodes: EpisodicCandidateRow[];
  }): Promise<SummarizeClusterResult> {
    const { existingSemanticContent, clusterEpisodes } = input;
    if (clusterEpisodes.length === 0) {
      const trimmed = existingSemanticContent.trim();
      if (!trimmed) {
        return this.defer('empty_response');
      }
      return { ok: true, content: trimmed, method: 'llm' };
    }
    const mergedEpisode: EpisodicCandidateRow = {
      ...clusterEpisodes[0]!,
      id: 'merge-input',
      content:
        `Existing consolidated knowledge:\n${existingSemanticContent}\n\n` +
        `New episodic memories:\n${clusterEpisodes.map(e => `- (${e.id}) ${e.content}`).join('\n')}`
    };
    return this.summarizeCluster({ clusterEpisodes: [mergedEpisode] });
  }
}
