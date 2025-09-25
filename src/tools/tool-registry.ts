/**
 * 도구 등록 및 관리 시스템
 */

import type { ToolDefinition, ToolContext } from './types.js';

export class ToolRegistry {
  private tools: Map<string, ToolDefinition> = new Map();

  /**
   * 도구 등록
   */
  register(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
  }

  /**
   * 도구 등록 (배치)
   */
  registerAll(tools: ToolDefinition[]): void {
    for (const tool of tools) {
      this.register(tool);
    }
  }

  /**
   * 도구 조회
   */
  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  /**
   * 모든 도구 목록 반환
   */
  getAll(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  /**
   * 도구 실행
   */
  async execute(name: string, params: any, context: ToolContext): Promise<any> {
    const tool = this.get(name);
    if (!tool) {
      throw new Error(`Unknown tool: ${name}`);
    }

    return await tool.handler(params, context);
  }

  /**
   * 도구 존재 여부 확인
   */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * 도구 제거
   */
  remove(name: string): boolean {
    return this.tools.delete(name);
  }

  /**
   * 모든 도구 제거
   */
  clear(): void {
    this.tools.clear();
  }

  /**
   * 도구 개수 반환
   */
  size(): number {
    return this.tools.size;
  }

  /**
   * 도구 이름 목록 반환
   */
  getNames(): string[] {
    return Array.from(this.tools.keys());
  }
}
