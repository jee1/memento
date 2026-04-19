import { describe, expect, it } from 'vitest';

import { createMockDatabase } from './mock-database';

describe('MockDatabase', () => {
  it('returns the memory_item_fts row count for count queries', () => {
    const database = createMockDatabase();

    expect(database.prepare('SELECT COUNT(*) as count FROM memory_item_fts').get()).toEqual({ count: 2 });
  });
});
