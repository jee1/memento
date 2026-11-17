import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { definesName, findRemainingMentions, isDistinctiveName, parseDiff } from './check-removed-names.js';

let root: string;
const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
const write = (path: string, text: string) => {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'removed-names-'));
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 't');
  write('src/service.ts', [
    'export class Service {',
    '  calculateConfidence(item: Item): number {',
    '    return 1;',
    '  }',
    '  keepMethodName(): void {',
    '  }',
    '}',
    'export function oldHelperName() {}',
    '',
  ].join('\n'));
  write('docs/guide.md', 'Uses `calculateConfidence` and `oldHelperName`.\n');
  write('docs/adr/0001.md', 'History: calculateConfidence existed.\n');
  write('CHANGELOG.md', '- removed calculateConfidence\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'base');
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('check-removed-names', () => {
  it('reports a removed method that docs still mention, skipping ADR and CHANGELOG', () => {
    write('src/service.ts', ['export class Service {', '  keepMethodName(): void {', '  }', '}', ''].join('\n'));
    const mentions = findRemainingMentions('HEAD', root);
    expect(mentions.map((m) => m.name)).toEqual(['calculateConfidence', 'oldHelperName']);
    expect(mentions.map((m) => m.location)).toEqual(['docs/guide.md:1', 'docs/guide.md:1']);
  });

  it('passes once the docs no longer mention the removed names', () => {
    write('src/service.ts', 'export class Service {}\n');
    write('docs/guide.md', 'Nothing here.\n');
    expect(findRemainingMentions('HEAD', root)).toEqual([]);
  });

  it('ignores a name that is re-added elsewhere in the diff', () => {
    write('src/service.ts', 'export class Service {}\n');
    write('src/other.ts', 'export function oldHelperName() {}\nexport const calculateConfidence = () => 1;\n');
    git('add', '-A');
    expect(findRemainingMentions('HEAD', root)).toEqual([]);
  });

  it('when another class still defines the name, reports docs only and not code calls', () => {
    write('src/other.ts', 'export class Other {\n  private calculateConfidence(n: number): number {\n    return n;\n  }\n}\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'other class');
    write('src/service.ts', 'export class Service {}\n');
    write('src/use.ts', 'new Other().calculateConfidence(1);\nexport const caller = () => oldHelperName;\n');
    git('add', '-A');
    const names = findRemainingMentions('HEAD', root).map((m) => `${m.name} ${m.location}`);
    expect(names).toEqual(['calculateConfidence docs/guide.md:1', 'oldHelperName docs/guide.md:1', 'oldHelperName src/use.ts:2']);
  });

  it('honors --allow for intentional history mentions', () => {
    write('src/service.ts', 'export class Service {}\n');
    expect(findRemainingMentions('HEAD', root, new Set(['calculateConfidence', 'oldHelperName']))).toEqual([]);
  });

  it('skips common words and short names', () => {
    expect(isDistinctiveName('execute')).toBe(false);
    expect(isDistinctiveName('getId')).toBe(false);
    expect(isDistinctiveName('calculateConfidence')).toBe(true);
    expect(isDistinctiveName('MemoryItem')).toBe(true);
    expect(isDistinctiveName('snake_case_name')).toBe(true);
  });

  it('ignores removed lines in spec files and non-code files', () => {
    const diff = [
      '+++ b/src/a.spec.ts',
      '-export function specHelperName() {}',
      '+++ b/docs/x.md',
      '-export function docOnlyName() {}',
      '+++ b/src/a.ts',
      '-export function realRemovedName() {}',
    ].join('\n');
    expect([...parseDiff(diff).removed.keys()]).toEqual(['realRemovedName']);
  });

  it('does not treat calls or imports as definitions', () => {
    expect(definesName('  service.calculateConfidence(item);', 'calculateConfidence')).toBe(false);
    expect(definesName('import { oldHelperName } from "./x.js";', 'oldHelperName')).toBe(false);
    expect(definesName('  calculateConfidence(item: Item): number {', 'calculateConfidence')).toBe(true);
  });
});
