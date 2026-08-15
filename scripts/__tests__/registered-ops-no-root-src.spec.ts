/**
 * T018 (#750): registered root npm ops scripts must not resolve removed root `src/`.
 */
import { describe, expect, it } from 'vitest';
import {
  findRootSrcImportsInRegisteredOps,
  listRegisteredOpsScriptEntries,
} from './registered-ops-script-paths.js';

describe('T018 registered ops scripts — no root src imports (#750)', () => {
  it('discovers at least one registered ops entry under scripts/', () => {
    const entries = listRegisteredOpsScriptEntries();
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.some((e) => e.entryRel.includes('migrate-embedding-data'))).toBe(true);
  });

  it('has zero ../src/ (or equivalent) imports in registered ops entry graph', () => {
    const hits = findRootSrcImportsInRegisteredOps();
    expect(
      hits,
      hits.length === 0
        ? 'ok'
        : `registered ops still import removed root src/:\n${hits
            .map(
              (h) =>
                `- ${h.fileRel} (npm: ${h.npmScripts.join(', ') || 'transitive'})\n  ${h.matches.join('\n  ')}`
            )
            .join('\n')}`
    ).toEqual([]);
  });
});
