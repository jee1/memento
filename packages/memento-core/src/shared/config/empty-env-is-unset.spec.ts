import { afterEach, describe, expect, it, vi } from 'vitest';

import { PIIMasker } from '../utils/pii-masker.js';
import { resolveValidatedNumber } from './environment.js';

/**
 * #1133: 빈 문자열은 «미설정» 이다.
 *
 * compose 가 `KEY: ${KEY:-}` 로 키를 넘기면, .env 에 없는 키는 **빈 문자열**로
 * 컨테이너에 들어온다. resolveEnv 는 빈 값을 건너뛰지만 아래 두 곳은 `??` 와
 * `=== undefined` 로 판별해 빈 문자열을 «설정됨» 으로 읽었다.
 *
 * ENABLE_PII_MASKING 은 그 결과가 **마스킹 해제**였다 — 기본값이 안전한 쪽에서
 * 위험한 쪽으로 조용히 뒤집힌다.
 */

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('resolveValidatedNumber 는 빈 문자열을 미설정으로 읽는다 (#1133)', () => {
  it('빈 문자열이면 경고 없이 기본값을 쓴다', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubEnv('PERF_CPU_WARN_PERCENT', '');

    // parseInt('') 는 NaN 이다. `??` 로 받으면 compose 가 넘긴 빈 키마다
    // 기동 시 경고가 한 줄씩 쌓인다 — 호출처가 22곳이다.
    expect(resolveValidatedNumber('PERF_CPU_WARN_PERCENT', 75, (n) => n >= 1 && n <= 100, '범위 1-100')).toBe(75);
    expect(warn).not.toHaveBeenCalled();
  });

  it('공백만 있어도 미설정으로 읽는다', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubEnv('PERF_CPU_WARN_PERCENT', '   ');

    expect(resolveValidatedNumber('PERF_CPU_WARN_PERCENT', 75, (n) => n >= 1 && n <= 100, '범위 1-100')).toBe(75);
    expect(warn).not.toHaveBeenCalled();
  });

  it('실제 값은 그대로 읽는다', () => {
    vi.stubEnv('PERF_CPU_WARN_PERCENT', '42');

    expect(resolveValidatedNumber('PERF_CPU_WARN_PERCENT', 75, (n) => n >= 1 && n <= 100, '범위 1-100')).toBe(42);
  });

  it('범위를 벗어난 값은 경고하고 기본값으로 떨어진다', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubEnv('PERF_CPU_WARN_PERCENT', '999');

    expect(resolveValidatedNumber('PERF_CPU_WARN_PERCENT', 75, (n) => n >= 1 && n <= 100, '범위 1-100')).toBe(75);
    expect(warn).toHaveBeenCalled();
  });
});

describe('PII 마스킹은 빈 ENABLE_PII_MASKING 으로 꺼지지 않는다 (#1133)', () => {
  const SAMPLE = '연락은 hong@example.com 으로 주세요';

  it('키가 빈 문자열이어도 마스킹이 켜져 있다', () => {
    vi.stubEnv('ENABLE_PII_MASKING', '');

    expect(PIIMasker.mask(SAMPLE).masked).not.toContain('hong@example.com');
  });

  it('키가 아예 없으면 마스킹이 켜져 있다', () => {
    vi.stubEnv('ENABLE_PII_MASKING', undefined);

    expect(PIIMasker.mask(SAMPLE).masked).not.toContain('hong@example.com');
  });

  it('false 로 명시하면 끈다', () => {
    vi.stubEnv('ENABLE_PII_MASKING', 'false');

    expect(PIIMasker.mask(SAMPLE).masked).toContain('hong@example.com');
  });
});
