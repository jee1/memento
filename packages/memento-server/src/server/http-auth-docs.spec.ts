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
    expect(notice).toContain('/api/v1/quality');
    expect(notice).toContain('/api/v1/maintenance');
    expect(notice).toContain('/tools');
    expect(notice).toContain('/mcp');
    expect(notice).toContain('/messages');
    expect(notice).toContain('browser-session cookie flow');
    expect(notice).toContain('browser session');
    expect(notice).not.toContain('/admin and /api require a browser session or ADMIN_API_KEY');
    expect(notice).toContain('Authorization Bearer');
    expect(notice).toContain('X-API-Key');
  });

  it('warns that all programmatic routes fail closed when ADMIN_API_KEY is missing', () => {
    const warning = getHttpAuthMissingAdminKeyWarning();

    expect(warning).not.toContain('/admin');
    expect(warning).not.toContain('/api,');
    expect(warning).toContain('/api/v1/quality');
    expect(warning).toContain('/api/v1/maintenance');
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
    expect(english).toContain('/admin` and `/api` require a browser session');
    expect(english).not.toContain('/admin` and `/api` require a browser session or `ADMIN_API_KEY`');
    expect(english).toContain('/api/v1/quality');
    expect(english).toContain('/api/v1/maintenance');
    expect(english).toContain('`/dashboard` is the preferred entry point');
    expect(english).toContain('opening `/graph` directly now offers the same `/auth/session` re-auth path');
    expect(english).toContain('HTTP-only (not MCP)');
    expect(korean).not.toContain('HTTP API는 인증이 없으며');
    expect(korean).toContain('HTTP 서버는 브라우저 세션과 헤더 기반 신뢰 경계를 분리합니다');
    expect(korean).toContain('브라우저 세션 + 헤더 기반 분리 신뢰 모델');
    expect(korean).toContain('/admin`과 `/api`는 브라우저 세션');
    expect(korean).not.toContain('/admin`과 `/api`는 브라우저 세션 또는 `ADMIN_API_KEY`');
    expect(korean).toContain('/api/v1/quality');
    expect(korean).toContain('/api/v1/maintenance');
    expect(korean).toContain('전체 관리 흐름은 `/dashboard`에서 여는 편이 가장 안전');
    expect(korean).toContain('`/graph`를 직접 열어도 동일한 `/auth/session` 기반 재인증 패널');
    expect(korean).toContain('HTTP 전용 (MCP에 없음)');

    const englishMcpSection = sectionBetween(
      english,
      '### MCP Tools (Core 22)',
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

  it('keeps longer-form security docs aligned with the split trust model', () => {
    const englishSecurity = readRepoFile('docs/reference/en/security.md');
    const koreanSecurity = readRepoFile('docs/reference/ko/security.md');
    const developerGuide = readRepoFile('docs/guides/ko/developer-guide.md');

    expect(englishSecurity).not.toContain('has **no authentication or authorization middleware**');
    expect(englishSecurity).toContain('/auth/session');
    expect(englishSecurity).toContain('/admin/*');
    expect(englishSecurity).toContain('/api/*');
    expect(englishSecurity).toContain('require that browser session');
    expect(englishSecurity).not.toContain('or `ADMIN_API_KEY`');
    expect(englishSecurity).toContain('/api/v1/quality');
    expect(englishSecurity).toContain('/api/v1/maintenance');
    expect(englishSecurity).toContain('/dashboard` is the recommended entry point');
    expect(englishSecurity).toContain('opening `/graph` directly now offers the same session-backed sign-in/re-auth path');
    expect(englishSecurity).toContain('requires a browser session before the graph surface unlocks');
    expect(englishSecurity).toContain('Authorization: Bearer');
    expect(englishSecurity).toContain('X-API-Key');

    expect(koreanSecurity).not.toContain('인증·인가 미들웨어가 없습니다');
    expect(koreanSecurity).toContain('/auth/session');
    expect(koreanSecurity).toContain('/admin/*');
    expect(koreanSecurity).toContain('/api/*');
    expect(koreanSecurity).toContain('브라우저 세션이 필요합니다');
    expect(koreanSecurity).not.toContain('브라우저 세션 또는 `ADMIN_API_KEY`');
    expect(koreanSecurity).toContain('/api/v1/quality');
    expect(koreanSecurity).toContain('/api/v1/maintenance');
    expect(koreanSecurity).toContain('/dashboard`가 권장 진입점');
    expect(koreanSecurity).toContain('/graph`를 직접 열어도 같은 세션 모델로 로그인/재인증');
    expect(koreanSecurity).toContain('브라우저 세션이 생긴 뒤에만 그래프 화면이 열립니다');
    expect(koreanSecurity).toContain('Authorization: Bearer');
    expect(koreanSecurity).toContain('X-API-Key');

    expect(developerGuide).toContain('/admin`, `/api`');
    expect(developerGuide).not.toContain('/admin`, `/api`, `/api/v1/quality`');
    expect(developerGuide).toContain('/api/v1/quality');
    expect(developerGuide).toContain('/api/v1/maintenance');
    expect(developerGuide).toContain('브라우저 세션');
    expect(developerGuide).toContain('헤더 기반');
  });
});
