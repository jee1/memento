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
import type { ContextInjectionResult } from './types.js';
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
export declare class ContextInjector {
    private client;
    constructor(client: MementoClient);
    /**
     * 컨텍스트 주입
     */
    inject(query: string, options?: ContextInjectionOptions): Promise<ContextInjectionResult>;
    /**
     * 관련 기억 검색
     */
    private searchRelevantMemories;
    /**
     * 기억 압축 (토큰 예산에 맞게)
     */
    private compressMemories;
    /**
     * 기억 요약
     */
    private summarizeMemory;
    /**
     * 컨텍스트 생성
     */
    private generateContext;
    /**
     * 컨텍스트 헤더 생성
     */
    private getContextHeader;
    /**
     * 기억 포맷팅
     */
    private formatMemories;
    /**
     * 타입별 이모지
     */
    private getTypeEmoji;
    /**
     * 중요도 바 생성
     */
    private getImportanceBar;
    /**
     * 컨텍스트 푸터 생성
     */
    private getContextFooter;
    /**
     * 빈 컨텍스트 생성
     */
    private generateEmptyContext;
    /**
     * 토큰 수 추정 (간단한 추정)
     */
    private estimateTokenCount;
    /**
     * 대화 컨텍스트 주입
     */
    injectConversationContext(query: string, tokenBudget?: number): Promise<ContextInjectionResult>;
    /**
     * 작업 컨텍스트 주입
     */
    injectTaskContext(query: string, projectId?: string, tokenBudget?: number): Promise<ContextInjectionResult>;
    /**
     * 학습 컨텍스트 주입
     */
    injectLearningContext(topic: string, tokenBudget?: number): Promise<ContextInjectionResult>;
    /**
     * 프로젝트 컨텍스트 주입
     */
    injectProjectContext(projectId: string, query: string, tokenBudget?: number): Promise<ContextInjectionResult>;
}
//# sourceMappingURL=context-injector.d.ts.map