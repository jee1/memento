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
      yes: false,
    });
  });

  it('배치 상한 100을 넘기면 거부한다', () => {
    expect(() => parseOptions(['execute', '--batch-size', '200'])).toThrow(/100/);
  });

  it('알 수 없는 명령을 거부한다', () => {
    expect(() => parseOptions(['nuke'])).toThrow(/nuke/);
  });

  it('execute 에서는 --yes 를 무시한다', () => {
    expect(parseOptions(['execute', '--yes']).yes).toBe(false);
  });
});
