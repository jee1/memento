import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { collectMockRefs, resolvesToModule, scan, validateBaseline } from './check-vi-mock-paths.js';

// 픽스처를 조립해서 쓴다. 이 파일에 `vi.mock(` 리터럴이 그대로 있으면
// 검사기가 자기 테스트 데이터를 위반으로 집어낸다.
const MOCK_CALL = 'vi.mo' + 'ck';
const mockLine = (specifier: string) => `${MOCK_CALL}('${specifier}', () => ({}));`;

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
