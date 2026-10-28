import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { resolveDirectiveRecallPort } from './resolve-directive-recall.js';

describe('resolveDirectiveRecallPort', () => {
  it('prefers the markdown folder over a live server port', async () => {
    const root = await mkdtemp(join(tmpdir(), 'resolve-cases-'));
    const casesDir = join(root, 'cases');
    await mkdir(casesDir);
    try {
      await writeFile(join(casesDir, 'a.md'), 'Prefer surgical diffs\n', 'utf8');
      const recall = resolveDirectiveRecallPort({
        env: { MEMENTO_DIRECTIVES_CASES_DIR: casesDir },
        home: root,
        serverPort: 9,
        apiKey: 'secret',
      });
      expect(recall).not.toBeNull();
      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      const raw = await recall!(
        { query: 'Prefer surgical diffs please', type: 'semantic', tags: ['case'], limit: 15 },
        AbortSignal.timeout(1000),
      );
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(raw).toMatchObject({
        items: [expect.objectContaining({ content: 'Prefer surgical diffs' })],
      });
      fetchSpy.mockRestore();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('returns null when neither folder nor server is available', () => {
    expect(resolveDirectiveRecallPort({ env: {}, home: '/tmp' })).toBeNull();
  });
});
