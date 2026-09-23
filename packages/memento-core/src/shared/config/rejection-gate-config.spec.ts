import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * #1125: 기각 게이트 config 파싱을 고정한다.
 *
 * mementoConfig 는 모듈 최상위 const 라 import 시점에 한 번 계산된다.
 * 환경변수를 바꿔 다시 읽으려면 resetModules 후 동적 import 해야 한다.
 */
async function loadConfig(env: Record<string, string | undefined>) {
  vi.resetModules();
  vi.unstubAllEnvs();
  for (const [key, value] of Object.entries(env)) {
    vi.stubEnv(key, value as string);
  }
  const mod = await import('./index.js');
  return mod.mementoConfig;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.restoreAllMocks();
});

describe('기각 게이트 provider 파싱 (#1095)', () => {
  it('모르는 값은 off 로 떨어진다', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const config = await loadConfig({ SEARCH_REJECTION_GATE: 'jev' });

    expect(config.searchRejectionGate).toBe('off');
    expect(warn).toHaveBeenCalled();
  });

  it('대문자로 적어도 인식한다', async () => {
    const config = await loadConfig({ SEARCH_REJECTION_GATE: 'TypeSafe' });

    expect(config.searchRejectionGate).toBe('typesafe');
  });
});

describe('기각 임계값 파싱 (#1095)', () => {
  it('0.5 가 0 으로 잘리지 않는다', async () => {
    // resolveNumber 는 Number.parseInt 를 쓴다. parseFloat 가 아니면 여기서 0 이 되고
    // 임계값 0 은 아무것도 기각하지 않는다 — 게이트가 조용히 죽는다.
    const config = await loadConfig({ SEARCH_REJECTION_GATE_THRESHOLD: '0.5' });

    expect(config.searchRejectionGateThreshold).toBe(0.5);
  });

  it('0~1 밖이거나 숫자가 아니면 0.5 로 떨어진다', async () => {
    expect((await loadConfig({ SEARCH_REJECTION_GATE_THRESHOLD: '1.5' })).searchRejectionGateThreshold).toBe(0.5);
    expect((await loadConfig({ SEARCH_REJECTION_GATE_THRESHOLD: '-0.1' })).searchRejectionGateThreshold).toBe(0.5);
    expect((await loadConfig({ SEARCH_REJECTION_GATE_THRESHOLD: 'abc' })).searchRejectionGateThreshold).toBe(0.5);
  });
});

describe('게이트 장애 시 정책 파싱 (#1125)', () => {
  it('설정하지 않으면 open 이다', async () => {
    const config = await loadConfig({});

    expect(config.searchRejectionGateOnError).toBe('open');
  });

  it('closed 를 설정하면 closed 다', async () => {
    const config = await loadConfig({ SEARCH_REJECTION_GATE_ON_ERROR: 'closed' });

    expect(config.searchRejectionGateOnError).toBe('closed');
  });

  it('대문자·공백을 붙여도 인식한다', async () => {
    const config = await loadConfig({ SEARCH_REJECTION_GATE_ON_ERROR: '  CLOSED  ' });

    expect(config.searchRejectionGateOnError).toBe('closed');
  });

  it('모르는 값은 경고하고 open 으로 떨어진다', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const config = await loadConfig({ SEARCH_REJECTION_GATE_ON_ERROR: 'strict' });

    expect(config.searchRejectionGateOnError).toBe('open');
    expect(warn).toHaveBeenCalled();
  });
});
