/**
 * Tool 인터페이스 (JSON Schema 기반)
 * 하는 일: name, description, inputSchema, execute 계약
 * 연관: registry, searchTool, PRD §6
 */

export interface Tool<TInput = unknown> {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute(input: TInput): Promise<ToolResult>;
}

export interface ToolResult {
  summary: string;
  raw?: unknown;
}
