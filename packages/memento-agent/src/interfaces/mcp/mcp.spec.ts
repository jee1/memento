import { describe, it, expect } from 'vitest';
import { AGENT_ASK_TOOL } from './ask-tool.js';

describe('agent_ask MCP tool definition', () => {
  it('has correct name', () => {
    expect(AGENT_ASK_TOOL.name).toBe('agent_ask');
  });

  it('requires query parameter', () => {
    const schema = AGENT_ASK_TOOL.inputSchema as { required: string[] };
    expect(schema.required).toContain('query');
  });
});
