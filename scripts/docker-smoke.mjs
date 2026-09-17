/**
 * Docker 이미지 안에서 네이티브 의존과 MiniLM 캐시가 실제로 동작하는지 검증한다 (#996).
 *
 * 테스트와 type-check 로는 이 실패를 잡을 수 없다. sharp 0.35 에는 install script 가 없어
 * prebuilt optional dep 이 빠져도 빌드가 조용히 성공하고 `docker run` 에서야 터진다 (#993).
 *
 * 이미지 안에서 실행하는 것을 전제로 한다:
 *   docker run --rm --entrypoint node <tag> /app/scripts/docker-smoke.mjs
 *
 * Dockerfile 이 `COPY scripts/ ./scripts/` 로 이 파일을 production 스테이지에 이미 넣는다.
 * 별도 마운트로 실행하면 안 된다 — /tmp 에 마운트하면 모듈 해석 기준이 /tmp 가 돼
 * "Cannot find package 'better-sqlite3'" 로 실패한다.
 */

const NATIVE_MODULES = ['better-sqlite3', 'sqlite-vec', 'sharp', 'onnxruntime-node'];

for (const name of NATIVE_MODULES) {
  await import(name);
  console.log(`[smoke] ${name} ok`);
}

// vec0 확장 로드는 런타임에만 드러나는 실패 모드다. 모듈 import 만으로는 통과한다.
const Database = (await import('better-sqlite3')).default;
const sqliteVec = await import('sqlite-vec');
const db = new Database(':memory:');
try {
  sqliteVec.load(db);
  const { version } = db.prepare('select vec_version() as version').get();
  console.log(`[smoke] sqlite-vec extension loaded: ${version}`);
} finally {
  db.close();
}

// allowRemoteModels=false 로 원격 다운로드를 막는다.
// 이미지에 MiniLM 캐시가 구워져 있지 않으면 여기서 실패한다 — Dockerfile 의 warmup 이
// try/catch 로 실패를 삼키기 때문에 이 검증이 warmup 성공을 확인하는 유일한 지점이다.
const { pipeline, env } = await import('@huggingface/transformers');
env.allowRemoteModels = false;
const embed = await pipeline(
  'feature-extraction',
  'Xenova/paraphrase-multilingual-MiniLM-L12-v2',
  { dtype: 'q8' },
);
const output = await embed('smoke');
const dims = output.dims.join('x');
if (output.dims.at(-1) !== 384) {
  throw new Error(`[smoke] unexpected embedding dims: ${dims}`);
}
console.log(`[smoke] MiniLM offline embed ok: dims=${dims}`);
