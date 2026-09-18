import { parseArgs as parseCliArgs } from './lib/cli.js';
import { createMementoCore, EmbeddingReindexService, expandHomeDirPath, mementoConfig, type EmbeddingProvider } from '@memento/core';

function option(name: string): string | undefined {
  const index = parseCliArgs().args.indexOf(name);
  return index >= 0 ? parseCliArgs().args[index + 1] : undefined;
}

async function main(): Promise<void> {
  const onlyTruncated = parseCliArgs().args.includes('--only-truncated');
  const provider = (option('--provider') ?? mementoConfig.embeddingProvider) as EmbeddingProvider;
  const batchSize = Number(option('--batch-size') ?? '100');
  const ownerId = option('--owner-id');
  const dryRun = parseCliArgs().args.includes('--dry-run');
  // #907 기본값 off. 켜면 재색인에 성공한 기억의 다른 provider native 임베딩을 지운다.
  const pruneForeignProviders = parseCliArgs().args.includes('--prune-foreign-providers');
  const core = await createMementoCore({
    dbPath: expandHomeDirPath(process.env.DB_PATH ?? mementoConfig.dbPath),
  });
  try {
    const service = new EmbeddingReindexService(core.db, core.services.embeddingService);
    if (onlyTruncated) {
      // #1013 으로 벡터가 실제로 달라지는 기억만 고른다. 한 윈도(510토큰)에 들어가고
      // 예전 문자 컷(1024자)에도 걸리지 않았던 기억은 재색인해도 같은 벡터가 나온다.
      //
      // 문자 길이로만 고른다. 토큰 수 추정은 이 코퍼스에서 여전히 과소 계산돼서
      // (코드 식별자 같은 ASCII 가 서브워드로 잘게 쪼개진다) 기준으로 쓸 수 없다.
      // 운영 DB 8,903건 실측: 실제로 바뀌는 것은 369건이고, 510토큰을 넘는 기억의
      // 최소 길이가 997자였다. 800자는 그 위로 여유를 둔 상위집합이다(611건).
      // 상위집합이라 몇 건을 같은 벡터로 다시 써도 무해하고, 놓치는 쪽이 훨씬 나쁘다.
      const rows = core.db.prepare(
        'SELECT id, content FROM memory_item WHERE COALESCE(is_deleted, 0) = 0'
      ).all() as { id: string; content: string }[];
      const ids = rows
        .filter((row) => row.content.trim().replace(/\s+/g, ' ').length > 800)
        .map((row) => row.id);
      const result = await service.reindexByIds(ids, { provider, dryRun });
      process.stdout.write(`${JSON.stringify({ ...result, candidateCount: ids.length })}\n`);
      if (result.failedCount > 0) process.exitCode = 1;
      return;
    }
    const result = await service.reindex({ provider, batchSize, ownerId, dryRun, pruneForeignProviders });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (result.failedCount > 0) process.exitCode = 1;
  } finally {
    core.db.close();
  }
}

void main();
