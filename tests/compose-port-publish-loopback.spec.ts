import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * #1126: 컨테이너 포트를 기본으로 루프백에만 게시해야 한다.
 *
 * 컨테이너 안 MEMENTO_HTTP_BIND_HOST 는 0.0.0.0 고정이어야 도커 게시가 프로세스에 닿는다.
 * 그래서 외부 노출 여부를 정하는 것은 compose `ports:` 앞자리 하나뿐이다. 앞자리가 없으면
 * 0.0.0.0 게시가 되어 LAN 의 누구나 /tools·/mcp 에 도달한다 — 2026-09-23 실제 상태였다.
 */
const COMPOSE_PATHS = ['docker-compose.yml', 'apps/multi-agent-orchestration/docker-compose.yml'] as const;

function readPublishEntries(composePath: string): string[] {
  const lines = readFileSync(join(process.cwd(), composePath), 'utf-8').split('\n');
  const entries: string[] = [];
  let inPorts = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) {
      continue;
    }
    if (/^ports:\s*$/.test(trimmed)) {
      inPorts = true;
      continue;
    }
    if (!trimmed.startsWith('- ')) {
      // ports: 다음의 리스트가 끝났다. volumes: 항목을 포트로 오인하지 않게 여기서 끊는다.
      inPorts = false;
      continue;
    }
    if (inPorts) {
      entries.push(trimmed.replace(/^-\s*/, '').replace(/^["']|["']$/g, ''));
    }
  }

  return entries;
}

/**
 * `:` 로 쪼개되 `${VAR:-default}` 안의 `:` 는 구분자가 아니다.
 * 단순 split 은 `${MCP_PUBLISH_HOST:-127.0.0.1}:9001:9001` 을 4토막으로 잘못 쪼갠다.
 */
function splitPublishEntry(entry: string): string[] {
  const parts: string[] = [];
  let current = '';
  let depth = 0;
  for (let i = 0; i < entry.length; i += 1) {
    const char = entry[i];
    if (char === '$' && entry[i + 1] === '{') {
      depth += 1;
    } else if (char === '}' && depth > 0) {
      depth -= 1;
    }
    if (char === ':' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  parts.push(current);
  return parts;
}

describe('#1126: compose 는 포트를 기본으로 루프백에만 게시한다', () => {
  it.each(COMPOSE_PATHS)('%s 에 게시 항목이 하나 이상 있다', (composePath) => {
    expect(readPublishEntries(composePath).length).toBeGreaterThan(0);
  });

  it.each(COMPOSE_PATHS)('%s 의 모든 게시 항목이 host 주소를 앞에 붙인다', (composePath) => {
    for (const entry of readPublishEntries(composePath)) {
      // "host:container" 2토막이면 host 주소가 없는 것이다. 3토막이어야 한다.
      expect(splitPublishEntry(entry).length, `게시 항목에 host 주소가 없다: ${entry}`).toBe(3);
    }
  });

  it.each(COMPOSE_PATHS)('%s 의 게시 host 기본값이 127.0.0.1 이다', (composePath) => {
    for (const entry of readPublishEntries(composePath)) {
      const host = splitPublishEntry(entry)[0] ?? '';
      // 그대로 127.0.0.1 이거나, ${VAR:-127.0.0.1} 처럼 기본값이 루프백이어야 한다.
      expect(host === '127.0.0.1' || /:-127\.0\.0\.1\}$/.test(host), `게시 host 기본값이 루프백이 아니다: ${entry}`).toBe(true);
    }
  });
});
