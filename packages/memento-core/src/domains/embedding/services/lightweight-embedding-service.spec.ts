import { inspect } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LightweightEmbeddingService } from './lightweight-embedding-service.js';

describe('LightweightEmbeddingService.generateEmbedding', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps unmasked PII out of the thrown error and its inspect output', async () => {
    vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    const service = new LightweightEmbeddingService();
    vi.spyOn(service as unknown as { preprocessText(text: string): string }, 'preprocessText')
      .mockImplementation(() => {
        throw new Error('tokenizer failed for alice@example.com');
      });

    const error = await service.generateEmbedding('hello').catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).cause).toBeUndefined();
    expect(inspect(error)).not.toContain('alice@example.com');
    expect((error as Error).message).toContain('[EMAIL]');
  });
});
