import { describe, it, expect } from 'vitest';
import {
  isHttpBindHostRemotelyReachable,
  canonicalizeHttpBindHostForListen,
  formatHttpBindHostForUrl,
  getMementoHttpSecurityStartupViolationMessage,
  MementoHttpSecurityStartupError
} from './http-bind-policy.js';

describe('http-bind-policy', () => {
  describe('canonicalizeHttpBindHostForListen', () => {
    it('strips bracketed IPv6 for Node listen()', () => {
      expect(canonicalizeHttpBindHostForListen('[::1]')).toBe('::1');
      expect(canonicalizeHttpBindHostForListen('  [::1]  ')).toBe('::1');
    });

    it('passes through IPv4 and bare IPv6', () => {
      expect(canonicalizeHttpBindHostForListen('127.0.0.1')).toBe('127.0.0.1');
      expect(canonicalizeHttpBindHostForListen('::1')).toBe('::1');
    });
  });

  describe('formatHttpBindHostForUrl', () => {
    it('wraps IPv6 listen form in brackets for URLs', () => {
      expect(formatHttpBindHostForUrl('::1')).toBe('[::1]');
      expect(formatHttpBindHostForUrl('[::1]')).toBe('[::1]');
    });

    it('does not wrap IPv4', () => {
      expect(formatHttpBindHostForUrl('127.0.0.1')).toBe('127.0.0.1');
    });
  });

  describe('isHttpBindHostRemotelyReachable', () => {
    it('treats loopback hosts as not remotely reachable', () => {
      expect(isHttpBindHostRemotelyReachable('127.0.0.1')).toBe(false);
      expect(isHttpBindHostRemotelyReachable('127.0.1.1')).toBe(false);
      expect(isHttpBindHostRemotelyReachable('127.255.255.255')).toBe(false);
      expect(isHttpBindHostRemotelyReachable('localhost')).toBe(false);
      expect(isHttpBindHostRemotelyReachable('::1')).toBe(false);
      expect(isHttpBindHostRemotelyReachable('[::1]')).toBe(false);
      expect(isHttpBindHostRemotelyReachable('::ffff:127.0.0.1')).toBe(false);
    });

    it('treats all-interfaces and other addresses as reachable', () => {
      expect(isHttpBindHostRemotelyReachable('0.0.0.0')).toBe(true);
      expect(isHttpBindHostRemotelyReachable('::')).toBe(true);
      expect(isHttpBindHostRemotelyReachable('192.168.1.1')).toBe(true);
      expect(isHttpBindHostRemotelyReachable('128.0.0.1')).toBe(true);
    });
  });

  describe('MementoHttpSecurityStartupError', () => {
    it('exposes stable code and name', () => {
      const err = new MementoHttpSecurityStartupError('test message');
      expect(err).toBeInstanceOf(Error);
      expect(err.name).toBe('MementoHttpSecurityStartupError');
      expect(err.message).toBe('test message');
      expect(err.code).toBe('MEMENTO_HTTP_SECURITY_STARTUP');
    });
  });

  describe('getMementoHttpSecurityStartupViolationMessage', () => {
    it('returns null for loopback bind', () => {
      expect(
        getMementoHttpSecurityStartupViolationMessage({
          httpListenHost: '127.0.0.1',
          adminApiKey: undefined,
          allowInsecureHttpAdmin: false
        })
      ).toBeNull();
      expect(
        getMementoHttpSecurityStartupViolationMessage({
          httpListenHost: '127.0.1.1',
          adminApiKey: undefined,
          allowInsecureHttpAdmin: false
        })
      ).toBeNull();
    });

    it('returns null when admin key is set on public bind', () => {
      expect(
        getMementoHttpSecurityStartupViolationMessage({
          httpListenHost: '0.0.0.0',
          adminApiKey: 'secret',
          allowInsecureHttpAdmin: false
        })
      ).toBeNull();
    });

    it('returns null when insecure flag is set', () => {
      expect(
        getMementoHttpSecurityStartupViolationMessage({
          httpListenHost: '0.0.0.0',
          adminApiKey: undefined,
          allowInsecureHttpAdmin: true
        })
      ).toBeNull();
    });

    it('returns message when public bind without key or insecure', () => {
      const msg = getMementoHttpSecurityStartupViolationMessage({
        httpListenHost: '0.0.0.0',
        adminApiKey: undefined,
        allowInsecureHttpAdmin: false
      });
      expect(msg).toContain('ADMIN_API_KEY');
    });
  });
});
