import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { probeNativeModule } from './auto-setup.js';

const roots = [];

/** 가짜 프로젝트 루트에 패키지를 하나 깔고, 거기서 해석하는 require 를 돌려준다. */
function fakeProject(name, source) {
  const root = mkdtempSync(join(tmpdir(), 'memento-auto-setup-'));
  roots.push(root);
  writeFileSync(join(root, 'package.json'), '{"name":"fake-root"}');

  const dir = join(root, 'node_modules', name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, version: '0.0.0', main: 'index.cjs' }));
  writeFileSync(join(dir, 'index.cjs'), source);

  return { dir, require: createRequire(join(root, 'package.json')) };
}

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

describe('#876 auto-setup native module probe', () => {
  it('detects a package whose directory exists but whose bindings are missing', () => {
    // `npm ci --ignore-scripts` 가 만드는 상태: 디렉터리는 있고 컴파일 산출물만 없다.
    const fake = fakeProject(
      'better-sqlite3',
      `module.exports = function Database() {
         throw new Error('Could not locate the bindings file. Tried: ...better_sqlite3.node');
       };`,
    );

    // 예전 검사는 이것만 봤다 — 그래서 항상 통과했다
    expect(existsSync(fake.dir)).toBe(true);

    const failure = probeNativeModule('better-sqlite3', fake.require);
    expect(failure).toBeInstanceOf(Error);
    expect(failure.message).toContain('Could not locate the bindings file');
  });

  it('returns null when the module actually loads', () => {
    const fake = fakeProject(
      'better-sqlite3',
      `module.exports = function Database() { this.close = function () {}; };`,
    );

    expect(probeNativeModule('better-sqlite3', fake.require)).toBeNull();
  });

  it('detects sqlite-vec whose platform extension is not installed', () => {
    // sqlite-vec 는 require 시점에 아무것도 열지 않는다 — getLoadablePath() 를 불러야 드러난다
    const fake = fakeProject(
      'sqlite-vec',
      `module.exports = {
         getLoadablePath() { throw new Error('Loadble extension for sqlite-vec not found.'); },
       };`,
    );

    const failure = probeNativeModule('sqlite-vec', fake.require);
    expect(failure).toBeInstanceOf(Error);
    expect(failure.message).toContain('sqlite-vec not found');
  });

  it('reports a missing package instead of throwing', () => {
    const fake = fakeProject('unrelated', 'module.exports = {};');

    const failure = probeNativeModule('not-installed-at-all', fake.require);
    expect(failure).toBeInstanceOf(Error);
    expect(failure.message).toContain('not-installed-at-all');
  });

  it('loads the real better-sqlite3 and sqlite-vec in this checkout', () => {
    expect(probeNativeModule('better-sqlite3')).toBeNull();
    expect(probeNativeModule('sqlite-vec')).toBeNull();
  });
});
