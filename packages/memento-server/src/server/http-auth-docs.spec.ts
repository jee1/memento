import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';
import {
  getHttpAuthMissingAdminKeyWarning,
  getHttpAuthTrustModelNotice
} from './http-server.js';

function readReadme(path: string): string {
  return readFileSync(path, 'utf8');
}

describe('HTTP auth docs messaging', () => {
  it('describes the split browser and programmatic trust model', () => {
    const message = getHttpAuthTrustModelNotice();

    expect(message).toContain('/auth/session');
    expect(message).toContain('/admin');
    expect(message).toContain('/api');
    expect(message).toContain('/tools');
    expect(message).toContain('/mcp');
    expect(message).toContain('/messages');
    expect(message).toContain('browser sessions');
    expect(message).toContain('Authorization: Bearer <key>');
    expect(message).toContain('X-API-Key: <key>');
  });

  it('keeps the missing admin key warning aligned with the same split model', () => {
    const message = getHttpAuthMissingAdminKeyWarning();

    expect(message).toContain('/auth/session');
    expect(message).toContain('/admin');
    expect(message).toContain('/api');
    expect(message).toContain('/tools');
    expect(message).toContain('/mcp');
    expect(message).toContain('/messages');
    expect(message).toContain('ADMIN_API_KEY is not configured');
    expect(message).toContain('Set ADMIN_API_KEY');
  });

  it('keeps the README auth sections free of the stale no-auth claim and MCP-only mismatch', () => {
    const english = readReadme('README.en.md');
    const korean = readReadme('README.md');

    expect(english).toContain('/auth/session');
    expect(korean).toContain('/auth/session');
    expect(english).not.toContain('HTTP API has no authentication');
    expect(korean).not.toContain('HTTP API는 인증이 없으며');
    expect(english).not.toContain('Management functions are separated into HTTP API endpoints.');
    expect(english).toContain('Operational functions are exposed over the HTTP Management API below, not through MCP.');
    expect(korean).toContain('HTTP 전용 (MCP에 없음)');

    const englishMcpToolsStart = english.indexOf('### MCP Tools');
    const englishHttpOnlyStart = english.indexOf('**HTTP-only (not MCP)**');
    const englishHttpStart = english.indexOf('### HTTP Management API');
    expect(englishMcpToolsStart).toBeGreaterThan(-1);
    expect(englishHttpOnlyStart).toBeGreaterThan(englishMcpToolsStart);
    expect(englishHttpStart).toBeGreaterThan(englishMcpToolsStart);
    expect(english.slice(englishMcpToolsStart, englishHttpOnlyStart)).not.toContain('convert_episodic_to_semantic');
    expect(english.slice(englishMcpToolsStart, englishHttpOnlyStart)).not.toContain('get_meta_memory_stats');

    const koreanMcpToolsStart = korean.indexOf('### MCP Tools');
    const koreanHttpOnlyStart = korean.indexOf('**HTTP 전용 (MCP에 없음)**');
    const koreanHttpStart = korean.indexOf('### HTTP 관리 API');
    expect(koreanMcpToolsStart).toBeGreaterThan(-1);
    expect(koreanHttpOnlyStart).toBeGreaterThan(koreanMcpToolsStart);
    expect(koreanHttpStart).toBeGreaterThan(koreanMcpToolsStart);
    expect(korean.slice(koreanMcpToolsStart, koreanHttpOnlyStart)).not.toContain('convert_episodic_to_semantic');
    expect(korean.slice(koreanMcpToolsStart, koreanHttpOnlyStart)).not.toContain('get_meta_memory_stats');
  });
});
