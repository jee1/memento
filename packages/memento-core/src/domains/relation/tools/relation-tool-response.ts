import type { ToolResult } from '../../../tools/types.js';

/** 관계 도구의 실패 응답: `{ success: false, error, message }` 를 JSON 텍스트로 싣는다. */
export function relationToolError(error: string, message: string): ToolResult {
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({ success: false, error, message }, null, 2)
    }]
  };
}
