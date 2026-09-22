import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * #1115: docker/docker-compose.prod.secrets.example.yml 과 security.md 가 약속하는
 * <VAR>_FILE 규약이 실제로 동작하는지 확인한다. 구현이 없던 동안에는 예시대로 배포해도
 * 시크릿이 하나도 로드되지 않았고, 기동은 정상으로 보였다.
 */
const SCRIPT = 'scripts/inject-file-secrets.sh';

function runSource(env: Record<string, string>, printVar: string): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(
      'sh',
      ['-c', `. ./${SCRIPT} && printf '%s' "\${${printVar}:-}"`],
      { cwd: process.cwd(), env: { PATH: process.env.PATH ?? '', ...env }, encoding: 'utf-8' },
    );
    return { status: 0, stdout, stderr: '' };
  } catch (error) {
    const err = error as { status?: number; stdout?: string; stderr?: string };
    return { status: err.status ?? -1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

describe('#1115: <VAR>_FILE Docker secrets 주입', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'memento-secrets-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('MEMENTO_API_TOKENS_FILE 의 내용을 MEMENTO_API_TOKENS 로 주입한다', () => {
    const file = join(dir, 'tokens.json');
    const payload = '[{"id":"a","secret":"b","scopes":["tools:invoke"]}]';
    writeFileSync(file, `${payload}\n`, 'utf-8');

    const result = runSource({ MEMENTO_API_TOKENS_FILE: file }, 'MEMENTO_API_TOKENS');

    expect(result.status).toBe(0);
    expect(result.stdout).toBe(payload);
  });

  it('OPENAI_API_KEY_FILE 과 GEMINI_API_KEY_FILE 도 같은 규약을 따른다', () => {
    const openaiFile = join(dir, 'openai');
    const geminiFile = join(dir, 'gemini');
    writeFileSync(openaiFile, 'sk-openai\n', 'utf-8');
    writeFileSync(geminiFile, 'gm-gemini\n', 'utf-8');

    expect(runSource({ OPENAI_API_KEY_FILE: openaiFile }, 'OPENAI_API_KEY').stdout).toBe('sk-openai');
    expect(runSource({ GEMINI_API_KEY_FILE: geminiFile }, 'GEMINI_API_KEY').stdout).toBe('gm-gemini');
  });

  it('_FILE 이 없으면 아무것도 건드리지 않는다', () => {
    const result = runSource({ MEMENTO_API_TOKENS: 'already-set' }, 'MEMENTO_API_TOKENS');

    expect(result.status).toBe(0);
    expect(result.stdout).toBe('already-set');
  });

  it('지정된 경로를 읽을 수 없으면 조용히 넘어가지 않고 실패한다', () => {
    const missing = join(dir, 'nope');
    const result = runSource({ MEMENTO_API_TOKENS_FILE: missing }, 'MEMENTO_API_TOKENS');

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('MEMENTO_API_TOKENS_FILE');
  });

  it('진행 로그를 stderr 로만 내보내고 시크릿 값은 찍지 않는다', () => {
    const file = join(dir, 'tokens.json');
    writeFileSync(file, 'super-secret-value\n', 'utf-8');
    chmodSync(file, 0o600);

    const result = spawnSync('sh', ['-c', `. ./${SCRIPT}`], {
      cwd: process.cwd(),
      env: { PATH: process.env.PATH ?? '', MEMENTO_API_TOKENS_FILE: file },
      encoding: 'utf-8',
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('MEMENTO_API_TOKENS');
    expect(result.stderr).not.toContain('super-secret-value');
  });
});
