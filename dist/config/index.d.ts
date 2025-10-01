/**
 * Memento MCP Server 설정 관리
 */
import type { MementoConfig } from '../types/index.js';
export declare const mementoConfig: MementoConfig;
export declare const searchRankingWeights: {
    relevance: number;
    recency: number;
    importance: number;
    usage: number;
    duplication_penalty: number;
};
export declare const defaultTags: {
    tech: string[];
    pref: string[];
    task: string[];
    project: string[];
};
export declare function validateConfig(): void;
//# sourceMappingURL=index.d.ts.map