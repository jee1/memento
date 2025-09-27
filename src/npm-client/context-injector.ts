/**
 * ContextInjector - AI Agent의 컨텍스트에 관련 기억을 주입하는 클래스
 * 대화나 작업 중에 관련된 기억을 자동으로 찾아 컨텍스트에 주입합니다.
 * 
 * @example
 * ```typescript
 * import { ContextInjector } from '@memento/client';
 * 
 * const injector = new ContextInjector(client);
 * 
 * // 컨텍스트 주입
 * const context = await injector.inject({
 *   query: 'React Hook에 대해 질문',
 *   tokenBudget: 1000
 * });
 * 
 * console.log(context.content);
 * ```
 */

import { MementoClient } from './memento-client.js';
import type {
  ContextInjectionResult,
  SearchResult,
  MemoryItem
} from './types.js';

export interface ContextInjectionOptions {
  /** 최대 검색 결과 수 (기본값: 10) */
  maxResults?: number;
  /** 토큰 예산 (기본값: 1200) */
  tokenBudget?: number;
  /** 컨텍스트 타입 */
  contextType?: 'conversation' | 'task' | 'general';
  /** 기억 타입 필터 */
  memoryTypes?: Array<'working' | 'episodic' | 'semantic' | 'procedural'>;
  /** 최근 기간 필터 (일 단위) */
  recentDays?: number;
  /** 중요도 임계값 (0-1) */
  importanceThreshold?: number;
  /** 고정된 기억만 포함할지 여부 */
  pinnedOnly?: boolean;
}

export class ContextInjector {
  constructor(private client: MementoClient) {}

  /**
   * 컨텍스트 주입
   */
  async inject(
    query: string,
    options: ContextInjectionOptions = {}
  ): Promise<ContextInjectionResult> {
    const startTime = Date.now();
    
    const {
      maxResults = 10,
      tokenBudget = 1200,
      contextType = 'general',
      memoryTypes,
      recentDays,
      importanceThreshold = 0.3,
      pinnedOnly = false
    } = options;

    // 1. 관련 기억 검색
    const searchResult = await this.searchRelevantMemories(query, {
      maxResults,
      memoryTypes: memoryTypes || undefined,
      recentDays: recentDays || undefined,
      importanceThreshold,
      pinnedOnly
    });

    // 2. 토큰 예산에 맞게 기억 압축
    const compressedMemories = await this.compressMemories(
      searchResult.items as MemoryItem[],
      tokenBudget
    );

    // 3. 컨텍스트 생성
    const context = this.generateContext(
      query,
      compressedMemories,
      contextType
    );

    const searchTime = Date.now() - startTime;

    return {
      role: 'system',
      content: context,
      metadata: {
        memories_used: compressedMemories.length,
        token_count: this.estimateTokenCount(context),
        search_time: searchTime
      }
    };
  }

  /**
   * 관련 기억 검색
   */
  private async searchRelevantMemories(
    query: string,
    options: {
      maxResults: number;
      memoryTypes?: Array<'working' | 'episodic' | 'semantic' | 'procedural'>;
      recentDays?: number;
      importanceThreshold: number;
      pinnedOnly: boolean;
    }
  ): Promise<SearchResult> {
    const filters: any = {};

    // 메모리 타입 필터
    if (options.memoryTypes && options.memoryTypes.length > 0) {
      filters.type = options.memoryTypes;
    }

    // 최근 기간 필터
    if (options.recentDays) {
      const timeFrom = new Date();
      timeFrom.setDate(timeFrom.getDate() - options.recentDays);
      filters.time_from = timeFrom.toISOString();
    }

    // 고정된 기억만
    if (options.pinnedOnly) {
      filters.pinned = true;
    }

    // 하이브리드 검색 사용 (의미적 유사도 + 키워드 매칭)
    const hybridResult = await this.client.hybridSearch({
      query,
      filters,
      limit: options.maxResults,
      vectorWeight: 0.7, // 의미적 유사도에 더 가중치
      textWeight: 0.3
    });
    
    // HybridSearchResult를 SearchResult로 변환
    return {
      items: hybridResult.items.map(item => ({
        ...item,
        score: item.finalScore
      })),
      total_count: hybridResult.total_count,
      query_time: hybridResult.query_time
    };
  }

  /**
   * 기억 압축 (토큰 예산에 맞게)
   */
  private async compressMemories(
    memories: MemoryItem[],
    tokenBudget: number
  ): Promise<MemoryItem[]> {
    if (memories.length === 0) return [];

    // 중요도와 점수 기준으로 정렬
    const sortedMemories = memories.sort((a, b) => {
      const scoreA = (a as any).score || 0;
      const scoreB = (b as any).score || 0;
      return (scoreB + a.importance) - (scoreA + b.importance);
    });

    const compressed: MemoryItem[] = [];
    let currentTokens = 0;

    for (const memory of sortedMemories) {
      const memoryTokens = this.estimateTokenCount(memory.content);
      
      if (currentTokens + memoryTokens <= tokenBudget) {
        compressed.push(memory);
        currentTokens += memoryTokens;
      } else {
        // 토큰 예산이 부족하면 더 짧은 요약으로 시도
        const summary = this.summarizeMemory(memory);
        const summaryTokens = this.estimateTokenCount(summary);
        
        if (currentTokens + summaryTokens <= tokenBudget) {
          compressed.push({
            ...memory,
            content: summary
          });
          currentTokens += summaryTokens;
        }
      }
    }

    return compressed;
  }

