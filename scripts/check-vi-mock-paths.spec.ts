import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { collectMockRefs, loadBaseline, resolvesToModule, scan, validateBaseline } from './check-vi-mock-paths.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// 검사기는 줄 시작 앵커를 쓰므로 아래 픽스처 조립 줄은 스스로에게 걸리지 않는다.
const mockLine = (specifier: string) => `vi.mock('${specifier}', () => ({}));`;

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'vimock-'));
  mkdirSync(join(root, 'src', '__tests__'), { recursive: true });
  writeFileSync(join(root, 'src', 'real.ts'), 'export const x = 1;\n');
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

const writeSpec = (lines: string[]) =>
  writeFileSync(join(root, 'src', '__tests__', 'a.spec.ts'), `${lines.join('\n')}\n`);

describe('resolvesToModule', () => {
  it('.js 를 .ts 로 치환해 해석한다', () => {
    expect(resolvesToModule(join(root, 'src', '__tests__'), '../real.js')).toBe(true);
  });

  it('실재하지 않는 경로는 해석하지 못한다', () => {
    expect(resolvesToModule(join(root, 'src', '__tests__'), '../../nope/index.js')).toBe(false);
  });

  it('index.ts 가 없는 디렉터리는 해석하지 못한다', () => {
    mkdirSync(join(root, 'src', 'bare-dir'));
    expect(resolvesToModule(join(root, 'src', '__tests__'), '../bare-dir')).toBe(false);
  });
});

describe('collectMockRefs', () => {
  it('패키지 이름 모킹은 수집하지 않는다', () => {
    writeSpec([mockLine('openai'), mockLine('../real.js')]);
    expect(collectMockRefs(root).map((r) => r.specifier)).toEqual(['../real.js']);
  });

  it('줄 번호를 1-based 로 기록한다', () => {
    writeSpec(['// head', mockLine('../real.js')]);
    expect(collectMockRefs(root)[0].line).toBe(2);
  });

  it('주석 처리된 모킹은 수집하지 않는다', () => {
    writeSpec([`// ${mockLine('../../commented-out.js')}`, mockLine('../real.js')]);
    expect(collectMockRefs(root).map((r) => r.specifier)).toEqual(['../real.js']);
  });

  it('문자열 리터럴 안의 모킹은 수집하지 않는다', () => {
    writeSpec([`const sample = "${mockLine('../../inside-a-string.js')}";`]);
    expect(collectMockRefs(root)).toHaveLength(0);
  });
});

describe('scan', () => {
  it('미해석 + 미등재는 violation 이다', () => {
    writeSpec([mockLine('../../nope/index.js')]);
    const result = scan(root, []);
    expect(result.violations).toHaveLength(1);
    expect(result.baselined).toHaveLength(0);
  });

  it('미해석 + 등재는 baselined 로 통과시킨다', () => {
    writeSpec([mockLine('../../nope/index.js')]);
    const result = scan(root, [
      { file: 'src/__tests__/a.spec.ts', specifier: '../../nope/index.js', reason: 'r', followUp: '#1' },
    ]);
    expect(result.violations).toHaveLength(0);
    expect(result.baselined).toHaveLength(1);
    expect(result.baselined[0].reason).toBe('r');
  });

  it('등재됐는데 해석되면 staleBaseline 으로 보고한다', () => {
    writeSpec([mockLine('../real.js')]);
    const result = scan(root, [
      { file: 'src/__tests__/a.spec.ts', specifier: '../real.js', reason: 'r', followUp: '#1' },
    ]);
    expect(result.violations).toHaveLength(0);
    expect(result.staleBaseline).toHaveLength(1);
  });

  it('정상 모킹은 위반으로 보고하지 않는다', () => {
    writeSpec([mockLine('../real.js')]);
    expect(scan(root, []).violations).toHaveLength(0);
  });
});

describe('validateBaseline', () => {
  it('reason 이 비면 거부한다', () => {
    expect(() =>
      validateBaseline([{ file: 'a', specifier: 'b', reason: '', followUp: '#1' }]),
    ).toThrow(/reason/);
  });

  it('followUp 이 없으면 거부한다', () => {
    expect(() => validateBaseline([{ file: 'a', specifier: 'b', reason: 'r' }])).toThrow(/followUp/);
  });
});

describe('loadBaseline', () => {
  it('파일이 없으면 빈 목록이다', () => {
    expect(loadBaseline(join(root, 'absent.json'))).toEqual([]);
  });
});

// CLI 계층. 순수 함수 테스트만으로는 인자 파싱·baseline 로드·exit code 가
// 검증되지 않는다 - 차단 게이트에서는 exit code 자체가 계약이다.
describe('CLI', () => {
  const runGate = (args: string[]) => {
    try {
      const stdout = execFileSync('npx', ['tsx', 'scripts/check-vi-mock-paths.ts', ...args], {
        cwd: REPO_ROOT,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      return { code: 0, stdout };
    } catch (error) {
      const e = error as { status?: number; stdout?: string };
      return { code: e.status ?? -1, stdout: e.stdout ?? '' };
    }
  };

  it('C1+C6: 실제 저장소를 기본 baseline 으로 돌리면 exit 0 이고 위반이 없다', () => {
    const { code, stdout } = runGate(['--ci']);
    expect(stdout).toContain('위반 (차단) 0건');
    expect(stdout).toContain('정리 대상 (baseline 에 있으나 위반 아님) 0건');
    expect(code).toBe(0);
  }, 60_000);

  it('C5: baseline 스키마가 깨지면 --ci 에서 exit 1 이다', () => {
    const broken = join(root, 'broken-baseline.json');
    writeFileSync(broken, JSON.stringify([{ file: 'a', specifier: 'b', reason: '', followUp: '#1' }]));
    const { code, stdout } = runGate(['--ci', `--baseline=${broken}`]);
    expect(stdout).not.toContain('\nOK');
    expect(code).toBe(1);
  }, 60_000);

  it('baseline 이 비면 남은 위반 3건(#825)이 드러나 exit 1 이다', () => {
    const empty = join(root, 'empty-baseline.json');
    writeFileSync(empty, '[]');
    const { code, stdout } = runGate(['--ci', `--baseline=${empty}`]);
    expect(stdout).toContain('위반 (차단) 3건');
    expect(code).toBe(1);
  }, 60_000);
});
