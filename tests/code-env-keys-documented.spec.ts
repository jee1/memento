import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * #1136: every env key the server code reads must be documented in env.example.
 * Reverse direction of tests/env-example-keys-reach-compose.spec.ts (#1133).
 * Keys are parsed from source, not listed by hand: forgetting to document a new key FAILS this test.
 * Scope: packages/memento-core/src and packages/memento-server/src (the server runtime).
 * Client SDK packages document their own env in their READMEs.
 */

const SCAN_ROOTS = ['packages/memento-core/src', 'packages/memento-server/src'];
const ENV_EXAMPLE = 'env.example';
const SKIP_DIRS = new Set(['node_modules', 'dist', 'test', 'tests', '__tests__']);

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf-8');
}

function walkTsFiles(dir: string): string[] {
  const abs = join(process.cwd(), dir);
  const entries = readdirSync(abs);
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(abs, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (SKIP_DIRS.has(entry)) continue;
      files.push(...walkTsFiles(join(dir, entry)));
    } else if (
      entry.endsWith('.ts') &&
      !entry.endsWith('.d.ts') &&
      !entry.endsWith('.spec.ts') &&
      !entry.endsWith('.test.ts')
    ) {
      files.push(full);
    }
  }
  return files;
}

export function stripComments(src: string): string {
  let out = src.replace(/^\s*\/\*[\s\S]*?\*\//gm, '');
  out = out
    .split('\n')
    .filter((line) => !/^\s*\*/.test(line))
    .join('\n');
  out = out.replace(/(^|\s)\/\/.*$/gm, '');
  return out;
}

export function extractEnvKeys(src: string): Set<string> {
  const stripped = stripComments(src);
  const keys = new Set<string>();

  const patterns: RegExp[] = [
    /\benv\??\.([A-Z][A-Z0-9_]*)\b/g,
    /\benv\[\s*['"]([A-Z][A-Z0-9_]*)['"]\s*\]/g,
    /\b(?:resolve\w*|\w*Env\w*)\(\s*(?:[\w.]+\s*,\s*)?['"]([A-Z][A-Z0-9_]*)['"]/g,
    /\b\w*_ENV\s*=\s*['"]([A-Z][A-Z0-9_]*)['"]/g,
  ];

  for (const re of patterns) {
    for (const match of stripped.matchAll(re)) {
      keys.add(match[1]);
    }
  }

  for (const match of stripped.matchAll(/fallbackKeys:\s*\[([^\]]*)\]/g)) {
    const inner = match[1];
    for (const keyMatch of inner.matchAll(/['"]([A-Z][A-Z0-9_]*)['"]/g)) {
      keys.add(keyMatch[1]);
    }
  }

  return keys;
}

function documentedKeys(): Set<string> {
  const keys = read(ENV_EXAMPLE)
    .split('\n')
    .map((line) => /^#?\s*([A-Z_][A-Z0-9_]*)\s*=/.exec(line)?.[1])
    .filter((key): key is string => key !== undefined);
  return new Set(keys);
}

function collectCodeKeys(): Set<string> {
  const keys = new Set<string>();
  for (const root of SCAN_ROOTS) {
    for (const file of walkTsFiles(root)) {
      const src = readFileSync(file, 'utf-8');
      for (const key of extractEnvKeys(src)) {
        keys.add(key);
      }
    }
  }
  return keys;
}

// #1136: keys the server code reads but env.example deliberately does not document. Every entry needs a reason.
const NOT_DOCUMENTED: Record<string, string> = {
  // 플랫폼·런타임이 주는 값
  HOME: '운영체제가 주는 홈 디렉터리. CLI 가 ~/.claude·~/.codex 설정 경로를 찾을 때 읽는다.',
  HOSTNAME: '운영체제·컨테이너가 주는 호스트 이름. 리뷰 후보 relay 의 instance_id 로 쓴다.',
  MEMENTO_PROJECT_ID: '호스트 CLI `memento connect project` 의 프로젝트 이름 덮어쓰기 (#1270). 서버는 읽지 않는다.',
  VITEST: 'vitest 가 테스트 실행 중에 스스로 설정한다.',
  // 컨테이너 고정값 — compose 가 리터럴로 박는다
  DOCKER: "docker-compose.base.yml 이 'true' 로 고정한다. 컨테이너 여부 신호다.",
  MEMENTO_CONFIG_DIR: 'docker-compose.base.yml 이 /app/.memento 로 고정한다. 호스트 CLI 는 탐색 순서로 찾는다.',
  // 패키지 매니페스트가 단일 출처
  MCP_SERVER_NAME: '설정하지 않는다. 패키지 매니페스트가 단일 출처다 (#1077, env.example:7).',
  MCP_SERVER_VERSION: '설정하지 않는다. 패키지 매니페스트가 단일 출처다 (#1077, env.example:7).',
  // 대체 키·미구현 선택자
  HTTP_BIND_HOST: 'MEMENTO_HTTP_BIND_HOST 의 옛 이름 폴백(fallbackKeys). 새 설정은 MEMENTO_HTTP_BIND_HOST 로 한다.',
  DB_TYPE: "저장소 팩토리 선택자. sqlite 만 구현돼 있고 'postgres' 는 미구현 오류를 던진다.",
  // CLI 클라이언트 쪽 — 서버 .env 가 아니라 CLI 를 부르는 셸에서 준다
  MEMENTO_API_KEY: 'agent-ops CLI 가 서버를 부를 때 쓰는 클라이언트 키. 서버 설정이 아니다.',
  MEMENTO_ENDPOINT: 'agent-ops CLI 가 부를 서버 주소. 서버 설정이 아니다.',
  MEMENTO_CLI_QUIET: "agent-ask CLI 가 실행 중에 스스로 '1' 로 설정해 로그를 끈다.",
  MEMENTO_HTTP_SIDECAR: 'stdio 서버 전용. MCP 클라이언트 설정의 env 로 켠다 (docs/agents/commands.md). 컨테이너(sse)에는 의미가 없다.',
  // 우회·디버그 스위치 — 운영에서 켤 이유가 없다
  MCP_MODE: '로거의 stdio 자동 감지를 강제로 덮는 디버그 스위치. 기본은 TTY 로 자동 감지한다.',
  ENABLE_WORKER: '값이 있으면 transformers.js 기본 설정(캐시 끔·WASM 백엔드)을 건너뛴다. false 도 값이라 건너뛴다.',
  MEMENTO_DB_DEBUG: "'1' 이면 DB 오류 상세를 stderr 에 찍는 디버그 스위치.",
  MEMENTO_DEBUG: "'1' 이면 agent-ask CLI 오류의 스택을 찍는 디버그 스위치.",
  // 마이그레이션 사전 점검 — 배포 절차가 다룬다
  MEMENTO_DB_PRECHECK_OK: '043 마이그레이션 사전 점검 통과 표시. 마이그레이션 오류 메시지가 npm run db:pre-docker-deploy 뒤에 설정하라고 안내한다.',
  MEMENTO_SKIP_EMBEDDING_BLOB_PRECHECK: '043 마이그레이션 사전 점검을 건너뛴다. 운영 우회용이라 템플릿에 두지 않는다.',
  // 테스트·측정 전용
  DISABLE_CONFIG_VALIDATION: '테스트·빌드 단계용. 설정 검증을 끈다.',
  SKIP_CONFIG_VALIDATION: '테스트·빌드 단계용. DISABLE_CONFIG_VALIDATION 과 같은 스위치다.',
  MEMENTO_SEARCH_BENCHMARK_DIR: '품질 벤치마크 픽스처 디렉터리. 측정 스크립트가 쓴다.',
};

describe('code-env-keys-documented (#1136)', () => {
  const codeKeys = collectCodeKeys();
  const documented = documentedKeys();
  const notDocKeys = new Set(Object.keys(NOT_DOCUMENTED));

  it('every env key read by server code is documented or listed in NOT_DOCUMENTED', () => {
    const allowed = new Set([...documented, ...notDocKeys]);
    const orphans = [...codeKeys].filter((k) => !allowed.has(k)).sort();
    expect(
      orphans,
      orphans.length
        ? `Undocumented env keys read by server code: ${orphans.join(', ')}. Document in env.example (and inject in docker-compose.base.yml) or add a reason to NOT_DOCUMENTED.`
        : undefined,
    ).toEqual([]);
  });

  it('NOT_DOCUMENTED has no stale entries', () => {
    const staleDocumented = [...notDocKeys].filter((k) => documented.has(k)).sort();
    expect(staleDocumented, `NOT_DOCUMENTED keys now in env.example: ${staleDocumented.join(', ')}`).toEqual([]);

    const staleUnread = [...notDocKeys].filter((k) => !codeKeys.has(k)).sort();
    expect(staleUnread, `NOT_DOCUMENTED keys no longer read by code: ${staleUnread.join(', ')}`).toEqual([]);
  });

  it('every NOT_DOCUMENTED entry has a reason', () => {
    for (const [key, reason] of Object.entries(NOT_DOCUMENTED)) {
      expect(reason.trim().length, `NOT_DOCUMENTED.${key} reason too short`).toBeGreaterThan(10);
    }
  });

  it('extractEnvKeys recognizes every read form and ignores comments', () => {
    const fixture = `
      process.env.A_KEY
      env.B_KEY?.trim()
      env?.B2_KEY
      process.env['C_KEY']
      resolveNumber('D_KEY', { defaultValue: 1 })
      resolveValidatedNumber(
        'D2_KEY',
        5)
      resolveRatio(options.x, 'E_KEY', 0.1)
      getRawEnvValue('F_KEY')
      export const G_ENV = 'G_KEY';
      fallbackKeys: ['H_KEY', 'H2_KEY']
      optionalEnvNumber('I_KEY')
      const url = 'http://x'; process.env.J_KEY
      // process.env.X1_KEY
        * X2_KEY: doc
/* process.env.X3_KEY */
      code: 'X4_NOT_ENV'
    `;
    const extracted = [...extractEnvKeys(fixture)].sort();
    expect(extracted).toEqual([
      'A_KEY',
      'B2_KEY',
      'B_KEY',
      'C_KEY',
      'D2_KEY',
      'D_KEY',
      'E_KEY',
      'F_KEY',
      'G_KEY',
      'H2_KEY',
      'H_KEY',
      'I_KEY',
      'J_KEY',
    ]);
  });

  it('MCP_DIAG (comment-only) is not treated as read', () => {
    expect(codeKeys.has('MCP_DIAG')).toBe(false);
  });
});
