/**
 * Memory Injection 프롬프트 도구
 * MCP 프롬프트 인터페이스를 통한 관련 기억 주입
 */

import { BaseTool } from './base-tool.js';
import type { ToolContext } from './types.js';
import { z } from 'zod';

const MemoryInjectionSchema = z.object({
  query: z.string().describe('검색할 쿼리'),
  token_budget: z.number().optional().describe('토큰 예산 (기본값: 1000)'),
  max_memories: z.number().optional().describe('최대 기억 개수 (기본값: 5)'),
  memory_types: z.array(z.enum(['working', 'episodic', 'semantic', 'procedural'])).optional().describe('포함할 기억 타입들'),
  importance_threshold: z.number().optional().describe('중요도 임계값 (기본값: 0.5)')
});

export class MemoryInjectionPrompt extends BaseTool {
  constructor() {
    super(
      'memory_injection',
      '관련 기억을 요약하여 프롬프트에 주입',
      {
        type: 'object',
        properties: {
          query: { 
            type: 'string', 
            description: '검색할 쿼리' 
          },
          token_budget: { 
            type: 'number', 
            description: '토큰 예산 (기본값: 1000)',
            default: 1000
          },
          max_memories: { 
            type: 'number', 
            description: '최대 기억 개수 (기본값: 5)',
            default: 5
          },
          memory_types: { 
            type: 'array',
            items: {
              type: 'string',
              enum: ['working', 'episodic', 'semantic', 'procedural']
            },
            description: '포함할 기억 타입들',
            default: ['working', 'episodic', 'semantic', 'procedural']
          },
          importance_threshold: { 
            type: 'number', 
            description: '중요도 임계값 (기본값: 0.5)',
            default: 0.5
          }
        },
        required: ['query']
      }
    );
  }

  async handle(params: any, context: ToolContext): Promise<any> {
    const {
      query,
      token_budget = 1000,
      max_memories = 5,
      memory_types = ['working', 'episodic', 'semantic', 'procedural'],
      importance_threshold = 0.5
    } = MemoryInjectionSchema.parse(params);

    try {
      console.log(`🧠 Memory Injection 시작: "${query}" (토큰 예산: ${token_budget})`);

      if (!context.db) {
        throw new Error('데이터베이스가 연결되지 않았습니다');
      }

      if (!context.services?.hybridSearchEngine) {
        throw new Error('하이브리드 검색 엔진이 사용할 수 없습니다');
      }

      // 1. 관련 기억 검색
      const searchResult = await context.services.hybridSearchEngine.search(context.db, {
        query,
        filters: {
          type: memory_types.length === 4 ? undefined : memory_types as any,
          importance_min: importance_threshold
        },
        limit: max_memories * 2, // 더 많은 후보를 가져와서 요약
        vectorWeight: 0.7, // 의미적 유사성에 더 중점
        textWeight: 0.3
      });

      const memories = searchResult.items;
      console.log(`🔍 검색된 기억: ${memories.length}개`);

      if (memories.length === 0) {
        return this.createSuccessResult({
          message: '관련 기억을 찾을 수 없습니다.',
          memories_used: 0,
          token_estimate: 0,
          query: query
        });
      }

      // 2. 기억 요약 및 토큰 예산 관리
      const summary = await this.summarizeMemories(memories, token_budget, max_memories);

      // 3. 프롬프트 형식으로 포맷팅
      const formattedPrompt = this.formatMemoryPrompt(summary, query);

      console.log(`✅ Memory Injection 완료: ${summary.length}개 기억, ${this.estimateTokens(formattedPrompt)} 토큰`);

      return this.createSuccessResult({
        message: formattedPrompt,
        memories_used: summary.length,
        token_estimate: this.estimateTokens(formattedPrompt),
        query: query
      });

    } catch (error) {
      console.error('❌ Memory Injection 실패:', error);
      throw error;
    }
  }