  /**
   * 기억 요약
   */
  private summarizeMemory(memory: MemoryItem): string {
    const content = memory.content;
    const maxLength = 200; // 최대 200자로 제한

    if (content.length <= maxLength) {
      return content;
    }

    // 문장 단위로 자르기
    const sentences = content.split(/[.!?]+/);
    let summary = '';
    
    for (const sentence of sentences) {
      if (summary.length + sentence.length <= maxLength) {
        summary += sentence + '.';
      } else {
        break;
      }
    }

    return summary || content.substring(0, maxLength) + '...';
  }

  /**
   * 컨텍스트 생성
   */
  private generateContext(
    query: string,
    memories: MemoryItem[],
    contextType: string
  ): string {
    if (memories.length === 0) {
      return this.generateEmptyContext(query, contextType);
    }

    const contextHeader = this.getContextHeader(contextType);
    const memorySections = this.formatMemories(memories);
    const contextFooter = this.getContextFooter(query, memories.length);

    return `${contextHeader}\n\n${memorySections}\n\n${contextFooter}`;
  }

  /**
   * 컨텍스트 헤더 생성
   */
  private getContextHeader(contextType: string): string {
    const headers = {
      conversation: '💬 관련 대화 기록:',
      task: '📋 관련 작업 기록:',
      general: '🧠 관련 기억:'
    };

    return headers[contextType as keyof typeof headers] || headers.general;
  }

  /**
   * 기억 포맷팅
   */
  private formatMemories(memories: MemoryItem[]): string {
    return memories.map((memory, index) => {
      const typeEmoji = this.getTypeEmoji(memory.type);
      const importanceBar = this.getImportanceBar(memory.importance);
      const tags = memory.tags && memory.tags.length > 0 
        ? ` [${memory.tags.join(', ')}]` 
        : '';
      const score = (memory as any).score ? ` (관련도: ${((memory as any).score * 100).toFixed(1)}%)` : '';

      return `${index + 1}. ${typeEmoji} ${memory.content}${tags}${score}\n   ${importanceBar} ${memory.created_at}`;
    }).join('\n\n');
  }

  /**
   * 타입별 이모지
   */
  private getTypeEmoji(type: string): string {
    const emojis = {
      working: '⚡',
      episodic: '📅',
      semantic: '🧠',
      procedural: '🔧'
    };
    return emojis[type as keyof typeof emojis] || '📝';
  }

  /**
   * 중요도 바 생성
   */
  private getImportanceBar(importance: number): string {
    const filled = Math.round(importance * 5);
    const empty = 5 - filled;
    return '★'.repeat(filled) + '☆'.repeat(empty);
  }

  /**
   * 컨텍스트 푸터 생성
   */
  private getContextFooter(query: string, memoryCount: number): string {
    return `\n💡 위의 ${memoryCount}개 기억을 참고하여 "${query}"에 대해 답변해주세요.`;
  }

  /**
   * 빈 컨텍스트 생성
   */
  private generateEmptyContext(query: string, contextType: string): string {
    const messages = {
      conversation: '💬 관련 대화 기록이 없습니다.',
      task: '📋 관련 작업 기록이 없습니다.',
      general: '🧠 관련 기억이 없습니다.'
    };

    return `${messages[contextType as keyof typeof messages] || messages.general}\n\n💡 "${query}"에 대해 새로운 정보로 답변해주세요.`;
  }

  /**
   * 토큰 수 추정 (간단한 추정)
   */
  private estimateTokenCount(text: string): number {
    // 대략적인 토큰 수 추정 (한국어: 1글자 = 1토큰, 영어: 1단어 = 1.3토큰)
    const koreanChars = (text.match(/[가-힣]/g) || []).length;
    const englishWords = (text.match(/[a-zA-Z]+/g) || []).length;
    const otherChars = text.length - koreanChars - (text.match(/[a-zA-Z]/g) || []).length;
    
    return koreanChars + Math.ceil(englishWords * 1.3) + otherChars;
  }

  // ============================================================================
  // 고급 컨텍스트 주입 기능
  // ============================================================================

  /**
   * 대화 컨텍스트 주입
   */
  async injectConversationContext(
    query: string,
    tokenBudget: number = 1000
  ): Promise<ContextInjectionResult> {
    return await this.inject(query, {
      tokenBudget,
      contextType: 'conversation',
      memoryTypes: ['episodic', 'semantic'],
      recentDays: 30,
      importanceThreshold: 0.4
    });
  }

  /**
   * 작업 컨텍스트 주입
   */
  async injectTaskContext(
    query: string,
    projectId?: string,
    tokenBudget: number = 1200
  ): Promise<ContextInjectionResult> {
    const filters: any = {};
    if (projectId) {
      filters.project_id = projectId;
    }

    return await this.inject(query, {
      tokenBudget,
      contextType: 'task',
      memoryTypes: ['procedural', 'semantic'],
      importanceThreshold: 0.5,
      pinnedOnly: false
    });
  }

  /**
   * 학습 컨텍스트 주입
   */
  async injectLearningContext(
    topic: string,
    tokenBudget: number = 1500
  ): Promise<ContextInjectionResult> {
    return await this.inject(topic, {
      tokenBudget,
      contextType: 'general',
      memoryTypes: ['semantic', 'procedural'],
      importanceThreshold: 0.6,
      pinnedOnly: false
    });
  }

  /**
   * 프로젝트 컨텍스트 주입
   */
  async injectProjectContext(
    projectId: string,
    query: string,
    tokenBudget: number = 1000
  ): Promise<ContextInjectionResult> {
    const searchResult = await this.client.recall(query, {
      project_id: projectId
    }, 10);

    const compressedMemories = await this.compressMemories(
      searchResult.items as MemoryItem[],
      tokenBudget
    );

    const context = this.generateContext(query, compressedMemories, 'task');

    return {
      role: 'system',
      content: context,
      metadata: {
        memories_used: compressedMemories.length,
        token_count: this.estimateTokenCount(context),
        search_time: searchResult.query_time
      }
    };
  }
}
