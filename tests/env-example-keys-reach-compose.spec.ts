import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * #1133: env.example 이 문서화한 키는 컨테이너까지 도달해야 한다.
 *
 * compose 는 컨테이너에 넘길 환경변수를 명시 화이트리스트로 관리한다. 목록에 없는 키는
 * .env 에 적어도 서버 프로세스에 도달하지 않고, 서버는 코드 기본값으로 조용히 폴백한다.
 * 기동도 헬스체크도 성공하므로 증상이 없다.
 *
 * 앞선 가드(#1115)는 검사 목록을 손으로 들고 있었다. 목록 갱신을 잊으면 테스트가
 * **통과**했다 — 조용한 실패. 같은 누락이 #1115 → #1095 → #1129 → #1125 로 네 번 반복됐고,
 * 그 사이 30개가 이미 누락된 채였다.
 *
 * 그래서 목록을 들지 않는다. env.example 에서 키를 **파싱해** compose 와 대조한다.
 * 문서화됐는데 주입도 제외도 안 된 키가 있으면 **실패**한다 — 실패 방향이 뒤집혔다.
 *
 * 한계: env.example 이 문서화하지 않은 키는 여기서 보이지 않는다. 그쪽은 #1126 소관이다.
 */

const ENV_EXAMPLE = 'env.example';
const COMPOSE_BASE = 'docker-compose.base.yml';
const COMPOSE_ROOT = 'docker-compose.yml';

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf-8');
}

