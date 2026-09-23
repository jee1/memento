import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * #1115: .env 에 설정한 programmatic 인증 값이 컨테이너까지 도달해야 한다.
 *
 * docker-compose.base.yml 이 MEMENTO_API_TOKENS 를 주입하지 않아, env.example 이
 * 안내하는 대로 .env 에 적어도 값이 서버 프로세스에 도달하지 않았다. 서버는 조용히
 * legacy ADMIN_API_KEY 로 폴백해 정상 기동하므로 증상이 없었다.
 *
 * 한계: 아래 목록은 손으로 관리한다. 새 인증 변수를 도입하면 여기에 함께 추가해야 한다.
 */
const AUTH_ENV_VARS = ['MEMENTO_API_TOKENS', 'ADMIN_API_KEY'] as const;

/**
 * #1095: 기각 게이트 설정도 컨테이너에 도달해야 한다.
 * 도달하지 않으면 .env 에서 켜도 컨테이너 안에서는 계속 off 로 돌고 증상이 없다.
 */
const REJECTION_GATE_ENV_VARS = [
  'SEARCH_REJECTION_GATE',
  'SEARCH_REJECTION_GATE_THRESHOLD',
  'SEARCH_REJECTION_GATE_TIMEOUT_MS',
  'SEARCH_REJECTION_GATE_DOC_CHARS',
  'TYPESAFE_API_KEY',
  'TYPESAFE_MODEL',
] as const;

const COMPOSE_PATH = 'docker-compose.base.yml';

function readCompose(): string {
  return readFileSync(join(process.cwd(), COMPOSE_PATH), 'utf-8');
}

function findInjectionLine(source: string, varName: string): string | undefined {
  return source
    .split('\n')
    .map((line) => line.trimEnd())
    .find((line) => {
      const trimmed = line.trim();
      if (trimmed.startsWith('#')) return false;
      return new RegExp(`^${varName}\\s*:`).test(trimmed);
    });
}

describe(`#1115: ${COMPOSE_PATH} 가 programmatic 인증 변수를 컨테이너에 주입한다`, () => {
  it.each(AUTH_ENV_VARS)('%s 주입 키가 있다', (varName) => {
    expect(findInjectionLine(readCompose(), varName)).toBeDefined();
  });

  it.each(AUTH_ENV_VARS)('%s 는 같은 이름의 호스트 값을 그대로 넘긴다', (varName) => {
    const line = findInjectionLine(readCompose(), varName);
    expect(line).toBeDefined();
    expect(line).toMatch(new RegExp(`\\$\\{${varName}(:-[^}]*)?\\}`));
  });
});

describe(`#1095: ${COMPOSE_PATH} 가 기각 게이트 설정을 컨테이너에 주입한다`, () => {
  it.each(REJECTION_GATE_ENV_VARS)('%s 주입 키가 있다', (varName) => {
    expect(findInjectionLine(readCompose(), varName)).toBeDefined();
  });

  it.each(REJECTION_GATE_ENV_VARS)('%s 는 같은 이름의 호스트 값을 그대로 넘긴다', (varName) => {
    const line = findInjectionLine(readCompose(), varName);
    expect(line).toBeDefined();
    expect(line).toMatch(new RegExp(`\\$\\{${varName}(:-[^}]*)?\\}`));
  });
});

/**
 * #1129: MCP era 롤백 게이트도 컨테이너에 도달해야 한다.
 * 도달하지 않으면 .env 로 legacy 로 내려도 컨테이너 안에서는 계속 dual 이라
 * 롤백 수단 자체가 없다. 2026-09-23 에 실제로 이 상태였다.
 */
const MCP_ERA_ENV_VARS = ['MEMENTO_MCP_ERA'] as const;

describe(`#1129: ${COMPOSE_PATH} 가 MCP era 롤백 게이트를 컨테이너에 주입한다`, () => {
  it.each(MCP_ERA_ENV_VARS)('%s 주입 키가 있다', (varName) => {
    expect(findInjectionLine(readCompose(), varName)).toBeDefined();
  });

  it.each(MCP_ERA_ENV_VARS)('%s 는 같은 이름의 호스트 값을 그대로 넘긴다', (varName) => {
    const line = findInjectionLine(readCompose(), varName);
    expect(line).toBeDefined();
    expect(line).toMatch(new RegExp(`\\$\\{${varName}(:-[^}]*)?\\}`));
  });

  it('MEMENTO_MCP_ERA 의 기본값은 코드 기본값과 같은 dual 이다', () => {
    // parseMcpEraMode (packages/memento-core/src/shared/utils/mcp-era-mode.ts:8) 가
    // 빈 값을 dual 로 읽는다. compose 기본값이 다르면 컨테이너와 로컬이 갈라진다.
    expect(findInjectionLine(readCompose(), 'MEMENTO_MCP_ERA')).toContain(':-dual}');
  });
});
