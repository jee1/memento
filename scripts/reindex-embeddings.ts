import { parseArgs as parseCliArgs } from './lib/cli.js';
import { createMementoCore, EmbeddingReindexService, expandHomeDirPath, mementoConfig, shutdownServices, type EmbeddingProvider } from '@memento/core';

function option(name: string): string | undefined {
  const index = parseCliArgs().args.indexOf(name);
  return index >= 0 ? parseCliArgs().args[index + 1] : undefined;
}

/**
 * #1165 임베딩 런타임(onnxruntime-node)이 JS 에서 보이지 않는 libuv 핸들을 남겨,
 * shutdownServices 로 서비스를 다 내려도 프로세스가 끝나지 않는다. 측정에서
 * `process._getActiveHandles()` 는 stdio 소켓 3개뿐이고 `beforeExit` 은 한 번도 발생하지 않는다.
 * `@huggingface/transformers` 4.2 는 세션 해제 API 를 노출하지 않으므로 JS 에서 이 핸들을
 * 내릴 방법이 없다. 그래서 결과를 다 흘려보낸 뒤 명시적으로 종료한다.
 *
 * write 콜백을 기다리는 것이 핵심이다. stdout 이 파이프면 쓰기가 비동기라
 * 곧바로 process.exit 을 부르면 결과 JSON 한 줄이 잘려 나갈 수 있다.
 */
async function writeResultAndExit(output: string): Promise<never> {
  await new Promise<void>((resolve, reject) => {
    process.stdout.write(output, (error) => (error ? reject(error) : resolve()));
  });
  process.exit(process.exitCode ?? 0);
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
  let output = '';
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
      output = `${JSON.stringify({ ...result, candidateCount: ids.length })}\n`;
      if (result.failedCount > 0) process.exitCode = 1;
    } else {
      const result = await service.reindex({ provider, batchSize, ownerId, dryRun, pruneForeignProviders });
      output = `${JSON.stringify(result)}\n`;
      if (result.failedCount > 0) process.exitCode = 1;
    }
  } finally {
    // createMementoCore 가 띄운 배치 스케줄러·워커를 멈추지 않으면 프로세스가 끝나지 않는다.
    await shutdownServices(core.services);
    core.db.close();
  }

  await writeResultAndExit(output);
}

void main();