/** `KEY=` 와 주석 처리된 `# KEY=` 를 모두 센다. #1115·#1129 는 둘 다 주석 줄이었다. */
function documentedKeys(): string[] {
  const keys = read(ENV_EXAMPLE)
    .split('\n')
    .map((line) => /^#?\s*([A-Z_][A-Z0-9_]*)\s*=/.exec(line)?.[1])
    .filter((key): key is string => key !== undefined);
  return [...new Set(keys)].sort();
}

/** compose 가 컨테이너에 넘기는 키. 루트와 base 를 합쳐 본다 — 둘 다 environment 를 갖는다. */
function injectedKeys(): Set<string> {
  const keys = [COMPOSE_BASE, COMPOSE_ROOT]
    .flatMap((path) => read(path).split('\n'))
    .map((line) => {
      const trimmed = line.trim();
      if (trimmed.startsWith('#')) return undefined;
      return /^([A-Z_][A-Z0-9_]*)\s*:/.exec(trimmed)?.[1];
    })
    .filter((key): key is string => key !== undefined);
  return new Set(keys);
}

function injectionLine(path: string, varName: string): string | undefined {
  return read(path)
    .split('\n')
    .map((line) => line.trimEnd())
    .find((line) => {
      const trimmed = line.trim();
      if (trimmed.startsWith('#')) return false;
      return new RegExp(`^${varName}\\s*:`).test(trimmed);
    });
}

function injectionLineAnywhere(varName: string): string | undefined {
  return injectionLine(COMPOSE_BASE, varName) ?? injectionLine(COMPOSE_ROOT, varName);
}

/**
 * 일부러 넘기지 않는 키. 이유 없이 여기에 넣지 말 것 — 넣는 순간 그 키는
 * 컨테이너에서 설정 불가가 되고, 이 가드는 그 사실을 더 이상 알려주지 않는다.
 */
const NOT_FORWARDED: Record<string, string> = {
  MCP_PUBLISH_HOST:
    '호스트 쪽 값이다. docker-compose.yml `ports:` 의 앞자리라 컨테이너 env 가 아니다.',
  MEMENTO_BACKUP_DIR: '호스트 CLI 백업 경로 (#963). 컨테이너 안에서 쓰이지 않는다.',
  MEMENTO_AGENT_LLM_PROVIDER: '별도 배포물 services/agent/ 용 (#1126).',
  MEMENTO_AGENT_OLLAMA_BASE_URL: '별도 배포물 services/agent/ 용 (#1126).',
  MEMENTO_AGENT_OLLAMA_MODEL: '별도 배포물 services/agent/ 용 (#1126).',
  MEMENTO_AGENT_OPENAI_API_KEY: '별도 배포물 services/agent/ 용 (#1126).',
  MEMENTO_AGENT_OPENAI_MODEL: '별도 배포물 services/agent/ 용 (#1126).',
  MEMENTO_AGENT_GEMINI_API_KEY: '별도 배포물 services/agent/ 용 (#1126).',
  MEMENTO_AGENT_GEMINI_MODEL: '별도 배포물 services/agent/ 용 (#1126).',
  MEMENTO_AGENT_LOG_LEVEL: '별도 배포물 services/agent/ 용 (#1126).',
  MEMENTO_AGENT_TIMEOUT_MS: '별도 배포물 services/agent/ 용 (#1126).',
};

describe('#1133: env.example 이 문서화한 키가 컨테이너에 도달한다', () => {
  it('문서화됐는데 주입도 제외도 안 된 키가 없다', () => {
    const injected = injectedKeys();
    const orphans = documentedKeys().filter(
      (key) => !injected.has(key) && !(key in NOT_FORWARDED)
    );

    expect(
      orphans,
      `env.example 이 문서화했지만 컨테이너에 도달하지 않는 키다.\n` +
        `${COMPOSE_BASE} 에 \`KEY: \${KEY:-}\` 로 주입하거나, 넘기지 않는 이유를 적어\n` +
        `이 파일의 NOT_FORWARDED 에 넣어라.\n\n  ${orphans.join('\n  ')}\n`
    ).toEqual([]);
  });

  it('NOT_FORWARDED 에 썩은 항목이 없다', () => {
    const documented = new Set(documentedKeys());
    const injected = injectedKeys();

    // 문서화가 사라졌는데 제외만 남아 있으면 다음 사람이 잘못된 지도를 읽는다.
    expect(Object.keys(NOT_FORWARDED).filter((key) => !documented.has(key))).toEqual([]);
    // 주입해 놓고 제외 목록에도 두면 어느 쪽이 의도인지 알 수 없다.
    expect(Object.keys(NOT_FORWARDED).filter((key) => injected.has(key))).toEqual([]);
  });

  it('제외 항목마다 이유가 붙어 있다', () => {
    for (const [key, reason] of Object.entries(NOT_FORWARDED)) {
      expect(reason.trim().length, `${key} 의 제외 이유가 비어 있다`).toBeGreaterThan(10);
    }
  });
});

/**
 * 컨테이너 고정값. 호스트 값을 그대로 받으면 컨테이너가 깨진다.
 * DB_PATH 는 호스트 경로가 컨테이너 안에 없고, BIND_HOST 는 0.0.0.0 이 아니면
 * 도커 게시가 프로세스에 닿지 않는다.
 */
const PINNED_LITERALS = ['DB_PATH', 'MEMENTO_HTTP_BIND_HOST'] as const;

describe('#1133: 컨테이너 고정값은 호스트 값을 받지 않는다', () => {
  it.each(PINNED_LITERALS)('%s 는 보간(${}) 없이 리터럴로 박혀 있다', (varName) => {
    const line = injectionLine(COMPOSE_BASE, varName);
    expect(line).toBeDefined();
    expect(line).not.toContain('${');
  });
});

/**
 * 보안 기본값. 두 키 모두 .env 에서 켤 수 있어야 하지만, .env 에 없을 때의
 * 기본값이 안전한 쪽이어야 한다.
 */
describe('#1133: 보안 기본값이 안전한 쪽으로 고정돼 있다', () => {
  it('NODE_ENV 는 컨테이너에서 production 으로 고정된다', () => {
    // .env 의 NODE_ENV=development 가 운영 컨테이너를 뒤집으면 안 된다.
    expect(injectionLine(COMPOSE_ROOT, 'NODE_ENV')).toContain('production');
  });

  it('MEMENTO_ALLOW_INSECURE_HTTP_ADMIN 의 기본값은 false 다', () => {
    // 컨테이너는 안에서 0.0.0.0 에 바인딩한다. 이 값이 true 면 API 키 없이 기동이
    // 허용돼 무인증 노출이 된다. .env 로 켤 수는 있지만 기본값은 false 여야 한다.
    expect(injectionLine(COMPOSE_ROOT, 'MEMENTO_ALLOW_INSECURE_HTTP_ADMIN')).toContain(':-false}');
  });
});

/**
 * 아래는 실제로 사고가 난 키들이다. 위의 파생 가드가 «주입돼 있는가» 만 보는 반면,
 * 여기서는 «호스트 값을 그대로 넘기는가»·«기본값이 코드와 같은가» 까지 본다.
 */

/** #1115: .env 에 설정한 programmatic 인증 값이 컨테이너까지 도달해야 한다. */
const AUTH_ENV_VARS = ['MEMENTO_API_TOKENS', 'ADMIN_API_KEY'] as const;

/** #1095: 기각 게이트 설정도 도달해야 한다. 안 그러면 .env 에서 켜도 컨테이너는 계속 off 다. */
const REJECTION_GATE_ENV_VARS = [
  'SEARCH_REJECTION_GATE',
  'SEARCH_REJECTION_GATE_THRESHOLD',
  'SEARCH_REJECTION_GATE_TIMEOUT_MS',
  'SEARCH_REJECTION_GATE_DOC_CHARS',
  'SEARCH_REJECTION_GATE_ON_ERROR',
  'TYPESAFE_API_KEY',
  'TYPESAFE_MODEL',
] as const;

/** #1129: MCP era 롤백 게이트. 도달하지 않으면 롤백 수단 자체가 없다. */
const MCP_ERA_ENV_VARS = ['MEMENTO_MCP_ERA'] as const;

const PASSTHROUGH_ENV_VARS = [
  ...AUTH_ENV_VARS,
  ...REJECTION_GATE_ENV_VARS,
  ...MCP_ERA_ENV_VARS,
] as const;

describe('과거 사고 키가 호스트 값을 그대로 넘긴다 (#1115·#1095·#1129)', () => {
  it.each(PASSTHROUGH_ENV_VARS)('%s 는 같은 이름의 호스트 값을 그대로 넘긴다', (varName) => {
    const line = injectionLineAnywhere(varName);
    expect(line).toBeDefined();
    expect(line).toMatch(new RegExp(`\\$\\{${varName}(:-[^}]*)?\\}`));
  });
});

describe('compose 기본값이 코드 기본값과 같다', () => {
  it('SEARCH_REJECTION_GATE_ON_ERROR 의 기본값은 open 이다 (#1125)', () => {
    // 다르면 컨테이너와 로컬이 갈라지고, 갈라진 쪽이 조용히 이긴다.
    expect(injectionLine(COMPOSE_BASE, 'SEARCH_REJECTION_GATE_ON_ERROR')).toContain(':-open}');
  });

  it('MEMENTO_MCP_ERA 의 기본값은 dual 이다 (#1129)', () => {
    // parseMcpEraMode (packages/memento-core/src/shared/utils/mcp-era-mode.ts:8) 가
    // 빈 값을 dual 로 읽는다.
    expect(injectionLine(COMPOSE_BASE, 'MEMENTO_MCP_ERA')).toContain(':-dual}');
  });
});
