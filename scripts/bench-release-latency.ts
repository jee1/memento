#!/usr/bin/env node
/**
 * recall, remember, 관계 추출 로컬 구간 wall time p50/p95 를 잰다 (#1490).
 * 두 릴리스를 비교할 때 각 릴리스 worktree 를 빌드하고, 같은 DB 백업의 새 사본마다 한 번씩 돌린다.
 * 질의는 DB 에서 결정적으로 고르고 출력하지 않는다. 출력은 지연 통계 JSON 뿐이다.
 * 관계 추출은 Jev 원격 호출을 즉시 503 으로 막아 후보 조회와 임베딩 사전 필터만 잰다.
 * 운영 .env 를 읽지 않도록 .env 가 없는 디렉터리에서 실행한다.
 *
 *   npx tsx scripts/bench-release-latency.ts --root <worktree> --db <copy.db> [--samples 24] [--rounds 3] [--warmup 5]
 */
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isMain, parseArgs } from './lib/cli.js';

interface Sample {
  readonly id: string;
  readonly type: string;
  readonly content: string;
}

// 측정 대상 worktree 의 @memento/core 만 올리려고 scripts/lib 의 백분위 헬퍼(이 저장소 core 를 import)를 쓰지 않는다.
function latencyStats(samplesMs: number[]) {
  const sorted = [...samplesMs].sort((a, b) => a - b);
  const nearestRank = (p: number) => sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)];
  const round = (ms: number) => Math.round(ms * 10) / 10;
  return {
    n: samplesMs.length,
    p50: round(nearestRank(50)),
    p95: round(nearestRank(95)),
    mean: round(samplesMs.reduce((sum, ms) => sum + ms, 0) / samplesMs.length),
  };
}

async function timed(fn: () => Promise<unknown>): Promise<number> {
  const started = performance.now();
  await fn();
  return performance.now() - started;
}

const silentHost = {
  logInfo: () => undefined,
  logWarning: () => undefined,
  logError: () => undefined,
  createSuccessResult: (data: unknown) => data,
  createErrorResult: (error: string) => ({ error }),
};

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      root: { type: 'string' },
      db: { type: 'string' },
      samples: { type: 'string', default: '24' },
      rounds: { type: 'string', default: '3' },
      warmup: { type: 'string', default: '5' },
    },
  });
  if (typeof values.root !== 'string' || typeof values.db !== 'string') {
    throw new Error('--root and --db are required');
  }
  const sampleCount = Number(values.samples);
  const rounds = Number(values.rounds);
  const warmup = Number(values.warmup);
  process.env.LLM_PROVIDER_RELATION_EXTRACTION = 'jev';
  process.env.TYPESAFE_API_KEY = 'bench-stub';
  const realFetch = globalThis.fetch;
  globalThis.fetch = (input, init) =>
    String(input instanceof Request ? input.url : input).includes('typesafe.ai')
      ? Promise.resolve(new Response('{}', { status: 503 }))
      : realFetch(input, init);

  const coreDist = join(values.root, 'packages/memento-core/dist');
  const core = await import(pathToFileURL(join(coreDist, 'index.js')).href);
  const helpers = await import(
    pathToFileURL(join(coreDist, 'domains/memory/remember/remember-tool-db-helpers.js')).href
  );
  const extraction = await import(
    pathToFileURL(join(coreDist, 'domains/relation/services/remember-relation-extraction.js')).href
  );

  const { db, services } = await core.createMementoCore({ dbPath: values.db });
  const context = core.createToolContext(db, services);

  const pick = (offset: number): Sample[] =>
    db
      .prepare(
        `SELECT m.id, m.type, m.content FROM memory_item m
         WHERE m.is_deleted = 0 AND length(m.content) >= 40
           AND EXISTS (SELECT 1 FROM memory_embedding e WHERE e.memory_id = m.id AND e.embedding_provider = 'minilm')
         ORDER BY m.id LIMIT ? OFFSET ?`,
      )
      .all(sampleCount, offset) as Sample[];
  const recallSamples = pick(0);
  const rememberSamples = pick(sampleCount);
  const query = (content: string) => content.replace(/\s+/g, ' ').trim().split(' ').slice(0, 8).join(' ');

  const recall = (sample: Sample) => core.executeTool('recall', { query: query(sample.content), type: sample.type, limit: 10 }, context);
  const relationOutcomes: Record<string, number> = {};
  const candidates = async (sample: Sample) => {
    const existing = await helpers.getExistingMemoriesForRelationExtraction(db, sample.id, 100, silentHost);
    const source = await helpers.getMemoryById(db, sample.id, silentHost);
    const outcome = await extraction.extractForRemember(source, existing, core.mementoConfig);
    relationOutcomes[outcome.status] = (relationOutcomes[outcome.status] ?? 0) + 1;
  };

  for (const sample of recallSamples.slice(0, warmup)) {
    await recall(sample);
    await candidates(sample);
  }

  const recallMs: number[] = [];
  const candidateMs: number[] = [];
  for (let round = 0; round < rounds; round++) {
    for (const sample of recallSamples) recallMs.push(await timed(() => recall(sample)));
    for (const sample of recallSamples) candidateMs.push(await timed(() => candidates(sample)));
  }

  const rememberMs: number[] = [];
  for (let round = 0; round < rounds; round++) {
    for (const sample of rememberSamples) {
      const content = `bench ${round}: ${sample.content.slice(0, 400)}`;
      rememberMs.push(await timed(() => core.executeTool('remember', { content, type: 'episodic' }, context)));
    }
  }

  console.log(
    JSON.stringify({
      root: values.root,
      recall: latencyStats(recallMs),
      remember: latencyStats(rememberMs),
      relation_local: latencyStats(candidateMs),
      relation_outcomes: relationOutcomes,
    }),
  );
  await core.shutdownServices?.(services).catch(() => undefined);
  core.closeDatabase(db);
}

if (isMain(import.meta.url)) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
