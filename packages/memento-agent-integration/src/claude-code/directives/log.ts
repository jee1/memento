import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  caseId,
  type CaseId,
  type DirectiveMode,
  type InjectionLine,
  type LogLine,
  type ResetLine,
} from './types.js';

function localDate(ms: number, dayOffset = 0): string {
  const d = new Date(ms);
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate() + dayOffset);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
}

const logFile = (logDir: string, ms: number, dayOffset = 0): string =>
  join(logDir, `injections-${localDate(ms, dayOffset)}.jsonl`);

export async function appendLine(logDir: string, line: LogLine, nowMs: number): Promise<void> {
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  await mkdir(logDir, { recursive: true, mode: 0o700 });
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  await appendFile(logFile(logDir, nowMs), `${JSON.stringify(line)}\n`, { mode: 0o600 });
}

async function readLines(file: string): Promise<unknown[]> {
  let raw: string;
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    raw = await readFile(file, 'utf8');
  } catch {
    return [];
  }
  const lines: unknown[] = [];
  for (const text of raw.split('\n')) {
    if (!text) continue;
    try {
      lines.push(JSON.parse(text));
    } catch {
      // 쓰다 끊긴 줄은 건너뛴다.
    }
  }
  return lines;
}

/** 어제와 오늘 로그를 시간순으로 접어 이 세션에서 이미 컨텍스트에 들어간 case 집합을 만든다. */
export async function readInContext(
  logDir: string,
  session: string,
  mode: DirectiveMode,
  nowMs: number,
): Promise<Set<CaseId>> {
  const inContext = new Set<CaseId>();
  const files = [logFile(logDir, nowMs, -1), logFile(logDir, nowMs)];
  for (const file of files) {
    for (const entry of await readLines(file)) {
      const line = entry as Partial<InjectionLine & ResetLine> | null;
      if (line?.session_id !== session) continue;
      if (line.reset === true) {
        inContext.clear();
      } else if (line.inj_id !== undefined) {
        const injection = line as InjectionLine;
        if (injection.mode !== mode || injection.fallback !== false) continue;
        if (!Array.isArray(injection.cases)) continue;
        for (const entry of injection.cases) {
          if (typeof entry?.id === 'string') inContext.add(caseId(entry.id));
        }
      }
    }
  }
  return inContext;
}
