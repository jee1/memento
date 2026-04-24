import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

type RootPackageJson = {
  bin?: Record<string, string>;
};

function readRootPackageJson(): RootPackageJson {
  const packageJsonPath = join(process.cwd(), 'package.json');
  const raw = readFileSync(packageJsonPath, 'utf-8');
  return JSON.parse(raw) as RootPackageJson;
}

describe('npm publish bin 검증', () => {
  it('루트 bin 엔트리는 workspace 내부 경로를 가리키면 안 된다', () => {
    const packageJson = readRootPackageJson();
    const binEntries = Object.entries(packageJson.bin ?? {});

    const workspaceBinEntries = binEntries.filter(([, targetPath]) => {
      const isWorkspacePath = targetPath.startsWith('./packages/') || targetPath.startsWith('packages/');
      const isDistPath = targetPath.includes('/dist/');
      // dist가 아닌 소스 경로나 직접적인 패키지 루트를 가리키는 것만 금지
      return isWorkspacePath && !isDistPath;
    });

    expect(workspaceBinEntries).toEqual([]);
  });
});
