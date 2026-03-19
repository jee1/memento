/**
 * 바인드 정책 위반으로 HTTP 서버를 시작할 수 없을 때 throw되는 오류.
 * 라이브러리/테스트 호출자는 `instanceof MementoHttpSecurityStartupError` 또는 `err.code`로 구분할 수 있다.
 */
export class MementoHttpSecurityStartupError extends Error {
  readonly code = 'MEMENTO_HTTP_SECURITY_STARTUP' as const;

  constructor(message: string) {
    super(message);
    this.name = 'MementoHttpSecurityStartupError';
  }
}

/**
 * RFC 1122 §3.2.1.3: IPv4 루프백 블록 127.0.0.0/8 (127.0.0.1, 127.0.1.1 등).
 */
function isIpv4Loopback127Block(host: string): boolean {
  const parts = host.split('.');
  if (parts.length !== 4) {
    return false;
  }
  const octets = parts.map((p) => parseInt(p, 10));
  if (octets.some((n) => !Number.isFinite(n) || n < 0 || n > 255)) {
    return false;
  }
  return octets[0] === 127;
}

/**
 * IPv4-mapped IPv6 (::ffff:127.x.x.x) — 루프백으로 간주.
 */
function isIpv4MappedLoopback(host: string): boolean {
  const prefix = '::ffff:';
  if (!host.startsWith(prefix)) {
    return false;
  }
  const v4 = host.slice(prefix.length);
  return isIpv4Loopback127Block(v4);
}

/**
 * HTTP 리슨 주소가 루프백 전용인지(원격에서 도달하기 어려운지) 판별.
 * - IPv4: 127.0.0.0/8 전체 (RFC 1122)
 * - IPv6: ::1 및 [::1]
 * - 호스트명: localhost
 * - IPv4-mapped: ::ffff:127.x.x.x
 * 0.0.0.0, :: 및 그 외 명시 IP는 원격 도달 가능으로 간주한다.
 */
/**
 * Node `server.listen(port, host)` 에 넘길 호스트 문자열.
 * URL/문서에서 쓰는 대괄호 IPv6 표기(`[::1]`)는 Node가 해석하지 못하므로 `::1` 로 벗긴다.
 */
export function canonicalizeHttpBindHostForListen(host: string): string {
  const t = host.trim();
  if (t.length >= 2 && t.startsWith('[') && t.endsWith(']')) {
    return t.slice(1, -1);
  }
  return t;
}

/**
 * 로그·브라우저용 `http://host:port` 의 host 부분. IPv6 리터럴은 대괄호를 포함한다.
 */
export function formatHttpBindHostForUrl(host: string): string {
  const inner = canonicalizeHttpBindHostForListen(host);
  if (inner.includes(':')) {
    return `[${inner}]`;
  }
  return inner;
}

export function isHttpBindHostRemotelyReachable(host: string): boolean {
  const raw = host.trim().toLowerCase();
  const h = raw.startsWith('[') && raw.endsWith(']') ? raw.slice(1, -1) : raw;
  if (h === 'localhost' || h === '::1') {
    return false;
  }
  if (isIpv4Loopback127Block(h) || isIpv4MappedLoopback(h)) {
    return false;
  }
  return true;
}

/**
 * 원격 도달 가능한 바인딩인데 ADMIN_API_KEY도 없고 insecure 옵션도 없으면 기동 불가 메시지.
 */
export function getMementoHttpSecurityStartupViolationMessage(config: {
  httpListenHost: string;
  adminApiKey: string | undefined;
  allowInsecureHttpAdmin: boolean;
}): string | null {
  if (!isHttpBindHostRemotelyReachable(config.httpListenHost)) {
    return null;
  }
  const hasKey = !!(config.adminApiKey && config.adminApiKey.trim() !== '');
  if (hasKey) {
    return null;
  }
  if (config.allowInsecureHttpAdmin) {
    return null;
  }
  return (
    'HTTP 서버가 루프백이 아닌 주소에 바인딩되어 있는데 ADMIN_API_KEY가 없습니다. ' +
    '관리·API·품질 경로 무인증 노출을 막으려면 ADMIN_API_KEY를 설정하거나, ' +
    '로컬 전용으로 루프백 주소(예: 127.0.0.1, ::1)를 MEMENTO_HTTP_BIND_HOST에 두세요. ' +
    '개발 전용 위험 허용은 MEMENTO_ALLOW_INSECURE_HTTP_ADMIN=true (문서 필독).'
  );
}
