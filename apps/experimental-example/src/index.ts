/**
 * experimental-example: @memento/core를 in-process로 사용하는 최소 예시.
 * createMementoCore로 초기화 후 remember → recall 한 번씩 호출.
 *
 * 연결 방식: 라이브러리(in-process).
 * 의존: @memento/core.
 * 환경: DB_PATH 또는 인자로 dbPath 전달.
 */

import {
  createMementoCore,
  createToolContext,
  getToolRegistry,
  closeDatabase
} from '@memento/core';

const dbPath = process.env.DB_PATH ?? ':memory:';

async function main(): Promise<void> {
  console.log('Initializing @memento/core with dbPath:', dbPath);
  const { db, services } = await createMementoCore({ dbPath });
  const context = createToolContext(db, services);
  const registry = getToolRegistry();

  try {
    const rememberResult = await registry.execute(
      'remember',
      {
        content: 'experimental-example에서 저장한 테스트 기억',
        type: 'episodic',
        tags: ['experimental-example', 'demo']
      },
      context
    );
    console.log('remember result:', rememberResult?.content?.length ? '(content present)' : rememberResult);

    const recallResult = await registry.execute(
      'recall',
      { query: 'experimental-example', limit: 5 },
      context
    );
    const items = recallResult && typeof recallResult === 'object' && 'items' in recallResult
      ? (recallResult as unknown as { items: unknown[] }).items
      : [];
    console.log('recall result items:', Array.isArray(items) ? items.length : 0);
  } finally {
    await services.runtimeDiagnosticsSamplerCleanup?.();
    closeDatabase(db);
    console.log('Done.');
    process.exit(0);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
