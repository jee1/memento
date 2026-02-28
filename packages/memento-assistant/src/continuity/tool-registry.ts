import type { AssistantToolDefinition, AssistantToolContext, AssistantToolResult } from './tools/types.js';

export class AssistantToolRegistry {
  private tools = new Map<string, AssistantToolDefinition>();

  register(tool: AssistantToolDefinition): void {
    this.tools.set(tool.name, tool);
  }

  registerAll(tools: AssistantToolDefinition[]): void {
    for (const t of tools) this.register(t);
  }

  get(name: string): AssistantToolDefinition | undefined {
    return this.tools.get(name);
  }

  getAll(): AssistantToolDefinition[] {
    return Array.from(this.tools.values());
  }

  async execute(name: string, params: unknown, context: AssistantToolContext): Promise<AssistantToolResult> {
    const tool = this.get(name);
    if (!tool) throw new Error(`Unknown tool: ${name}`);
    return tool.handler(params, context);
  }
}
