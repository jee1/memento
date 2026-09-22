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
