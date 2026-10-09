import { isIP } from 'node:net';

/**
 * Issue #1161: Express 기본값은 `trust proxy: false` 라 `req.ip` 가 소켓 원격 주소다.
 *
 * - 리버스 프록시(nginx) 뒤에서는 모든 클라이언트의 `req.ip` 가 프록시 컨테이너 IP 하나로
 *   합쳐진다 → 미인증 몫의 rate limit 이 전원 공유 버킷이 된다.
 * - 반대로 무조건 `true` 로 켜면 누구나 `X-Forwarded-For` 를 위조해 rate limit 키를 바꿔
 *   한도를 우회할 수 있다.
 *
 * 그래서 기본값은 `false`(헤더 무시)를 유지하고, 운영자가 `MEMENTO_TRUST_PROXY` 로
 * 명시할 때만 켠다. 허용 형식은 Express `trust proxy` 와 같다 — 홉 수(`1`),
 * 프리셋(`loopback`·`linklocal`·`uniquelocal`), IP/CIDR 목록(쉼표 구분), `true`/`false`.
 */
type TrustProxyResolution = {
  /** `undefined` 면 호출부가 `app.set` 을 하지 않는다 — Express 기본값 `false` 유지. */
  setting?: boolean | number | string;
  /** 운영자에게 알릴 경고. 값이 위험하거나 해석 불가일 때만 채워진다. */
  warning?: string;
};

const NAMED_PRESETS = new Set(['loopback', 'linklocal', 'uniquelocal']);

/** `10.0.0.0/8`·`::1` 처럼 Express 가 받는 단일 토큰인지 검사한다. */
function isTrustedAddressToken(token: string): boolean {
  if (NAMED_PRESETS.has(token)) {
    return true;
  }

  const [address, prefix, ...rest] = token.split('/');
  if (rest.length > 0 || address === undefined) {
    return false;
  }

  const family = isIP(address);
  if (family === 0) {
    return false;
  }

  if (prefix === undefined) {
    return true;
  }

  if (!/^\d{1,3}$/.test(prefix)) {
    return false;
  }

  return Number.parseInt(prefix, 10) <= (family === 6 ? 128 : 32);
}

export function resolveTrustProxySetting(
  raw: string | undefined = process.env.MEMENTO_TRUST_PROXY,
): TrustProxyResolution {
  const value = raw?.trim();
  if (!value) {
    return {};
  }

  const lowered = value.toLowerCase();
  if (lowered === 'false' || lowered === 'off') {
    return { setting: false };
  }

  if (lowered === 'true' || lowered === 'on') {
    return {
      setting: true,
      warning:
        'MEMENTO_TRUST_PROXY=true 는 모든 X-Forwarded-For 를 신뢰합니다. 누구나 헤더를 위조해 rate limit 을 우회할 수 있으므로 홉 수(예: 1)나 프록시 IP/CIDR 를 지정하세요.',
    };
  }

  if (/^\d+$/.test(lowered)) {
    return { setting: Number.parseInt(lowered, 10) };
  }

  const tokens = lowered
    .split(',')
    .map((token) => token.trim())
    .filter((token) => token !== '');
  if (tokens.length > 0 && tokens.every(isTrustedAddressToken)) {
    return { setting: tokens.join(', ') };
  }

  return {
    warning: `MEMENTO_TRUST_PROXY 값을 해석할 수 없어 무시합니다(X-Forwarded-For 미신뢰): "${value}". 홉 수·loopback/linklocal/uniquelocal·IP/CIDR 목록만 허용합니다.`,
  };
}
