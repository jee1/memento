import { afterEach, describe, expect, it } from 'vitest';
import {
  resolveVectorPrefetchLimit,
  resolveVectorPrefetchMultiplier,
  VECTOR_PREFETCH_CONFIG,
} from '../vector-search.config.js';

const ENV_KEY = 'MEMENTO_VECTOR_PREFETCH_MULTIPLIER';

describe('resolveVectorPrefetchLimit (#1112)', () => {
  afterEach(() => {
    delete process.env[ENV_KEY];
  });

  it('limit=20, 기본 배수이면 160을 반환한다', () => {
    // Given: limit=20, 기본 배수(8)
    delete process.env[ENV_KEY];

    // When: 프리페치 깊이를 구한다
    const prefetch = resolveVectorPrefetchLimit(20);

    // Then: min(100)보다 크므로 20×8=160
    expect(prefetch).toBe(160);
  });

  it('limit=1이면 minCandidates 바닥 100을 반환한다', () => {
    // Given: limit=1, 기본 배수
    delete process.env[ENV_KEY];

    // When: 프리페치 깊이를 구한다
    const prefetch = resolveVectorPrefetchLimit(1);

    // Then: ceil(1×8)=8이지만 minCandidates=100 적용
    expect(prefetch).toBe(VECTOR_PREFETCH_CONFIG.minCandidates);
  });

  it('limit=1000이면 1000을 반환한다', () => {
    // Given: limit=1000, 기본 배수
    delete process.env[ENV_KEY];

    // When: 프리페치 깊이를 구한다
    const prefetch = resolveVectorPrefetchLimit(1000);

    // Then: 천장 512보다 limit이 크므로 limit이 바닥
    expect(prefetch).toBe(1000);
  });

  it('limit=100이면 512를 반환한다', () => {
    // Given: limit=100, 기본 배수
    delete process.env[ENV_KEY];

    // When: 프리페치 깊이를 구한다
    const prefetch = resolveVectorPrefetchLimit(100);

    // Then: 100×8=800이 maxCandidates 512로 캡되고 512 > 100
    expect(prefetch).toBe(VECTOR_PREFETCH_CONFIG.maxCandidates);
  });

  it('MEMENTO_VECTOR_PREFETCH_MULTIPLIER=3이면 limit=50에서 150을 반환한다', () => {
    // Given: env 배수 3, limit=50
    process.env[ENV_KEY] = '3';

    // When: 프리페치 깊이를 구한다
    const prefetch = resolveVectorPrefetchLimit(50);

    // Then: 50×3=150
    expect(prefetch).toBe(150);
    expect(resolveVectorPrefetchMultiplier()).toBe(3);
  });

  it.each(['abc', '0', '-1'])(
    '잘못된 env 값(%s)이면 기본 배수로 폴백한다',
    (invalid) => {
      // Given: 잘못된 env 값
      process.env[ENV_KEY] = invalid;

      // When: 배수와 프리페치 깊이를 구한다
      const multiplier = resolveVectorPrefetchMultiplier();
      const prefetch = resolveVectorPrefetchLimit(20);

      // Then: 기본 배수 8 → limit=20이면 160
      expect(multiplier).toBe(VECTOR_PREFETCH_CONFIG.multiplier);
      expect(prefetch).toBe(160);
    },
  );
});
