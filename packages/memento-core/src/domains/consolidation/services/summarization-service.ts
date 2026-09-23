/**
 * 클러스터 요약 — LLM(가능 시) 또는 extractive fallback.
 *
 * FR-009(한 클러스터 실패 시 나머지 계속)는 `SleepConsolidationService` 루프에서 처리한다.
 * 여기서는 LLM 호출 실패 시 extractive로 전환해 빈 요약만 피한다(스킵·에러 집계는 상위 담당).
 */

import { resolveLlmModel, resolveLlmProvider } from '../../../shared/config/llm-model-resolver.js';
import type {
  LlmModelConfigSlice,
  LlmProviderConfigSlice,
} from '../../../shared/config/llm-model-resolver.js';
import type { MementoConfig } from '../../../shared/types/memory.types.js';
import { mementoConfig } from '../../../shared/config/index.js';
import { OllamaChatLlmAdapter } from '../../personal-agent/adapters/ollama-chat-llm-adapter.js';
import type { EpisodicCandidateRow } from '../repositories/consolidation-repository.js';

export type SummarizationMethod = 'llm' | 'extractive';

/** 테스트 주입용 설정 슬라이스. 생략 시 mementoConfig 를 쓴다. */
export type SummarizationLlmConfig = LlmModelConfigSlice &
  LlmProviderConfigSlice &
  Pick<MementoConfig, 'ollamaBaseUrl'>;

export interface SummarizeClusterInput {
  clusterEpisodes: EpisodicCandidateRow[];
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

  extractiveFallback(episodes: EpisodicCandidateRow[]): { content: string; method: SummarizationMethod } {
    let best = episodes[0]!;
    for (const e of episodes) {
      if (e.importance > best.importance) {
        best = e;
      }
    }
    return { content: best.content, method: 'extractive' };
  }

  /**
   * LLM 키가 있으면 OpenAI Chat Completions (gpt-4o-mini 기본) 호출, 실패 시 extractive
   */
  async summarizeCluster(input: SummarizeClusterInput): Promise<{
    content: string;
    method: SummarizationMethod;
  }> {
    const { clusterEpisodes } = input;
    if (clusterEpisodes.length === 0) {
      return { content: '', method: 'extractive' };
    }

    if (!this.hasLlmConfigured()) {
      return this.extractiveFallback(clusterEpisodes);
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
              { role: 'system', content: 'You compress episodic traces into durable semantic knowledge.' },
              { role: 'user', content: prompt }
            ],
            temperature: 0.3
          })
        });
        if (!res.ok) {
          return this.extractiveFallback(clusterEpisodes);
        }
        const data = (await res.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
        };
        const text = data.choices?.[0]?.message?.content?.trim();
        if (text) {
          return { content: text, method: 'llm' };
        }
      }

      const geminiKey = process.env.GEMINI_API_KEY?.trim();
      if (geminiKey && (provider === 'gemini' || provider === 'auto')) {
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
          return this.extractiveFallback(clusterEpisodes);
        }
        const data = (await res.json()) as {
          candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
        };
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
        if (text) {
          return { content: text, method: 'llm' };
        }
      }
      if (provider === 'ollama') {
        const model = resolveLlmModel('ollama', 'consolidation', this.llmConfig, {
          boundProvider: 'ollama',
        });
        const adapter = new OllamaChatLlmAdapter({
          baseUrl: this.llmConfig.ollamaBaseUrl,
          model,
        });
        const result = await adapter.complete([
          { role: 'system', content: 'You compress episodic traces into durable semantic knowledge.' },
          { role: 'user', content: prompt },
        ]);
        const text = result.content.trim();
        if (text) {
          return { content: text, method: 'llm' };
        }
      }
    } catch {
      /* network / parse */
    }

    return this.extractiveFallback(clusterEpisodes);
  }

  /**
   * 기존 시맨틱 본문 + 신규 에피소딕 묶음을 하나의 시맨틱으로 재요약 (병합 경로)
   */
  async summarizeMergeForConsolidation(input: {
    existingSemanticContent: string;
    clusterEpisodes: EpisodicCandidateRow[];
  }): Promise<{ content: string; method: SummarizationMethod }> {
    const { existingSemanticContent, clusterEpisodes } = input;
    if (clusterEpisodes.length === 0) {
      return { content: existingSemanticContent.trim(), method: 'extractive' };
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
