/**
 * Network Egress Guard (#1094)
 *
 * MEMENTO_OFFLINE_STRICT 활성화 시 루프백(127.0.0.1, localhost, unix socket) 이외의
 * 외부 네트워크 소켓 연결을 차단하고 예외를 발생시킵니다.
 */

import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import { mementoConfig } from '../config/index.js';

export function isLocalHost(host: string | null | undefined): boolean {
  if (!host) return true;
  const normalized = host.trim().toLowerCase();
  if (
    normalized === 'localhost' ||
    normalized === '127.0.0.1' ||
    normalized === '::1' ||
    normalized === '0.0.0.0' ||
    normalized.startsWith('127.') ||
    normalized.startsWith('unix:') ||
    normalized.startsWith('/')
  ) {
    return true;
  }
  return false;
}

export class ExternalNetworkEgressForbiddenError extends Error {
  constructor(host: string) {
    super(`external network egress forbidden in offline strict mode: ${host}`);
    this.name = 'ExternalNetworkEgressForbiddenError';
  }
}

export function assertAllowedNetworkEgress(host: string | null | undefined): void {
  if (mementoConfig.offlineStrict && !isLocalHost(host)) {
    throw new ExternalNetworkEgressForbiddenError(host ?? 'unknown');
  }
}

/**
 * 전역 네트워크 연결에 오프라인 엄격 가드를 설치합니다.
 * 반환된 정리 함수를 호출하면 원래 메서드로 복원됩니다.
 */
export function installNetworkGuard(): () => void {
  const originalSocketConnect = net.Socket.prototype.connect;
  const originalHttpRequest = http.request;
  const originalHttpsRequest = https.request;

  net.Socket.prototype.connect = function (...args: any[]) {
    if (mementoConfig.offlineStrict) {
      let host: string | null = null;
      if (typeof args[0] === 'object' && args[0] !== null) {
        host = args[0].host || args[0].hostname || null;
      } else if (typeof args[1] === 'string') {
        host = args[1];
      }
      if (host && !isLocalHost(host)) {
        const err = new ExternalNetworkEgressForbiddenError(host);
        process.nextTick(() => this.emit('error', err));
        return this;
      }
    }
    return originalSocketConnect.apply(this, args as any);
  };

  http.request = function (...args: any[]) {
    if (mementoConfig.offlineStrict) {
      let host: string | null = null;
      if (typeof args[0] === 'string') {
        try {
          const parsed = new URL(args[0]);
          host = parsed.hostname;
        } catch {
          host = args[0];
        }
      } else if (args[0] instanceof URL) {
        host = args[0].hostname;
      } else if (typeof args[0] === 'object' && args[0] !== null) {
        host = args[0].host || args[0].hostname || null;
      }
      if (host && !isLocalHost(host)) {
        throw new ExternalNetworkEgressForbiddenError(host);
      }
    }
    return originalHttpRequest.apply(this, args as any);
  };

  https.request = function (...args: any[]) {
    if (mementoConfig.offlineStrict) {
      let host: string | null = null;
      if (typeof args[0] === 'string') {
        try {
          const parsed = new URL(args[0]);
          host = parsed.hostname;
        } catch {
          host = args[0];
        }
      } else if (args[0] instanceof URL) {
        host = args[0].hostname;
      } else if (typeof args[0] === 'object' && args[0] !== null) {
        host = args[0].host || args[0].hostname || null;
      }
      if (host && !isLocalHost(host)) {
        throw new ExternalNetworkEgressForbiddenError(host);
      }
    }
    return originalHttpsRequest.apply(this, args as any);
  };

  return () => {
    net.Socket.prototype.connect = originalSocketConnect;
    http.request = originalHttpRequest;
    https.request = originalHttpsRequest;
  };
}
