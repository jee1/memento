/**
 * experimental-example: @memento/core를 in-process로 사용하는 최소 예시.
 * createMementoCore로 초기화 후 remember → recall 한 번씩 호출.
 *
 * 연결 방식: 라이브러리(in-process).
 * 의존: @memento/core.
 * 환경: DB_PATH 또는 인자로 dbPath 전달.
 */

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  closeDatabase,
  createMementoCore,
  createToolContext,
  getToolRegistry,
} from '@memento/core';

export async function runExample(dbPath: string): Promise<number> {
  const { db, services } = await createMementoCore({ dbPath });
  const context = createToolContext(db, services);
  const registry = getToolRegistry();

  try {
    await registry.execute(
      'remember',
      {
        content: 'experimental-example에서 저장한 테스트 기억',
        type: 'episodic',
        tags: ['experimental-example', 'demo'],
      },
      context,
    );

    await registry.execute(
      'recall',
      { query: 'experimental-example', type: 'episodic', limit: 5 },
      context,
    );

    return 0;
  } finally {
    await services.runtimeDiagnosticsSamplerCleanup?.();
    closeDatabase(db);
  }
}

export async function main(): Promise<void> {
  const code = await runExample(process.env.DB_PATH ?? ':memory:');
  process.exit(code);
}

const isDirectRun = process.argv[1] !== undefined
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  void main().catch((err: unknown) => {
    const message = err instanceof Error ? (err.stack ?? err.message) : String(err);
    process.stderr.write(`${message}
`);
    process.exit(1);
  });
}
