import {
  createMarkdownDirectiveRecallPort,
  type RecallPort,
} from '@memento/agent-integration';
import { join } from 'node:path';

import { createDirectiveRecallPort } from './directive-recall.js';

const expandHome = (path: string, home: string): string =>
  path === '~' ? home : path.startsWith('~/') ? join(home, path.slice(2)) : path;

/**
 * 마크다운 폴더(`MEMENTO_DIRECTIVES_CASES_DIR`)가 있으면 서버 없이 그걸 쓰고,
 * 없으면 살아 있는 서버 HTTP recall 을 쓴다.
 */
export function resolveDirectiveRecallPort(options: {
  readonly env: NodeJS.ProcessEnv;
  readonly home: string;
  readonly serverPort?: number;
  readonly apiKey?: string;
}): RecallPort | null {
  const casesDir = options.env.MEMENTO_DIRECTIVES_CASES_DIR?.trim();
  if (casesDir) {
    return createMarkdownDirectiveRecallPort(expandHome(casesDir, options.home));
  }
  if (options.serverPort !== undefined) {
    return createDirectiveRecallPort({
      port: options.serverPort,
      apiKey: options.apiKey,
    });
  }
  return null;
}
