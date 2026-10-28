import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runDirectives } from './engine.js';
import {
  createMarkdownDirectiveRecallPort,
  parseMarkdownCases,
  scoreCaseAgainstQuery,
} from './markdown-recall.js';
import { parseRecallItems } from './select.js';

describe('parseMarkdownCases', () => {
  it('treats each non-empty non-heading line as one case and skips frontmatter', () => {
    const cases = parseMarkdownCases(
      '---\ntitle: rules\n---\n# Title\nrisk:low PR merges after CI\n\nPrefer surgical diffs\n',
      'rules.md',
    );
    expect(cases.map((c) => c.content)).toEqual([
      'risk:low PR merges after CI',
      'Prefer surgical diffs',
    ]);
    expect(new Set(cases.map((c) => c.memory_id)).size).toBe(2);
  });
});

describe('scoreCaseAgainstQuery', () => {
  it('scores 1 when every case token appears in the query', () => {
    expect(scoreCaseAgainstQuery(
      'please Prefer surgical diffs in this PR',
      'Prefer surgical diffs',
    )).toBe(1);
  });

  it('scores 0.5 when half the case tokens appear in the query', () => {
    expect(scoreCaseAgainstQuery('surgical only', 'surgical diffs')).toBe(0.5);
  });
});

describe('createMarkdownDirectiveRecallPort', () => {
  it('returns the same recall shape as the server port for runDirectives', async () => {
    const root = await mkdtemp(join(tmpdir(), 'md-cases-'));
    const logDir = join(root, 'log');
    const casesDir = join(root, 'cases');
    await mkdir(casesDir);
    await mkdir(logDir);
    try {
      await writeFile(
        join(casesDir, 'git.md'),
        'risk:low PR merges after CI passes\nunrelated noise about weather\n',
        'utf8',
      );
      const recall = createMarkdownDirectiveRecallPort(casesDir);
      const raw = await recall(
        { query: 'should I merge this risk:low PR after CI', type: 'semantic', tags: ['case'], limit: 15 },
        AbortSignal.timeout(1000),
      );
      const items = parseRecallItems(raw);
      expect(items[0]?.text).toContain('risk:low PR merges after CI');
      expect(items[0]?.final_score).toBeGreaterThanOrEqual(0.5);

      const stdout = await runDirectives({
        eventType: 'USER_PROMPT',
        sessionId: 's1',
        cwd: '/repo',
        prompt: 'should I merge this risk:low PR after CI',
      }, {
        config: { enabled: true, mode: 'live', pinnedFile: null, logDir },
        recall,
        now: () => 1_700_000_000_000,
      });
      const parsed = JSON.parse(stdout) as {
        hookSpecificOutput: { additionalContext: string };
      };
      expect(parsed.hookSpecificOutput.additionalContext).toContain('- risk:low PR merges after CI');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('throws when the abort signal is already aborted', async () => {
    const recall = createMarkdownDirectiveRecallPort('/tmp');
    const signal = AbortSignal.abort();
    await expect(recall(
      { query: 'x', type: 'semantic', tags: ['case'], limit: 15 },
      signal,
    )).rejects.toThrow(/abort/);
  });
});