  /**
   * 기억들을 요약하여 토큰 예산 내에서 관리
   */
  private async summarizeMemories(
    memories: any[], 
    tokenBudget: number, 
    maxMemories: number
  ): Promise<Array<{id: string, content: string, type: string, importance: number, summary: string}>> {
    const summaries: Array<{id: string, content: string, type: string, importance: number, summary: string}> = [];
    let usedTokens = 0;
    const maxTokensPerMemory = Math.floor(tokenBudget / maxMemories);

    // 중요도와 점수 순으로 정렬
    const sortedMemories = memories
      .sort((a, b) => (b.finalScore + b.importance) - (a.finalScore + a.importance))
      .slice(0, maxMemories);

    for (const memory of sortedMemories) {
      if (usedTokens >= tokenBudget) break;

      // 기억 내용 요약
      const summary = this.summarizeMemoryContent(memory.content, maxTokensPerMemory);
      const summaryTokens = this.estimateTokens(summary);

      if (usedTokens + summaryTokens <= tokenBudget) {
        summaries.push({
          id: memory.id,
          content: memory.content,
          type: memory.type,
          importance: memory.importance,
          summary
        });
        usedTokens += summaryTokens;
      }
    }

    return summaries;
  }

  /**
   * 개별 기억 내용 요약
   */
  private summarizeMemoryContent(content: string, maxTokens: number): string {
    // 간단한 요약 로직 (실제로는 더 정교한 요약 알고리즘 사용 가능)
    const words = content.split(' ');
    const maxWords = Math.floor(maxTokens / 1.5); // 대략적인 단어 수 계산

    if (words.length <= maxWords) {
      return content;
    }

    // 중요도 기반 요약 (첫 문장 + 마지막 문장 + 중간 핵심 내용)
    const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 0);
    
    if (sentences.length <= 2) {
      return words.slice(0, maxWords).join(' ') + '...';
    }

    const firstSentence = sentences[0]?.trim() || '';
    const lastSentence = sentences[sentences.length - 1]?.trim() || '';
    const middleSentences = sentences.slice(1, -1);
    
    let summary = firstSentence;
    let remainingWords = maxWords - firstSentence.split(' ').length;

    if (remainingWords > 0 && middleSentences.length > 0) {
      const middleText = middleSentences.join('. ');
      const middleWords = middleText.split(' ');
      const middleWordsToInclude = Math.min(remainingWords - lastSentence.split(' ').length, middleWords.length);
      
      if (middleWordsToInclude > 0) {
        summary += ' ' + middleWords.slice(0, middleWordsToInclude).join(' ');
        remainingWords -= middleWordsToInclude;
      }
    }

    if (remainingWords > 0) {
      summary += ' ' + lastSentence;
    }

    return summary + (summary.length < content.length ? '...' : '');
  }

  /**
   * 프롬프트 형식으로 포맷팅
   */
  private formatMemoryPrompt(
    summaries: Array<{id: string, content: string, type: string, importance: number, summary: string}>,
    query: string
  ): string {
    if (summaries.length === 0) {
      return '관련 기억을 찾을 수 없습니다.';
    }

    let prompt = `# 관련 기억 (${summaries.length}개)\n\n`;
    prompt += `**검색 쿼리**: "${query}"\n\n`;

    summaries.forEach((memory, index) => {
      const typeEmoji = this.getMemoryTypeEmoji(memory.type);
      const importanceStars = '★'.repeat(Math.ceil(memory.importance * 5));
      
      prompt += `## ${index + 1}. ${typeEmoji} ${memory.type.toUpperCase()} 기억\n`;
      prompt += `**중요도**: ${importanceStars} (${memory.importance.toFixed(2)})\n`;
      prompt += `**내용**: ${memory.summary}\n\n`;
    });

    prompt += '---\n';
    prompt += '*이 기억들은 현재 대화와 관련된 맥락 정보입니다. 참고하여 더 정확하고 관련성 높은 답변을 제공하세요.*';

    return prompt;
  }

  /**
   * 기억 타입별 이모지
   */
  private getMemoryTypeEmoji(type: string): string {
    const emojiMap: Record<string, string> = {
      'working': '🧠',
      'episodic': '📝',
      'semantic': '📚',
      'procedural': '⚙️'
    };
    return emojiMap[type] || '💭';
  }

  /**
   * 토큰 수 추정 (간단한 추정)
   */
  private estimateTokens(text: string): number {
    // 대략적인 토큰 수 추정 (실제로는 더 정확한 토크나이저 사용 가능)
    return Math.ceil(text.length / 4);
  }
}
