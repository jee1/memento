/**
 * 도구 등록 및 관리 시스템
 */
export class ToolRegistry {
    tools = new Map();
    /**
     * 도구 등록
     */
    register(tool) {
        this.tools.set(tool.name, tool);
    }
    /**
     * 도구 등록 (배치)
     */
    registerAll(tools) {
        for (const tool of tools) {
            this.register(tool);
        }
    }
    /**
     * 도구 조회
     */
    get(name) {
        return this.tools.get(name);
    }
    /**
     * 모든 도구 목록 반환
     */
    getAll() {
        return Array.from(this.tools.values());
    }
    /**
     * 도구 실행
     */
    async execute(name, params, context) {
        const tool = this.get(name);
        if (!tool) {
            throw new Error(`Unknown tool: ${name}`);
        }
        return await tool.handler(params, context);
    }
    /**
     * 도구 존재 여부 확인
     */
    has(name) {
        return this.tools.has(name);
    }
    /**
     * 도구 제거
     */
    remove(name) {
        return this.tools.delete(name);
    }
    /**
     * 모든 도구 제거
     */
    clear() {
        this.tools.clear();
    }
    /**
     * 도구 개수 반환
     */
    size() {
        return this.tools.size;
    }
    /**
     * 도구 이름 목록 반환
     */
    getNames() {
        return Array.from(this.tools.keys());
    }
}
//# sourceMappingURL=tool-registry.js.map