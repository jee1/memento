/**
 * #1155 · #1156: 마이그레이션이 고친 본문의 임베딩을 배포판 사용자가 갱신할 수 있어야 하고,
 * 그 갱신이 서버 시작 경로에 들어와서는 안 된다.
 *
 * 워크스페이스 소스를 import 하지 않는다. 루트 `tests/` 는 패키지를 빌드하지 않고 도는 잡이라
 * import 하면 CI 에서만 `Failed to resolve entry for package` 로 깨진다.
 */
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

const MIGRATIONS_DIR = join(
  'packages',
  'memento-core',
  'src',
  'infrastructure',
  'database',
  'sqlite',
  'migration',
  'migrations',
);

const SHIPPED_REINDEX_SOURCE = join(
  'packages',
  'memento-server',
  'src',
  'scripts',
  'reindex-embeddings.ts',
);

function readRepoFile(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf-8');
}

function readRootPackageJson(): { files?: string[] } {
  return JSON.parse(readRepoFile('package.json')) as { files?: string[] };
}

describe('#1155 배포판 사용자가 재색인을 실행할 수 있다', () => {
  it('재색인 진입점이 dist 로 빌드되는 위치에 있다', () => {
    expect(existsSync(join(process.cwd(), SHIPPED_REINDEX_SOURCE))).toBe(true);
  });

  it('files 에 dist 가 있어 그 진입점이 발행 tarball 에 실린다', () => {
    expect(readRootPackageJson().files ?? []).toContain('dist');
  });

  it('배포 진입점은 tarball 에 없는 scripts/lib 헬퍼를 쓰지 않는다', () => {
    const source = readRepoFile(SHIPPED_REINDEX_SOURCE);

    expect(source).not.toContain('./lib/cli');
    expect(source).not.toContain('scripts/lib');
  });
});

describe('#1155 · #1156 마이그레이션은 임베딩을 만들지 않는다 (서버 시작 비블록)', () => {
  const migrations = [
    '048-repair-duplicate-semantic-content.ts',
    '049-repair-triple-sentence-memories.ts',
  ];

  it.each(migrations)('%s 는 임베딩 서비스를 import 하지 않는다', (fileName) => {
    const source = readRepoFile(join(MIGRATIONS_DIR, fileName));

    expect(source).not.toContain('EmbeddingService');
    expect(source).not.toContain('EmbeddingReindexService');
    expect(source).not.toContain('createAndStoreEmbedding');
  });

  it.each(migrations)('%s 는 발행 tarball 에 없는 scripts/ 를 import 하지 않는다', (fileName) => {
    const source = readRepoFile(join(MIGRATIONS_DIR, fileName));

    expect(source).not.toMatch(/from\s+['"][^'"]*\/scripts\//);
  });
});
