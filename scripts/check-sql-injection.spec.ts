import { describe, expect, it } from 'vitest';
import { withoutBaseline, type SqlInjectionLocation } from './check-sql-injection.js';

const loc = (context: string, line = 1): SqlInjectionLocation => ({
  file: '/repo/packages/a.ts',
  line,
  column: 1,
  pattern: 'where-template-literal',
  context,
  severity: 'high',
});

describe('withoutBaseline', () => {
  it('drops reviewed findings regardless of line shifts and keeps new ones', () => {
    const baseline = ['packages/a.ts|where-template-literal|WHERE ${safe}'];
    const fresh = withoutBaseline([loc('WHERE ${safe}', 40), loc('WHERE ${raw}')], '/repo', baseline);
    expect(fresh.map((l) => l.context)).toEqual(['WHERE ${raw}']);
  });

  it('only absorbs as many duplicates as were reviewed', () => {
    const baseline = ['packages/a.ts|where-template-literal|WHERE ${safe}'];
    const fresh = withoutBaseline([loc('WHERE ${safe}', 1), loc('WHERE ${safe}', 9)], '/repo', baseline);
    expect(fresh.map((l) => l.line)).toEqual([9]);
  });
});
