import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * #1794: 저장된 임베딩 BLOB 을 푸는 비테스트 파일을 고정한다 (#1020 부류).
 * 새 projection_type(창 행 등)이 생기면 BLOB 을 읽는 경로마다 그 행을 거르는지 점검해야 한다.
 * 목록은 손으로 들되, 목록 밖 파일이 `embeddingColumnToNumbers` 를 부르면 실패한다.
 */

const REPO_ROOT = resolve(import.meta.dirname, '..');
const SCAN_ROOT = 'packages';
const CALL = /\bembeddingColumnToNumbers\s*\(/;

function withoutComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}
const SKIP_DIRS = new Set(['node_modules', 'dist', 'test', 'tests', '__tests__']);

const KNOWN_READERS = [
  'packages/memento-core/src/domains/consolidation/repositories/consolidation-repository.ts',
  'packages/memento-core/src/domains/embedding/services/embedding-migration-service/migration-execution.ts',
  'packages/memento-core/src/domains/embedding/services/embedding-reindex-service.ts',
  'packages/memento-core/src/domains/memory/repositories/memory-item-repository.ts',
  'packages/memento-core/src/shared/utils/current-native-embedding.ts',
  'packages/memento-core/src/shared/utils/embedding-serialization.ts',
  'packages/memento-core/src/shared/utils/type-guards.ts',
];

function walkSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(join(REPO_ROOT, dir))) {
    const rel = join(dir, entry);
    if (statSync(join(REPO_ROOT, rel)).isDirectory()) {
      if (!SKIP_DIRS.has(entry)) files.push(...walkSourceFiles(rel));
    } else if (
      entry.endsWith('.ts') &&
      !entry.endsWith('.d.ts') &&
      !entry.endsWith('.spec.ts') &&
      !entry.endsWith('.test.ts')
    ) {
      files.push(rel);
    }
  }
  return files;
}

describe('embeddingColumnToNumbers 호출 파일 고정 (#1794)', () => {
  it('목록 밖 파일이 저장된 임베딩 BLOB 을 풀지 않는다', () => {
    const readers = walkSourceFiles(SCAN_ROOT)
      .filter((f) => CALL.test(withoutComments(readFileSync(join(REPO_ROOT, f), 'utf-8'))))
      .sort();

    const added = readers.filter((f) => !KNOWN_READERS.includes(f));
    expect(
      added,
      `embeddingColumnToNumbers 를 새로 부르는 파일: ${added.join(', ')}. ` +
        '창 행(projection_type)을 통째로 읽지 않는지 확인하고, current-native-embedding.ts 의 공용 규칙을 쓰거나 ' +
        '확인 뒤 KNOWN_READERS 에 더한다.'
    ).toEqual([]);

    const removed = KNOWN_READERS.filter((f) => !readers.includes(f));
    expect(removed, `더는 호출하지 않는 파일: ${removed.join(', ')}. KNOWN_READERS 에서 지운다.`).toEqual([]);
  });
});
