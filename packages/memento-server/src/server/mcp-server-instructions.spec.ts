import { CORE_TOOLSET } from '@memento/core';
import { describe, expect, it } from 'vitest';

import { MEMENTO_SERVER_INSTRUCTIONS } from './mcp-server-factory.js';

describe('server instructions (#1849)', () => {
  it('name exactly the tools listed by default', () => {
    const named = /\(([^)]*)\)/.exec(MEMENTO_SERVER_INSTRUCTIONS)?.[1]?.split(',').map((name) => name.trim());

    expect(named?.sort()).toEqual([...CORE_TOOLSET].sort());
  });
});
