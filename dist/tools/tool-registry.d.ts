/**
 * 도구 등록 및 관리 시스템
 */
import type { ToolDefinition, ToolContext } from './types.js';
export declare class ToolRegistry {
    private tools;
    /**
     * 도구 등록
     */
    register(tool: ToolDefinition): void;
    /**
     * 도구 등록 (배치)
     */
    registerAll(tools: ToolDefinition[]): void;
    /**
     * 도구 조회
     */
    get(name: string): ToolDefinition | undefined;
    /**
     * 모든 도구 목록 반환
     */
    getAll(): ToolDefinition[];
    /**
     * 도구 실행
     */
    execute(name: string, params: any, context: ToolContext): Promise<any>;
    /**
     * 도구 존재 여부 확인
     */
    has(name: string): boolean;
    /**
     * 도구 제거
     */
    remove(name: string): boolean;
    /**
     * 모든 도구 제거
     */
    clear(): void;
    /**
     * 도구 개수 반환
     */
    size(): number;
    /**
     * 도구 이름 목록 반환
     */
    getNames(): string[];
}
//# sourceMappingURL=tool-registry.d.ts.map