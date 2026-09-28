/**
 * #1165 재색인 진입점은 해제할 수 없는 핸들이 남아 있어도 프로세스를 끝내야 한다.
 *
 * 임베딩 런타임(onnxruntime-node)은 JS 에서 보이지 않는 libuv 핸들을 남기고, 그 런타임은
 * 세션 해제 API 를 노출하지 않는다. CI 에는 모델 캐시가 없어 진짜 재색인을 돌릴 수 없으므로,
 * `--import` 로 절대 끝나지 않는 타이머를 하나 심어 그 핸들의 대역으로 삼는다.
 * 진입점이 명시적으로 종료하지 않으면 이 테스트는 타임아웃으로 빨개진다.
 *
 * 정적 단언(tests/shipped-embedding-reindex.spec.ts)은 이 결함을 못 잡았다.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const SCRIPT_PATH = fileURLToPath(
  new URL('../../../dist/scripts/reindex-embeddings.js', import.meta.url),
);

let workDir: string;
let holderPath: string;

beforeAll(() => {
  workDir = mkdtempSync(join(tmpdir(), 'memento-1165-'));
  holderPath = join(workDir, 'dangling-handle.mjs');
  // 임베딩 런타임이 남기는 해제 불가 핸들의 대역. unref 하지 않는다.
  writeFileSync(holderPath, 'setInterval(() => {}, 60_000);\n');
});

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe('#1165 재색인 진입점은 남은 핸들이 있어도 종료한다', () => {
  it('해제 불가 핸들을 심어도 결과를 출력하고 종료한다', () => {
    expect(
      existsSync(SCRIPT_PATH),
      `먼저 빌드하세요: npm run build -w memento-server (${SCRIPT_PATH})`,
    ).toBe(true);

    const result = spawnSync(
      process.execPath,
      ['--import', pathToFileURL(holderPath).href, SCRIPT_PATH, '--dry-run'],
      {
        encoding: 'utf-8',
        timeout: 90_000,
        env: {
          ...process.env,
          DB_PATH: join(workDir, 'memory.db'),
          MEMENTO_CONFIG_DIR: join(workDir, 'config'),
          EMBEDDING_PROVIDER: 'minilm',
        },
      },
    );

    expect(result.signal, `스크립트가 종료하지 않았다. stderr: ${result.stderr?.slice(-800)}`).toBe(
      null,
    );
    expect(result.status).toBe(0);

    // 결과 JSON 이 잘리지 않고 끝까지 나와야 한다 — exit 전에 stdout 을 흘려보냈다는 증거다.
    const lastLine = result.stdout.trim().split('\n').at(-1) ?? '';
    expect(JSON.parse(lastLine)).toMatchObject({ dryRun: true, provider: 'minilm' });
  }, 120_000);
});
