export const JSON_INTERACTION_INFO =
  '[info] --json은 인터랙션을 비활성화합니다(저장 생략).\n';

export type ErrorCode =
  | 'MISSING_QUERY'
  | 'INVALID_OPTION'
  | 'BOOTSTRAP_FAILED'
  | 'AGENT_RUN_FAILED'
  | 'PERSIST_FAILED'
  | 'INTERRUPTED'
  | 'NON_INTERACTIVE'
  | 'PROVIDER_MISCONFIGURED';

export function jsonFailure(
  code: ErrorCode,
  stage: 'usage' | 'bootstrap' | 'run' | 'persist',
  message: string,
  details: Record<string, unknown> = {},
): string {
  return `${JSON.stringify({
    ok: false,
    error: { code, stage, message, details },
  })}\n`;
}

export function writeOut(s: string): Promise<void> {
  return new Promise((resolve, reject) => {
    process.stdout.write(s, (e) => (e ? reject(e) : resolve()));
  });
}

export function writeErr(s: string): Promise<void> {
  return new Promise((resolve, reject) => {
    process.stderr.write(s, (e) => (e ? reject(e) : resolve()));
  });
}

export function debugErr(err: unknown): void {
  if (process.env.MEMENTO_DEBUG === '1' && err instanceof Error && err.stack) {
    void writeErr(err.stack + '\n');
  }
}

