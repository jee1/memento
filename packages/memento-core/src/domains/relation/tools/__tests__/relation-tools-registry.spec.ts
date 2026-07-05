import { describe, expect, it } from 'vitest';
import { getAllTools } from '../../../../tools/index.js';

describe('relation tools registry', () => {
  it('add_relation, get_relations, remove_relation이 getAllTools()에 등록되어 있다', () => {
    const names = getAllTools().map(t => t.name);
    expect(names).toContain('add_relation');
    expect(names).toContain('get_relations');
    expect(names).toContain('remove_relation');
  });
});
