import { describe, it, expect } from 'vitest';
import {
  resolveCorsAllowOrigin,
  buildMcpManualCorsHeaders
} from './cors-policy.js';

describe('cors-policy', () => {
  it('resolveCorsAllowOrigin returns undefined when list empty', () => {
    expect(resolveCorsAllowOrigin('https://a.com', [])).toBeUndefined();
  });

  it('resolveCorsAllowOrigin reflects when origin is listed', () => {
    expect(
      resolveCorsAllowOrigin('https://app.example.com', [
        'https://app.example.com',
        'http://localhost:5173'
      ])
    ).toBe('https://app.example.com');
  });

  it('resolveCorsAllowOrigin rejects unknown origin', () => {
    expect(
      resolveCorsAllowOrigin('https://evil.com', ['https://app.example.com'])
    ).toBeUndefined();
  });

  it('buildMcpManualCorsHeaders omits ACAO when not allowed', () => {
    const h = buildMcpManualCorsHeaders('https://evil.com', ['https://trusted.test']);
    expect(h['Access-Control-Allow-Origin']).toBeUndefined();
    expect(h['Access-Control-Allow-Methods']).toBe('GET, POST, OPTIONS');
    expect(h.Vary).toBe('Origin');
  });

  it('buildMcpManualCorsHeaders includes ACAO when allowed', () => {
    const h = buildMcpManualCorsHeaders('https://trusted.test', ['https://trusted.test']);
    expect(h['Access-Control-Allow-Origin']).toBe('https://trusted.test');
    expect(h.Vary).toBe('Origin');
  });

  it('buildMcpManualCorsHeaders omits Vary when allowlist empty (no reflection)', () => {
    const h = buildMcpManualCorsHeaders('https://any.example', []);
    expect(h.Vary).toBeUndefined();
    expect(h['Access-Control-Allow-Origin']).toBeUndefined();
  });
});
