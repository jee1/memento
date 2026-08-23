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
      from: 'execute',
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

describe('--from (cleanup 이 정리할 실행분)', () => {
  it('기본은 execute 다 — 라이브 정리가 리허설 기록을 집지 않게', () => {
    expect(parseOptions(['cleanup']).from).toBe('execute');
  });

  it('리허설 뒤 정리는 명시적으로 고른다', () => {
    expect(parseOptions(['cleanup', '--from', 'rehearse']).from).toBe('rehearse');
  });

  it('삭제를 수행하는 두 명령 외에는 거부한다', () => {
    expect(() => parseOptions(['cleanup', '--from', 'report'])).toThrow(/execute|rehearse/);
  });
});
