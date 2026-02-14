/**
 * Tool Registry
 * 하는 일: 툴 등록/조회, 확장 시 등록만으로 추가
 * 연관: baseTool, searchTool, actionableLoop
 */

import type { Tool } from './baseTool.js';

export class ToolRegistry {
  private tools = new Map<string, Tool>();

  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  getAll(): Tool[] {
    return Array.from(this.tools.values());
  }
}
