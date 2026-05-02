import { describe, it, expect } from 'vitest';
import { scopeRecallFilters, scopeRememberTags } from './channel-scope.js';

describe('scoping', () => {
  describe('scopeRecallFilters', () => {
    it('crossChannelRecall=on: leaves tags untouched', () => {
      const out = scopeRecallFilters({ ownerId: 'u', channel: 'tg', crossChannelRecall: 'on' }, {});
      expect(out.tags).toBeUndefined();
      expect(out.ownerId).toBe('u');
    });

    it('crossChannelRecall=off: adds channel tag', () => {
      const out = scopeRecallFilters({ ownerId: 'u', channel: 'tg', crossChannelRecall: 'off' }, {});
      expect(out.tags).toEqual(['channel:tg']);
    });

    it("crossChannelRecall='sameContext' WARNs once and falls back to 'on' (no throw)", () => {
      const warnings: string[] = [];
      const out = scopeRecallFilters(
        { ownerId: 'u', channel: 'tg', crossChannelRecall: 'sameContext' },
        {},
        { warn: (m) => warnings.push(m) }
      );
      expect(out.tags).toBeUndefined();  // fell back to 'on'
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatch(/sameContext/);
    });

    it('preserves user-supplied tags', () => {
      const out = scopeRecallFilters(
        { ownerId: 'u', channel: 'tg', crossChannelRecall: 'off' },
        { tags: ['topic:food'] }
      );
      expect(out.tags).toEqual(expect.arrayContaining(['channel:tg', 'topic:food']));
    });
  });

  describe('scopeRememberTags', () => {
    it('merges userTags + channel + conversation', () => {
      const tags = scopeRememberTags(
        { channel: 'discord', userTags: ['persona:asst'] },
        { conversationId: 'c-42' }
      );
      expect(tags).toEqual(expect.arrayContaining(['channel:discord', 'conv:c-42', 'persona:asst']));
    });

    it('skips channel tag when channel is undefined', () => {
      const tags = scopeRememberTags({}, { conversationId: 'c-1' });
      expect(tags.some(t => t.startsWith('channel:'))).toBe(false);
    });
  });

  describe('edge cases', () => {
    it("channel: '' (empty string) is treated as no channel", () => {
      const out = scopeRecallFilters(
        { ownerId: 'u', channel: '', crossChannelRecall: 'off' },
        {}
      );
      expect(out.tags ?? []).toHaveLength(0);  // no channel tag added for empty string
    });

    it('scopeRememberTags: deduplicates duplicate userTags', () => {
      const tags = scopeRememberTags(
        { channel: 'discord', userTags: ['persona:asst', 'persona:asst'] },
        {}
      );
      expect(tags.filter(t => t === 'persona:asst')).toHaveLength(1);
    });

    it('scopeRecallFilters: deduplicates when channel already in user tags', () => {
      const out = scopeRecallFilters(
        { channel: 'discord', crossChannelRecall: 'off' },
        { tags: ['channel:discord'] }
      );
      expect((out.tags ?? []).filter(t => t === 'channel:discord')).toHaveLength(1);
    });
  });
});
