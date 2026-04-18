import { afterEach, describe, expect, it, vi } from 'vitest';

import { createSessionStore } from './session-store.js';

describe('createSessionStore', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('expires sessions after the idle timeout when they are not touched', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-18T00:00:00.000Z'));

    const store = createSessionStore({
      idleTtlMs: 15 * 60 * 1000,
      absoluteTtlMs: 8 * 60 * 60 * 1000,
    });

    const session = store.create();

    expect(store.get(session.sessionId)).toMatchObject(session);

    vi.advanceTimersByTime(15 * 60 * 1000 + 1);

    expect(store.get(session.sessionId)).toBeNull();
  });

  it('touch refreshes idle expiry without extending the absolute timeout', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-18T00:00:00.000Z'));

    const store = createSessionStore({
      idleTtlMs: 15 * 60 * 1000,
      absoluteTtlMs: 60 * 60 * 1000,
    });

    const session = store.create();

    vi.advanceTimersByTime(10 * 60 * 1000);

    const touched = store.touch(session.sessionId);

    expect(touched).not.toBeNull();
    expect(touched?.lastSeenAt).toBe(Date.parse('2026-04-18T00:10:00.000Z'));
    expect(touched?.expiresAt).toBe(session.expiresAt);

    vi.advanceTimersByTime(14 * 60 * 1000 + 59 * 1000);

    expect(store.get(session.sessionId)).not.toBeNull();

    vi.setSystemTime(new Date('2026-04-18T01:00:00.001Z'));

    expect(store.get(session.sessionId)).toBeNull();
  });

  it('cleans up stale sessions when another session is accessed', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-18T00:00:00.000Z'));

    const deleteSpy = vi.spyOn(Map.prototype, 'delete');
    const store = createSessionStore({
      idleTtlMs: 15 * 60 * 1000,
      absoluteTtlMs: 60 * 60 * 1000,
    });

    const staleSession = store.create();

    vi.advanceTimersByTime(10 * 60 * 1000);

    const freshSession = store.create();
    deleteSpy.mockClear();

    vi.advanceTimersByTime(6 * 60 * 1000);

    expect(store.touch(freshSession.sessionId)).not.toBeNull();
    expect(deleteSpy).toHaveBeenCalledWith(staleSession.sessionId);
    expect(store.get(staleSession.sessionId)).toBeNull();
  });

  it('returns null when touch is called after expiry and evicts the session', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-18T00:00:00.000Z'));

    const deleteSpy = vi.spyOn(Map.prototype, 'delete');
    const store = createSessionStore({
      idleTtlMs: 15 * 60 * 1000,
      absoluteTtlMs: 60 * 60 * 1000,
    });

    const session = store.create();

    vi.advanceTimersByTime(15 * 60 * 1000 + 1);

    expect(store.touch(session.sessionId)).toBeNull();
    expect(deleteSpy).toHaveBeenCalledWith(session.sessionId);
    expect(store.get(session.sessionId)).toBeNull();
  });
});
