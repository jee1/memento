import { describe, expect, it } from 'vitest';

import { resolveTrustProxySetting } from './trust-proxy.js';

/**
 * #1161: 기본값은 «헤더 무시» 여야 한다. `trust proxy` 를 켜는 순간 X-Forwarded-For 로
 * rate limit 키를 위조할 수 있으므로, 해석 불가한 값은 조용히 켜지 말고 무시해야 한다.
 */
describe('resolveTrustProxySetting (#1161)', () => {
  it('leaves the Express default untouched when unset or blank', () => {
    expect(resolveTrustProxySetting(undefined)).toEqual({});
    expect(resolveTrustProxySetting('   ')).toEqual({});
  });

  it('parses hop counts and explicit false', () => {
    expect(resolveTrustProxySetting('1')).toEqual({ setting: 1 });
    expect(resolveTrustProxySetting('0')).toEqual({ setting: 0 });
    expect(resolveTrustProxySetting('false')).toEqual({ setting: false });
    expect(resolveTrustProxySetting('off')).toEqual({ setting: false });
  });

  it('accepts named presets and IP/CIDR lists', () => {
    expect(resolveTrustProxySetting('loopback').setting).toBe('loopback');
    expect(resolveTrustProxySetting('loopback, 10.0.0.0/8').setting).toBe('loopback, 10.0.0.0/8');
    expect(resolveTrustProxySetting('172.18.0.0/16,::1').setting).toBe('172.18.0.0/16, ::1');
  });

  it('warns but still honours an explicit true — it is trivially bypassable', () => {
    const resolved = resolveTrustProxySetting('true');
    expect(resolved.setting).toBe(true);
    expect(resolved.warning).toContain('X-Forwarded-For');
  });

  it('ignores unparseable values instead of trusting headers', () => {
    for (const raw of ['loopbak', '10.0.0.0/999', 'not-an-ip', '10.0.0.0/8/16', '1.2.3']) {
      const resolved = resolveTrustProxySetting(raw);
      expect(resolved.setting).toBeUndefined();
      expect(resolved.warning).toBeTruthy();
    }
  });
});
