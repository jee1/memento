#!/usr/bin/env node
/**
 * 임베딩 재색인 — 배포판 사용자용 진입점 (#1155)
 *
 * 마이그레이션 048·049 는 `memory_item.content` 를 고치지만 임베딩은 다시 만들지 않는다.
 * 임베딩 모델을 마이그레이션 트랜잭션 안에서 로드하면 서버 시작이 블록되고 쓰기 락이 길게 잡히기
 * 때문이다. 그래서 갱신은 서버 밖에서 도는 이 스크립트가 맡는다.
 *
 * 저장소 체크아웃의 `scripts/reindex-embeddings.ts` 와 동작이 같다. 그 파일은 `tsx` 로만 돌고
 * npm 발행 tarball 의 `files` 에도 없어서 설치해 쓰는 사용자에게 도달하지 않는다. 이 파일은
 * 빌드되면 `dist/scripts/reindex-embeddings.js` 가 되고 `dist` 는 `files` 에 있으므로 도달한다.
 *
 * 사용법:
 *   DB_PATH=./data/memory.db node dist/scripts/reindex-embeddings.js --dry-run
 *   DB_PATH=./data/memory.db node dist/scripts/reindex-embeddings.js
 *   DB_PATH=./data/memory.db node dist/scripts/reindex-embeddings.js --only-truncated
 */

import {
  createMementoCore,
  EmbeddingReindexService,
  expandHomeDirPath,
  mementoConfig,
  shutdownServices,
  type EmbeddingProvider,
} from '@memento/core';

const args = process.argv.slice(2);

function option(name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
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
  const onlyTruncated = args.includes('--only-truncated');
  const provider = (option('--provider') ?? mementoConfig.embeddingProvider) as EmbeddingProvider;
  const batchSize = Number(option('--batch-size') ?? '100');
  const ownerId = option('--owner-id');
  const dryRun = args.includes('--dry-run');
  // #907 기본값 off. 켜면 재색인에 성공한 기억의 다른 provider native 임베딩을 지운다.
  const pruneForeignProviders = args.includes('--prune-foreign-providers');

  const core = await createMementoCore({
    dbPath: expandHomeDirPath(process.env.DB_PATH ?? mementoConfig.dbPath),
  });
  let output = '';

  try {
    const service = new EmbeddingReindexService(core.db, core.services.embeddingService);

    if (onlyTruncated) {
      // #1013 으로 벡터가 실제로 달라지는 기억만 고른다. 한 윈도(510토큰)에 들어가고
      // 예전 문자 컷(1024자)에도 걸리지 않았던 기억은 재색인해도 같은 벡터가 나온다.
      const rows = core.db
        .prepare('SELECT id, content FROM memory_item WHERE COALESCE(is_deleted, 0) = 0')
        .all() as { id: string; content: string }[];
      const ids = rows
        .filter((row) => row.content.trim().replace(/\s+/g, ' ').length > 800)
        .map((row) => row.id);
      const result = await service.reindexByIds(ids, { provider, dryRun });
      output = `${JSON.stringify({ ...result, candidateCount: ids.length })}\n`;
      if (result.failedCount > 0) process.exitCode = 1;
    } else {
      const result = await service.reindex({
        provider,
        batchSize,
        ownerId,
        dryRun,
        pruneForeignProviders,
      });
      output = `${JSON.stringify(result)}\n`;
      if (result.failedCount > 0) process.exitCode = 1;
    }
  } finally {
    // createMementoCore 가 띄운 배치 스케줄러·워커를 멈추지 않으면 프로세스가 끝나지 않고
    // 닫힌 DB 에 계속 붙는다.
    await shutdownServices(core.services);
    core.db.close();
  }

  await writeResultAndExit(output);
}

void main();
