import { describe, expect, it } from 'vitest';
import {
  formatMementoResourceUri,
  parseMementoResourceUri,
} from '../memento-resource-uri.js';

describe('memento resource URI', () => {
  it('formats and parses every supported resource kind', () => {
    for (const kind of ['memory', 'procedure', 'anchor', 'relation'] as const) {
      const uri = formatMementoResourceUri({ ownerId: 'agent-a', kind, id: 'resource-1' });

      expect(uri).toBe(`memento://agent-a/${kind}/resource-1`);
      expect(parseMementoResourceUri(uri)).toEqual({ ownerId: 'agent-a', kind, id: 'resource-1' });
    }
  });

  it('uses default owner and percent-encodes URI components', () => {
    const uri = formatMementoResourceUri({ ownerId: null, kind: 'memory', id: 'mem/a b%' });

    expect(uri).toBe('memento://default/memory/mem%2Fa%20b%25');
    expect(parseMementoResourceUri(uri)).toEqual({ ownerId: 'default', kind: 'memory', id: 'mem/a b%' });
  });

  it.each([
    'memory://mem_1',
    'memento://agent-a/unknown/mem_1',
    'memento://agent-a/memory',
    'memento:///memory/mem_1',
    'memento://agent-a/memory/mem_1/extra',
  ])('rejects invalid canonical URI %s', (uri) => {
    expect(() => parseMementoResourceUri(uri)).toThrow('Invalid Memento resource URI');
  });

  it('rejects unsupported resource kinds while formatting', () => {
    expect(() =>
      formatMementoResourceUri({
        ownerId: 'default',
        kind: 'unknown' as never,
        id: 'mem_test',
      })
    ).toThrow('Unsupported Memento resource kind');
  });
});
