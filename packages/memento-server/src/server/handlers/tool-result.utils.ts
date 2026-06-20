import type { ToolResult } from '@memento/core';

/**
 * MCP ToolResult content[] → parsed JSON payload (tools.routes / dashboard API 공용)
 */
export function extractToolResultPayload(toolResult: ToolResult): unknown {
  if (toolResult.content && Array.isArray(toolResult.content) && toolResult.content.length > 0) {
    const firstContent = toolResult.content[0];
    if (firstContent && firstContent.text) {
      try {
        return JSON.parse(firstContent.text);
      } catch {
        return toolResult;
      }
    }
  }
  return toolResult;
}
