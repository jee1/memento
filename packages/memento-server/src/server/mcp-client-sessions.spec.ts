import { describe, expect, it } from 'vitest';
import { MAX_SESSION_KEY_LENGTH, McpClientSessions, readClientInfo } from './mcp-client-sessions.js';

describe('McpClientSessions (#1768)', () => {
  it('initialize 의 clientInfo 를 세션 ID 로 다시 찾는다 (실측: opencode, cursor-agent)', () => {
    const s = new McpClientSessions();
    s.remember('probe-1', { name: 'opencode', version: '1.19.6' });
    s.remember('probe-2', { name: 'Cursor', version: '1.0.0' });
    expect(s.recall('probe-1')).toEqual({ name: 'opencode', version: '1.19.6' });
    expect(s.recall('probe-2')).toEqual({ name: 'Cursor', version: '1.0.0' });
  });

  it('세션 헤더가 없거나 모르는 세션이면 undefined 다', () => {
    const s = new McpClientSessions();
    expect(s.recall(undefined)).toBeUndefined();
    expect(s.recall('nope')).toBeUndefined();
  });

  it('clientInfo 가 없거나 이름이 없으면 기억하지 않는다', () => {
    const s = new McpClientSessions();
    s.remember('a', undefined);
    s.remember('b', {});
    s.remember('c', { version: '1.0.0' });
    expect(s.size()).toBe(0);
  });

  it('128자를 넘는 세션 키는 기억하지 않는다', () => {
    const s = new McpClientSessions();
    const longKey = 'k'.repeat(MAX_SESSION_KEY_LENGTH + 1);
    s.remember(longKey, { name: 'cursor', version: '1.0.0' });
    expect(s.size()).toBe(0);
    expect(s.recall(longKey)).toBeUndefined();
    s.remember('k'.repeat(MAX_SESSION_KEY_LENGTH), { name: 'cursor', version: '1.0.0' });
    expect(s.size()).toBe(1);
  });

  it('용량을 넘으면 가장 오래 안 쓴 세션이 밀려난다', () => {
    const s = new McpClientSessions(3);
    s.remember('s1', { name: 'cursor', version: '1.0.0' });
    s.remember('s2', { name: 'cursor', version: '1.0.0' });
    s.remember('s3', { name: 'cursor', version: '1.0.0' });
    s.remember('s4', { name: 'cursor', version: '1.0.0' });
    expect(s.size()).toBe(3);
    expect(s.recall('s1')).toBeUndefined();
    expect(s.recall('s4')).toBeDefined();
  });

  it('읽은 세션은 최근 사용으로 올라 새 세션에 밀려나지 않는다 (LRU)', () => {
    const s = new McpClientSessions(3);
    s.remember('old-but-active', { name: 'opencode', version: '1.19.6' });
    s.remember('s2', { name: 'cursor', version: '1.0.0' });
    s.remember('s3', { name: 'cursor', version: '1.0.0' });
    s.recall('old-but-active');
    s.remember('s4', { name: 'cursor', version: '1.0.0' });
    expect(s.recall('old-but-active')).toBeDefined();
    expect(s.recall('s2')).toBeUndefined();
  });

  it('같은 세션을 다시 기억하면 값을 갱신하고 개수를 늘리지 않는다', () => {
    const s = new McpClientSessions(3);
    s.remember('a', { name: 'cursor', version: '1.0.0' });
    s.remember('a', { name: 'cursor', version: '1.0.1' });
    expect(s.size()).toBe(1);
    expect(s.recall('a')?.version).toBe('1.0.1');
  });

  it('이름과 버전 원문을 64자로 자른다', () => {
    const s = new McpClientSessions();
    s.remember('a', { name: 'n'.repeat(500), version: 'v'.repeat(500) });
    expect(s.recall('a')?.name).toHaveLength(64);
    expect(s.recall('a')?.version).toHaveLength(64);
  });

  it('forget 이 지운다', () => {
    const s = new McpClientSessions();
    s.remember('a', { name: 'cursor', version: '1.0.0' });
    s.forget('a');
    expect(s.recall('a')).toBeUndefined();
  });

  it('readClientInfo: 새 방식 _meta 의 clientInfo 모양(실측 Claude Code)도 읽는다', () => {
    expect(
      readClientInfo({ name: 'claude-code', title: 'Claude Code', version: '2.1.327', description: 'x', websiteUrl: 'https://x' }),
    ).toEqual({ name: 'claude-code', version: '2.1.327' });
  });
});
