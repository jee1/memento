/**
 * Docker 이미지 안에서 네이티브 의존과 로컬 임베딩 모델 패키지가 실제로 동작하는지 검증한다 (#996, #1729).
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

// 모델은 런타임과 같은 정의(LOCAL_EMBEDDING_MODEL)로, 모델 패키지 폴더에서 원격을 끈 채 읽는다 (#1729).
// 이미지 안 파일을 게시 때의 sha256 과 먼저 대조한다. 이미지에서는 Dockerfile 이 scripts/model-sha256.json 으로 넣는다.
const { createRequire } = await import('node:module');
const { createHash } = await import('node:crypto');
const { existsSync, readFileSync } = await import('node:fs');
const { dirname, join } = await import('node:path');
const { LOCAL_EMBEDDING_MODEL: model } = await import(
  '../packages/memento-core/dist/shared/config/embedding-models.js'
);
const packageDir = dirname(createRequire(import.meta.url).resolve(`${model.source.packageName}/package.json`));
const hashFile = [
  new URL('./model-sha256.json', import.meta.url),
  new URL('../models/memento-embedding-e5-small-ko-v2/sha256.json', import.meta.url),
].find((url) => existsSync(url));
if (!hashFile) throw new Error('[smoke] model sha256 list not found');
const expected = JSON.parse(readFileSync(hashFile, 'utf8'));
for (const [file, digest] of Object.entries(expected)) {
  const actual = createHash('sha256').update(readFileSync(join(packageDir, file))).digest('hex');
  if (actual !== digest) throw new Error(`[smoke] model file sha256 mismatch: ${file}`);
}
console.log(`[smoke] model package files match sha256: ${Object.keys(expected).length}`);

const { pipeline, env } = await import('@huggingface/transformers');
env.localModelPath = packageDir;
env.allowLocalModels = true;
env.allowRemoteModels = false;
const embed = await pipeline('feature-extraction', model.storedName, {
  dtype: model.source.dtype,
});
const output = await embed('smoke');
const dims = output.dims.join('x');
if (output.dims.at(-1) !== model.dimensions) {
  throw new Error(`[smoke] unexpected embedding dims: ${dims}`);
}
console.log(`[smoke] ${model.storedName} offline embed ok: dims=${dims}`);
