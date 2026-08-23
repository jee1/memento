import { describe, expect, it } from 'vitest';
import { parseOptions } from './quarantine-pipeline-semantic.js';

describe('parseOptions', () => {
  it('기본값을 계약대로 채운다', () => {
    expect(parseOptions(['report'])).toEqual({
      command: 'report',
      out: '.local/quarantine-065',
      batchSize: 100,
      sampleSize: 50,
      driftTolerance: 5,
      resume: false,
    });
  });

  it('배치 상한 100을 넘기면 거부한다', () => {
    expect(() => parseOptions(['execute', '--batch-size', '200'])).toThrow(/100/);
  });

  it('알 수 없는 명령을 거부한다', () => {
    expect(() => parseOptions(['nuke'])).toThrow(/nuke/);
  });

  it('음수 표본 크기를 거부한다 (LIMIT -1 은 SQLite 에서 제한 없음이다)', () => {
    expect(() => parseOptions(['report', '--sample-size', '-1'])).toThrow(/1 이상/);
    expect(() => parseOptions(['report', '--sample-size', '0'])).toThrow(/1 이상/);
  });
});
