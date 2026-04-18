import { randomUUID } from 'node:crypto';

export type SessionRecord = {
  sessionId: string;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
};

export type SessionStore = {
  create(): SessionRecord;
  get(sessionId: string): SessionRecord | null;
  touch(sessionId: string): SessionRecord | null;
  delete(sessionId: string): void;
};

export type SessionStoreConfig = {
  idleTtlMs: number;
  absoluteTtlMs: number;
};

export function createSessionStore(config: SessionStoreConfig): SessionStore {
  const sessions = new Map<string, SessionRecord>();

  const isExpired = (session: SessionRecord, now: number): boolean => {
    return now - session.lastSeenAt > config.idleTtlMs || now > session.expiresAt;
  };

  const store: SessionStore = {
    create(): SessionRecord {
      const now = Date.now();
      const session: SessionRecord = {
        sessionId: randomUUID(),
        createdAt: now,
        lastSeenAt: now,
        expiresAt: now + config.absoluteTtlMs,
      };

      sessions.set(session.sessionId, session);
      return session;
    },

    get(sessionId: string): SessionRecord | null {
      const session = sessions.get(sessionId);
      if (!session) {
        return null;
      }

      if (isExpired(session, Date.now())) {
        sessions.delete(sessionId);
        return null;
      }

      return session;
    },

    touch(sessionId: string): SessionRecord | null {
      const session = store.get(sessionId);
      if (!session) {
        return null;
      }

      session.lastSeenAt = Date.now();
      sessions.set(sessionId, session);
      return session;
    },

    delete(sessionId: string): void {
      sessions.delete(sessionId);
    },
  };

  return store;
}
