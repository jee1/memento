import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import { resolveStaticRoot } from '../packages/memento-server/src/server/http-server.js';

type RootPackageJson = {
  files?: string[];
};

function readRootPackageJson(): RootPackageJson {
  const raw = readFileSync(join(process.cwd(), 'package.json'), 'utf-8');
  return JSON.parse(raw) as RootPackageJson;
}

describe('이슈 #1057 npm 타르볼 static 포함', () => {
  const originalStaticRoot = process.env.MEMENTO_STATIC_ROOT;

  afterEach(() => {
    if (originalStaticRoot === undefined) {
      delete process.env.MEMENTO_STATIC_ROOT;
    } else {
      process.env.MEMENTO_STATIC_ROOT = originalStaticRoot;
    }
  });

  it('files 에 static 이 들어 있어야 한다', () => {
    const files = readRootPackageJson().files ?? [];

    expect(files).toContain('static');
  });

  it('대시보드와 그래프 진입 파일이 static 아래 있어야 한다', () => {
    expect(existsSync(join(process.cwd(), 'static', 'dashboard.html'))).toBe(true);
    expect(existsSync(join(process.cwd(), 'static', 'graph.html'))).toBe(true);
  });

  it('MEMENTO_STATIC_ROOT 가 다른 모든 후보보다 우선한다', () => {
    process.env.MEMENTO_STATIC_ROOT = '/tmp/memento-static-root-override';

    expect(resolveStaticRoot()).toBe('/tmp/memento-static-root-override');
  });

  it('환경변수가 없으면 graph.html 이 실제로 있는 디렉터리를 고른다', () => {
    delete process.env.MEMENTO_STATIC_ROOT;

    const root = resolveStaticRoot();

    expect(existsSync(join(root, 'graph.html'))).toBe(true);
  });
});
