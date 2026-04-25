import { describe, it, expect, vi } from 'vitest';

vi.mock('../../core/agent-core.js', () => ({
  AgentCore: vi.fn().mockImplementation(() => ({
    ask: vi.fn().mockResolvedValue({
      answer: 'test answer',
      usedMemories: [],
      searchResults: [],
    }),
  })),
}));

vi.mock('@memento/client', () => ({
  MementoClient: vi.fn().mockImplementation(() => ({})),
}));

describe('CLI parseArgs', () => {
  it('extracts query from argv', async () => {
    const { parseArgs } = await import('./index.js');
    const result = parseArgs(['node', 'memento-agent', 'ask', 'my question here']);
    expect(result.query).toBe('my question here');
    expect(result.useSearch).toBe(true);
  });

  it('--no-search disables search', async () => {
    const { parseArgs } = await import('./index.js');
    const result = parseArgs(['node', 'memento-agent', 'ask', '--no-search', 'my question']);
    expect(result.useSearch).toBe(false);
  });
});
