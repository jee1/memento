import { describe, expect, it } from 'vitest';
import { flattenNestedToolFilters } from '../flatten-tool-params.js';

describe('flattenNestedToolFilters (#754)', () => {
  it('hoists nested filters.tags/type onto top-level (client search-client shape)', () => {
    const out = flattenNestedToolFilters({
      query: 'isolation-only-telegram?',
      filters: { tags: ['channel:discord'], type: ['episodic'] },
      limit: 10,
    }) as Record<string, unknown>;

    expect(out.tags).toEqual(['channel:discord']);
    expect(out.memory_types).toEqual(['episodic']);
    expect(out.query).toBe('isolation-only-telegram?');
    expect(out.limit).toBe(10);
    expect(out.filters).toBeUndefined();
  });

  it('keeps top-level MCP fields when nested filters coexist (top-level wins)', () => {
    const out = flattenNestedToolFilters({
      query: 'q',
      type: 'semantic',
      tags: ['keep-me'],
      filters: { type: ['episodic'], tags: ['channel:tg'] },
    }) as Record<string, unknown>;

    expect(out.type).toBe('semantic');
    expect(out.tags).toEqual(['keep-me']);
    expect(out.memory_types).toBeUndefined();
    expect(out.filters).toBeUndefined();
  });

  it('maps nested ownerId to owner_id when top-level owner_id missing', () => {
    const out = flattenNestedToolFilters({
      query: 'q',
      filters: { ownerId: 'agent-1', tags: ['channel:tg'] },
    }) as Record<string, unknown>;

    expect(out.owner_id).toBe('agent-1');
    expect(out.tags).toEqual(['channel:tg']);
  });

  it('ignores missing filters (pass-through)', () => {
    const input = { query: 'q', tags: ['a'], type: 'episodic' };
    expect(flattenNestedToolFilters(input)).toEqual(input);
  });

  it('ignores malformed filters without throwing (API compat)', () => {
    expect(flattenNestedToolFilters({ query: 'q', filters: 'bad' })).toEqual({ query: 'q' });
    expect(flattenNestedToolFilters({ query: 'q', filters: ['x'] })).toEqual({ query: 'q' });
    expect(flattenNestedToolFilters({ query: 'q', filters: null })).toEqual({ query: 'q' });
    expect(flattenNestedToolFilters(null)).toBeNull();
    expect(flattenNestedToolFilters(undefined)).toBeUndefined();
  });

  it('hoists single-string nested type to top-level type', () => {
    const out = flattenNestedToolFilters({
      query: 'q',
      filters: { type: 'working' },
    }) as Record<string, unknown>;
    expect(out.type).toBe('working');
  });
});
