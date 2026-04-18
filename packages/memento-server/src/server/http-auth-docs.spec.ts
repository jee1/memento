import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

import {
  getHttpAuthMissingAdminKeyWarning,
  getHttpAuthTrustModelNotice
} from './http-server.js';

function readRepoFile(relativePath: string): string {
  return readFileSync(new URL(`../../../../${relativePath}`, import.meta.url), 'utf8');
}

function sectionBetween(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  expect(start, `missing start marker: ${startMarker}`).toBeGreaterThanOrEqual(0);

  const end = source.indexOf(endMarker, start + startMarker.length);
  expect(end, `missing end marker: ${endMarker}`).toBeGreaterThan(start);

  return source.slice(start, end);
}

describe('HTTP auth docs and startup messaging', () => {
  it('describes the split browser-session and header-auth trust model', () => {
    const notice = getHttpAuthTrustModelNotice();

    expect(notice).toContain('/auth/session');
    expect(notice).toContain('/admin');
    expect(notice).toContain('/api');
    expect(notice).toContain('/tools');
    expect(notice).toContain('/mcp');
    expect(notice).toContain('browser-session cookie flow');
    expect(notice).toContain('Authorization Bearer');
    expect(notice).toContain('X-API-Key');
  });

  it('warns that all programmatic routes fail closed when ADMIN_API_KEY is missing', () => {
    const warning = getHttpAuthMissingAdminKeyWarning();

    expect(warning).toContain('/admin');
    expect(warning).toContain('/api');
    expect(warning).toContain('/tools');
    expect(warning).toContain('/mcp');
    expect(warning).toContain('/messages');
    expect(warning).toContain('fail closed');
  });

  it('keeps README auth sections aligned with the current HTTP trust boundary', () => {
    const english = readRepoFile('README.en.md');
    const korean = readRepoFile('README.md');

    expect(english).not.toContain('HTTP API has no authentication');
    expect(english).toContain('HTTP server splits browser-session and header-based trust');
    expect(english).toContain('Split browser-session and header-based trust model');
    expect(english).toContain('HTTP-only (not MCP)');
    expect(korean).not.toContain('HTTP API는 인증이 없으며');
    expect(korean).toContain('HTTP 서버는 브라우저 세션과 헤더 기반 신뢰 경계를 분리합니다');
    expect(korean).toContain('브라우저 세션 + 헤더 기반 분리 신뢰 모델');
    expect(korean).toContain('HTTP 전용 (MCP에 없음)');

    const englishMcpSection = sectionBetween(
      english,
      '### MCP Tools (Core 14)',
      '> **Important**'
    );
    expect(englishMcpSection).not.toContain('restore_anchors');
    expect(englishMcpSection).not.toContain('migrate_embeddings');
    expect(englishMcpSection).not.toContain('convert_episodic_to_semantic');
    expect(englishMcpSection).not.toContain('get_meta_memory_stats');

    const koreanMcpSection = sectionBetween(
      korean,
      '### 🧠 핵심 메모리 관리 (MCP 클라이언트)',
      '> **참고**'
    );
    expect(koreanMcpSection).not.toContain('메타 메모리 통계');
    expect(koreanMcpSection).not.toContain('기억 변환');
    expect(koreanMcpSection).not.toContain('Episodic → Semantic');
  });
});
