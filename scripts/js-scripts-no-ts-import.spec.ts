/**
 * `scripts/**` 의 .js 파일은 .ts 모듈을 import 하면 안 된다 (#857).
 *
 * 저장소 안에서는 Node 가 타입을 스트리핑해 주지만, package.json 의 files 에 scripts 가
 * 통째로 들어가므로 같은 파일이 node_modules 하위에서도 실행된다. 거기서는 Node 가 거절한다:
 *
 *   ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING:
 *   Stripping types is currently unsupported for files under node_modules
 *
 * postinstall(`node scripts/auto-setup.js`)이 여기 걸려 npm publish 가 통째로 실패했다.
 * 런타임 헬퍼는 scripts/lib/cli-runtime.js 에서 가져온다.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect } from 'vitest';

import { isMain, parseArgs } from './lib/cli-runtime.js';

const SCRIPTS_DIR = fileURLToPath(new URL('.', import.meta.url));

/** .ts 로 끝나는 상대 경로 모듈 지정자 */
const TS_SPECIFIER = /\bfrom\s+['"](\.[^'"]*\.ts)['"]/g;

function collectJsFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') { continue; }
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      found.push(...collectJsFiles(full));
    } else if (entry.endsWith('.js') || entry.endsWith('.mjs') || entry.endsWith('.cjs')) {
      found.push(full);
    }
  }
  return found;
}

describe('scripts/**/*.js 는 .ts 를 import 하지 않는다 (#857)', () => {
  it('패키지에 실리는 .js 스크립트에 .ts 모듈 지정자가 없다', () => {
    const offenders = collectJsFiles(SCRIPTS_DIR).flatMap(file => {
      const matches = [...readFileSync(file, 'utf8').matchAll(TS_SPECIFIER)];
      return matches.map(match => `${file.slice(SCRIPTS_DIR.length)} → ${match[1]}`);
    });

    expect(offenders).toEqual([]);
  });

  it('cli-runtime 이 .js 스크립트가 쓰는 헬퍼를 제공한다', () => {
    expect(typeof isMain).toBe('function');
    expect(isMain('file:///definitely/not/the/entrypoint.js')).toBe(false);

    const parsed = parseArgs({ args: ['--flag', 'value', 'positional'] });
    expect(parsed.args).toEqual(['--flag', 'value', 'positional']);
    expect(parsed.positionals).toContain('positional');
  });
});
