type Level = 'error' | 'warn' | 'info' | 'debug';
const ORDER: Record<Level, number> = { error: 0, warn: 1, info: 2, debug: 3 };
const RATE_LIMIT_MS = 60_000;

export interface AssistantLogger {
  error(msg: string): void;
  warn(msg: string): void;
  info(msg: string): void;
  debug(msg: string): void;
}

interface CreateOpts {
  level: Level;
  sink: (line: { level: Level; msg: string }) => void;
}

export function createRateLimitedLogger(opts: CreateOpts): AssistantLogger {
  const lastEmit = new Map<string, number>();
  const emit = (level: Level, msg: string) => {
    if (ORDER[level] > ORDER[opts.level]) return;
    if (level === 'warn' || level === 'info') {
      const last = lastEmit.get(msg) ?? -Infinity;
      const now = Date.now();
      if (now - last < RATE_LIMIT_MS) return;
      lastEmit.set(msg, now);
    }
    opts.sink({ level, msg });
  };
  return {
    error: (m) => emit('error', m),
    warn:  (m) => emit('warn', m),
    info:  (m) => emit('info', m),
    debug: (m) => emit('debug', m),
  };
}

export function levelFromEnv(env: NodeJS.ProcessEnv): Level {
  const v = (env.MEMENTO_ASSISTANT_LOG ?? 'warn').toLowerCase();
  if (v === 'error' || v === 'warn' || v === 'info' || v === 'debug') return v;
  return 'warn';
}

export const consoleSink = (line: { level: Level; msg: string }) => {
  const out = `[memento-assistant] ${line.level}: ${line.msg}`;
  if (line.level === 'error' || line.level === 'warn') console.error(out);
  else console.log(out);
};
