import { describe, expect, it, vi } from 'vitest';
import { LocalEmbeddingService } from '../local-embedding-service.js';

// 지금 모델의 접두는 빈 문자열이다. 전환 PR 의 모양(역할 접두가 있는 모델)을 여기서 미리 고정한다 (#1729).
vi.mock('../../../../shared/config/embedding-models.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../shared/config/embedding-models.js')>();
  return {
    ...actual,
    LOCAL_EMBEDDING_MODEL: {
      ...actual.LOCAL_EMBEDDING_MODEL,
      prefixes: { query: 'query: ', passage: 'passage: ' },
    },
  };
});

const PREFIX_TOKENS: Record<string, number> = { 'query: ': 2, 'passage: ': 3 };

function installModel(service: LocalEmbeddingService, textTokens: number) {
  const tokenizer = Object.assign(
    vi.fn(async (text: string) => ({
      input_ids: { data: Array.from({ length: PREFIX_TOKENS[text] ?? textTokens }, (_, i) => i + 1) },
    })),
    { decode: vi.fn((ids: number[]) => `w${ids.length}@${ids[0]}`) }
  );
  const model = Object.assign(
    vi.fn(async () => ({ data: new Array(384).fill(0.1) })),
    { tokenizer }
  );
  (service as unknown as { model: unknown }).model = model;
  return { model, tokenizer };
}

describe('LocalEmbeddingService 역할 접두 (#1729)', () => {
  it('기억 벡터는 창마다 passage 접두를 붙이고 창 크기는 510 - 3 = 507 이다', async () => {
    const service = new LocalEmbeddingService();
    const { model, tokenizer } = installModel(service, 1100);

    const result = await service.generateWindowEmbeddings('long text');

    expect(model.mock.calls.map(([input]) => input)).toEqual([
      'passage: w507@1',
      'passage: w507@508',
      'passage: w86@1015',
    ]);
    expect(result.tokenCount).toBe(1100);
    expect(tokenizer).toHaveBeenCalledWith('passage: ', { add_special_tokens: false, truncation: false });
  });

  it('질의 벡터는 query 접두를 붙이고 창 크기는 510 - 2 = 508 이다', async () => {
    const service = new LocalEmbeddingService();
    const { model } = installModel(service, 600);

    await service.embedQuery('long query');

    expect(model.mock.calls.map(([input]) => input)).toEqual(['query: w508@1', 'query: w92@509']);
  });

  it('창 하나에 드는 글은 접두와 전처리한 본문을 한 번 넣는다', async () => {
    const service = new LocalEmbeddingService();
    const { model } = installModel(service, 10);

    await service.generateEmbedding('  Hello   World ');
    await service.embedQuery('  Hello   World ');

    expect(model.mock.calls.map(([input]) => input)).toEqual(['passage: hello world', 'query: hello world']);
  });
});
