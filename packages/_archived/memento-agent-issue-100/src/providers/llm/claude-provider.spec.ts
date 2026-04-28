import { describe, it, expect, vi } from 'vitest';

const { mockCreate } = vi.hoisted(() => ({
  mockCreate: vi.fn().mockResolvedValue({
    content: [{ type: 'text', text: 'Hello from Claude' }],
  }),
}));

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: mockCreate };
  },
}));

import { ClaudeProvider } from './claude-provider.js';

describe('ClaudeProvider', () => {
  it('returns text from API response', async () => {
    const provider = new ClaudeProvider('fake-key');
    const result = await provider.complete([
      { role: 'user', content: 'Hello' },
    ]);
    expect(result).toBe('Hello from Claude');
  });
});
