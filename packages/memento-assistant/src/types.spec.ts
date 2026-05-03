import { describe, it, expectTypeOf } from 'vitest';
import type { ExtractedItem, Policy, MementoAssistantOptions } from './types.js';

describe('types', () => {
  it('ExtractedItem union excludes commitment kind (v0.1)', () => {
    type Kinds = ExtractedItem['kind'];
    expectTypeOf<Kinds>().toEqualTypeOf<'fact' | 'preference' | 'event'>();
    // @ts-expect-error - commitment is not allowed in v0.1
    const _bad: ExtractedItem = { kind: 'commitment', content: 'x' };
  });

  it('Policy.crossChannelRecall accepts sameContext (handled at runtime)', () => {
    const p: Policy = { crossChannelRecall: 'sameContext' } as Policy;
    expectTypeOf(p.crossChannelRecall).toEqualTypeOf<'on' | 'off' | 'sameContext' | undefined>();
  });

  it('MementoAssistantOptions has minimal required fields', () => {
    expectTypeOf<MementoAssistantOptions>().toMatchTypeOf<{
      ownerId?: string; channel?: string; userTags?: string[]; policy?: Policy;
    }>();
  });
});
