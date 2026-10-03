import { describe, expect, it } from 'vitest';
import {
  collectMarkdownScriptNames,
  collectNpmRunScriptNames,
  findOrphanScriptNames,
  isReferenceSource,
  collectReferenceScriptNames,
  collectPackageScriptReferences,
  HISTORICAL_NPM_SCRIPT_CITATIONS,
  isHistoricalNpmScriptCitation,
  verifyNpmScriptReferences,
} from '../verify-doc-npm-scripts.mjs';

describe('npm script reference verification', () => {
  it('collects npm script calls from workflow, docs, and script command text', () => {
    const names = collectNpmRunScriptNames(`
      run: npm run quality -- benchmark category-report
      See \`npm run docs:audit-links\`.
      npm run build && npm run test:ci
    `);

    expect([...names]).toEqual(['quality', 'docs:audit-links', 'build', 'test:ci']);
  });

  it('ignores npm-like prose in generated markdown while checking commands and code spans', () => {
    const names = collectMarkdownScriptNames(`
      - content: historical prose says npm run removed-command and npm run test:v…
      \`npm run build\`
      npm run test:ci
    `);

    expect([...names]).toEqual(['test:ci', 'build']);
  });

  it('recognizes bare backticked npm aliases in documentation', () => {
    const names = collectMarkdownScriptNames(
      'Run `quality:benchmark:compare-profiles` before `npm run test:ci`.',
    );

    expect([...names]).toEqual(['test:ci', 'quality:benchmark:compare-profiles']);
  });

  it('does not accept commented commands as reverse references', () => {
    expect([
      ...collectReferenceScriptNames('scripts/example.ts', `
        // npm run hidden:line
        /* npm run hidden:block */
        await run('npm run visible:command');
      `),
    ]).toEqual(['visible:command']);
  });

  it('does not accept verifier tests or fixtures as reverse references', () => {
    expect(
      collectReferenceScriptNames(
        'scripts/__tests__/fixtures/false-reference.ts',
        'npm run hidden:fixture',
      ),
    ).toEqual(new Set());
  });

  it('does not let a package script satisfy itself through its own command', () => {
    expect(
      collectPackageScriptReferences({
        'test:self-only': 'npm run test:self-only -- --run',
        'test:caller': 'npm run test:target',
        'test:target': 'vitest --run',
      }),
    ).toEqual(new Set(['test:target']));
  });

  it('reports unreferenced root scripts while retaining explicit lifecycle hooks', () => {
    expect(
      findOrphanScriptNames(
        new Set(['build', 'unused', 'prepack', 'test:watch', 'test:log-issue-monitor']),
        new Set(['build']),
      ),
    ).toEqual(['unused']);
  });

  it('counts only workflows, documentation, and scripts as reverse references', () => {
    expect(isReferenceSource('.github/workflows/ci.yml')).toBe(true);
    expect(isReferenceSource('docs/agents/commands.md')).toBe(true);
    expect(isReferenceSource('README.md')).toBe(true);
    expect(isReferenceSource('scripts/quality.ts')).toBe(true);
    expect(isReferenceSource('packages/memento-core/src/example.ts')).toBe(false);
    expect(isReferenceSource('specs/legacy-plan.md')).toBe(false);
  });

  it('allows only pinned #1237 historical citations (file + script)', () => {
    for (const entry of HISTORICAL_NPM_SCRIPT_CITATIONS) {
      expect(isHistoricalNpmScriptCitation(entry.file, entry.script)).toBe(true);
    }
    expect(
      isHistoricalNpmScriptCitation('docs/agents/commands.md', 'memory:repair-triple-sentences'),
    ).toBe(false);
    expect(
      isHistoricalNpmScriptCitation('AGENTS.md', 'memory:repair-duplicate-semantic'),
    ).toBe(false);
    expect(isHistoricalNpmScriptCitation('AGENTS.md', 'npm-run:totally-fake')).toBe(false);
  });

  it('verifyNpmScriptReferences has no forward problems for pinned historical citations', () => {
    const result = verifyNpmScriptReferences();
    const historicalPairs = new Set(
      HISTORICAL_NPM_SCRIPT_CITATIONS.map((entry) => `${entry.file}\0${entry.script}`),
    );
    const leakedHistorical = result.forwardProblems.filter((problem) =>
      historicalPairs.has(`${problem.file}\0${problem.script}`),
    );
    expect(leakedHistorical).toEqual([]);
  });

  it('still reports arbitrary unknown npm scripts in markdown', () => {
    const names = collectMarkdownScriptNames('npm run totally-unknown-script-for-ci');
    expect([...names]).toEqual(['totally-unknown-script-for-ci']);
    expect(isHistoricalNpmScriptCitation('docs/agents/commands.md', 'totally-unknown-script-for-ci')).toBe(
      false,
    );
  });
});
